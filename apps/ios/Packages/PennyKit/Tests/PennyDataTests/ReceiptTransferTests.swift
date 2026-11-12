import CryptoKit
import Foundation
import PennyData
import PennyDomain
import Synchronization
import Testing

/// A scriptable stand-in for the receipt API, for the upload and preview models.
@MainActor
final class FakeReceipts: ReceiptTransfers {
    var isAvailable = true
    var uploads: [ReceiptCandidate] = []
    var downloads: [String] = []
    /// Answers each upload in turn; the last answer repeats.
    var uploadAnswers: [@MainActor (ReceiptCandidate, @Sendable (Double) -> Void) async throws -> ReceiptReference] = []
    var downloadAnswer: @MainActor (String) async throws -> ReceiptFile = { _ in throw APIError.notFound(message: nil) }

    static func reference(_ id: String = "0123456789abcdef0123456789abcdef", name: String = "receipt.png")
        -> ReceiptReference
    {
        ReceiptReference(id: id, name: name, uri: "/api/receipts/\(id)", mime: "image/png")
    }

    func upload(_ candidate: ReceiptCandidate, progress: @escaping @Sendable (Double) -> Void) async throws
        -> ReceiptReference
    {
        uploads.append(candidate)
        guard let answer = uploadAnswers.count >= uploads.count ? uploadAnswers[uploads.count - 1] : uploadAnswers.last
        else { return Self.reference() }
        return try await answer(candidate, progress)
    }

    func download(id: String) async throws -> ReceiptFile {
        downloads.append(id)
        return try await downloadAnswer(id)
    }
}

private let candidate = ReceiptCandidate(name: "receipt.png", mime: "image/png", data: ReceiptBytes.png)

@Suite("Receipt upload")
@MainActor
struct ReceiptUploadModelTests {
    @Test("whenUploadSucceeds_UploadModel_ShouldReportProgressThenAttachTheReceiptWithItsSize")
    func success() async {
        let fake = FakeReceipts()
        let gate = Gate()
        fake.uploadAnswers = [
            { _, progress in
                progress(0.4)
                await gate.wait()
                return FakeReceipts.reference()
            }
        ]
        var attached: [ReceiptReference] = []
        let model = ReceiptUploadModel(transfers: fake) { attached.append($0) }
        model.upload(candidate)
        #expect(model.isBusy)
        await eventually("progress shown") { model.phase == .uploading(name: "receipt.png", fraction: 0.4) }
        gate.open()
        await eventually("attached") { !attached.isEmpty }
        #expect(attached == [FakeReceipts.reference()])
        #expect(model.phase == .idle)
        #expect(model.sizes[FakeReceipts.reference().id] == ReceiptBytes.png.count)
        #expect(model.localData(for: FakeReceipts.reference().id) == ReceiptBytes.png)
        #expect(fake.uploads == [candidate])
    }

    @Test("whenUploadFailsOnTheNetwork_UploadModel_ShouldOfferTryAgainWithTheSameFile")
    func retry() async {
        let fake = FakeReceipts()
        fake.uploadAnswers = [{ _, _ in throw APIError.offline }, { _, _ in FakeReceipts.reference() }]
        var attached: [ReceiptReference] = []
        let model = ReceiptUploadModel(transfers: fake) { attached.append($0) }
        model.upload(candidate)
        await eventually("failed") { if case .failed = model.phase { true } else { false } }
        #expect(
            model.phase
                == .failed(
                    ReceiptUploadFailure(
                        message: "Penny can't reach the server. Check your connection, then try again.",
                        canRetry: true)))
        #expect(attached.isEmpty)
        model.retry()
        await eventually("attached after retry") { attached.count == 1 }
        #expect(fake.uploads == [candidate, candidate])
    }

    @Test(
        "whenServerRefusesOrSessionEnds_UploadModel_ShouldExplainWithoutTryAgain",
        arguments: [
            (
                APIError.badRequest(message: "This file is not a supported photo or PDF, or exceeds 10 MB."),
                "This file is not a supported photo or PDF, or exceeds 10 MB."
            ),
            (APIError.payloadTooLarge(message: nil), "This file is too large to upload. Choose one under 10 MB."),
            (APIError.unauthorized(message: nil), "Your session ended. Sign in again to attach a receipt."),
        ])
    func notRetryable(error: APIError, message: String) async {
        let fake = FakeReceipts()
        fake.uploadAnswers = [{ _, _ in throw error }]
        let model = ReceiptUploadModel(transfers: fake) { _ in Issue.record("attached") }
        model.upload(candidate)
        await eventually("failed") { if case .failed = model.phase { true } else { false } }
        #expect(model.phase == .failed(ReceiptUploadFailure(message: message, canRetry: false)))
        model.retry()
        #expect(fake.uploads.count == 1, "a refused file is not sent again")
    }

    @Test("whenServerFails_UploadModel_ShouldOfferTryAgain")
    func serverFailure() async {
        let fake = FakeReceipts()
        fake.uploadAnswers = [{ _, _ in throw APIError.server(status: 500, message: nil) }]
        let model = ReceiptUploadModel(transfers: fake) { _ in }
        model.upload(candidate)
        await eventually("failed") { if case .failed = model.phase { true } else { false } }
        #expect(
            model.phase
                == .failed(ReceiptUploadFailure(message: "The upload didn't finish. Try again.", canRetry: true)))
    }

    @Test("whenCancelled_UploadModel_ShouldStopAndDropTheLateAnswer")
    func cancel() async throws {
        let fake = FakeReceipts()
        let gate = Gate()
        let cancelled = Mutex(false)
        fake.uploadAnswers = [
            { _, _ in
                await gate.wait()
                cancelled.withLock { $0 = Task.isCancelled }
                return FakeReceipts.reference()
            }
        ]
        let model = ReceiptUploadModel(transfers: fake) { _ in Issue.record("a cancelled upload attached") }
        model.upload(candidate)
        await eventually("uploading") { model.isBusy && fake.uploads.count == 1 }
        model.cancel()
        #expect(model.phase == .idle)
        gate.open()
        await eventually("the task saw the cancel") { cancelled.withLock { $0 } }
        try await Task.sleep(for: .milliseconds(20))
        #expect(model.phase == .idle)
    }

    @Test("whenAnotherFileIsChosen_UploadModel_ShouldReplaceTheUploadInFlight")
    func replace() async {
        let fake = FakeReceipts()
        let gate = Gate()
        fake.uploadAnswers = [
            { _, _ in
                await gate.wait()
                return FakeReceipts.reference("first")
            },
            { _, _ in FakeReceipts.reference("second") },
        ]
        var attached: [String] = []
        let model = ReceiptUploadModel(transfers: fake) { attached.append($0.id) }
        model.upload(candidate)
        await eventually("first started") { fake.uploads.count == 1 }
        model.upload(ReceiptCandidate(name: "b.pdf", mime: ReceiptRules.pdf, data: ReceiptBytes.pdf))
        await eventually("second attached") { attached == ["second"] }
        gate.open()
        try? await Task.sleep(for: .milliseconds(20))
        #expect(attached == ["second"])
    }

    @Test("whenFileIsRefusedBeforeUpload_UploadModel_ShouldExplainAndSendNothing")
    func refused() {
        let fake = FakeReceipts()
        let model = ReceiptUploadModel(transfers: fake) { _ in }
        model.beginReading()
        #expect(model.isBusy)
        model.refuse(.tooLarge)
        #expect(
            model.phase
                == .failed(
                    ReceiptUploadFailure(
                        message: "This file is larger than 10 MB. Choose a smaller photo or PDF.", canRetry: false)))
        model.dismiss()
        #expect(model.phase == .idle)
        #expect(fake.uploads.isEmpty)
    }

    @Test("whenOfflineOrInTheDemo_UploadModel_ShouldNotSendAndSaySo")
    func unavailable() {
        let fake = FakeReceipts()
        fake.isAvailable = false
        let offline = ReceiptUploadModel(transfers: fake) { _ in }
        #expect(offline.isSupported && !offline.isAvailable)
        offline.upload(candidate)
        #expect(fake.uploads.isEmpty)
        if case .failed(let failure) = offline.phase { #expect(failure.canRetry) } else { Issue.record("not failed") }

        let demo = ReceiptUploadModel(transfers: nil) { _ in }
        #expect(!demo.isSupported)
        demo.upload(candidate)
        if case .failed(let failure) = demo.phase { #expect(!failure.canRetry) } else { Issue.record("not failed") }
    }

    @Test("whenFormCloses_UploadModel_ShouldCancelTheUploadInFlight")
    func releasedCancels() async {
        let fake = FakeReceipts()
        let cancelled = Mutex(false)
        fake.uploadAnswers = [
            { _, _ in
                do {
                    try await Task.sleep(for: .seconds(30))
                } catch {
                    cancelled.withLock { $0 = true }
                }
                return FakeReceipts.reference()
            }
        ]
        var model: ReceiptUploadModel? = ReceiptUploadModel(transfers: fake) { _ in }
        model?.upload(candidate)
        await eventually("started") { fake.uploads.count == 1 }
        model = nil
        await eventually("cancelled") { cancelled.withLock { $0 } }
    }
}

@Suite("Receipt preview")
@MainActor
struct ReceiptPreviewModelTests {
    private func cache() throws -> (ReceiptFileCache, TemporaryFolder) {
        let folder = try TemporaryFolder()
        return (ReceiptFileCache(root: folder.url.appending(path: "cache")), folder)
    }

    @Test("whenDownloaded_PreviewModel_ShouldWriteTheBytesToAProtectedTempFileAndRemoveItOnClose")
    func download() async throws {
        let (cache, folder) = try cache()
        let fake = FakeReceipts()
        let pdf = ReceiptBytes.pdf
        fake.downloadAnswer = { _ in ReceiptFile(data: pdf, mime: ReceiptRules.pdf, filename: "x.pdf") }
        let receipt = ReceiptReference(
            id: "abc", name: "../Lunch: May.pdf", uri: "/api/receipts/abc", mime: ReceiptRules.pdf)
        let model = ReceiptPreviewModel(receipt: receipt, transfers: fake, cache: cache)
        model.load()
        await eventually("ready") { if case .ready = model.state { true } else { false } }
        guard case .ready(let file) = model.state else { return }
        #expect(fake.downloads == ["abc"])
        #expect(file.mime == ReceiptRules.pdf && file.byteCount == pdf.count)
        #expect(SHA256.hash(data: try Data(contentsOf: file.url)) == SHA256.hash(data: pdf))
        #expect(file.url.lastPathComponent == "-Lunch- May.pdf")
        #expect(file.url.path().hasPrefix(cache.root.path()))
        #expect(cache.files().count == 1)
        model.close()
        #expect(cache.files().isEmpty)
        #expect(!FileManager.default.fileExists(atPath: file.url.path()))
        _ = folder
    }

    @Test(
        "whenDownloadFails_PreviewModel_ShouldSayWhyAndWhetherTryAgainHelps",
        arguments: [
            (APIError.notFound(message: nil), ReceiptPreviewFailure.notAvailable, false),
            (APIError.unauthorized(message: nil), .sessionEnded, false),
            (APIError.offline, .offline, true),
            (APIError.server(status: 500, message: nil), .failed, true),
        ])
    func failures(error: APIError, failure: ReceiptPreviewFailure, retry: Bool) async throws {
        let (cache, folder) = try cache()
        let fake = FakeReceipts()
        fake.downloadAnswer = { _ in throw error }
        let model = ReceiptPreviewModel(receipt: FakeReceipts.reference(), transfers: fake, cache: cache)
        model.load()
        await eventually("failed") { if case .failed = model.state { true } else { false } }
        #expect(model.state == .failed(failure))
        #expect(failure.canRetry == retry)
        #expect(cache.files().isEmpty)
        _ = folder
    }

    @Test("whenReceiptWasAttachedByTheLegacyApp_PreviewModel_ShouldNotDownload")
    func legacy() throws {
        let (cache, folder) = try cache()
        let fake = FakeReceipts()
        let receipt = ReceiptReference(id: "r", name: "r.jpg", uri: "file:///var/mobile/r.jpg", mime: "image/jpeg")
        let model = ReceiptPreviewModel(receipt: receipt, transfers: fake, cache: cache)
        model.load()
        #expect(model.state == .failed(.notServed))
        #expect(fake.downloads.isEmpty)
        _ = folder
    }

    @Test("whenOffline_PreviewModel_ShouldNotDownloadAndOfferTryAgain")
    func offline() throws {
        let (cache, folder) = try cache()
        let fake = FakeReceipts()
        fake.isAvailable = false
        let model = ReceiptPreviewModel(receipt: FakeReceipts.reference(), transfers: fake, cache: cache)
        model.load()
        #expect(model.state == .failed(.offline))
        #expect(fake.downloads.isEmpty)
        _ = folder
    }

    @Test("whenTheFormStillHasTheBytes_PreviewModel_ShouldShowThemWithoutADownload")
    func local() throws {
        let (cache, folder) = try cache()
        let fake = FakeReceipts()
        fake.isAvailable = false
        let model = ReceiptPreviewModel(
            receipt: FakeReceipts.reference(), transfers: fake, cache: cache, localData: ReceiptBytes.png)
        model.load()
        guard case .ready(let file) = model.state else {
            Issue.record("not ready: \(model.state)")
            return
        }
        #expect(try Data(contentsOf: file.url) == ReceiptBytes.png)
        #expect(fake.downloads.isEmpty)
        model.close()
        #expect(cache.files().isEmpty)
        _ = folder
    }

    @Test("whenClosedDuringTheDownload_PreviewModel_ShouldCancelItAndKeepNoFile")
    func closeWhileLoading() async throws {
        let (cache, folder) = try cache()
        let fake = FakeReceipts()
        let gate = Gate()
        fake.downloadAnswer = { _ in
            await gate.wait()
            return ReceiptFile(data: ReceiptBytes.png, mime: "image/png", filename: nil)
        }
        let model = ReceiptPreviewModel(receipt: FakeReceipts.reference(), transfers: fake, cache: cache)
        model.load()
        await eventually("downloading") { fake.downloads.count == 1 }
        model.close()
        gate.open()
        try await Task.sleep(for: .milliseconds(30))
        #expect(model.state == .loading)
        #expect(cache.files().isEmpty)
        _ = folder
    }

    @Test("whenPurged_FileCache_ShouldRemoveEveryFileButNothingOutsideIt")
    func purge() throws {
        let (cache, folder) = try cache()
        let outside = folder.url.appending(path: "keep.txt")
        try Data("keep".utf8).write(to: outside)
        _ = try cache.write(ReceiptBytes.png, name: "a.png", mime: "image/png")
        _ = try cache.write(ReceiptBytes.pdf, name: "", mime: ReceiptRules.pdf)
        #expect(cache.files().map(\.lastPathComponent).sorted() == ["a.png", "receipt.pdf"])
        cache.remove(outside)
        #expect(FileManager.default.fileExists(atPath: outside.path()))
        cache.purge()
        #expect(cache.files().isEmpty)
        #expect(FileManager.default.fileExists(atPath: outside.path()))
    }
}

@Suite("Account receipts over the API")
@MainActor
struct AccountReceiptsTests {
    private let email = "contract-user@example.test"

    private func signedIn(_ routes: [String: Routes.Answer]) async throws -> (AuthController, AccountReceipts) {
        var all = routes
        all["POST /api/auth/login"] = Routes.json(Routes.session(email))
        let controller = AuthFixtures.controller(transport: Routes.transport(all))
        await controller.restore()
        try await controller.signIn(email: email, password: "correct horse")
        let account = try #require(controller.state.account)
        return (controller, AccountReceipts(auth: controller, account: account, sync: nil))
    }

    @Test("whenUploaded_AccountReceipts_ShouldSendTheFileAndReturnTheLinkedReceipt")
    func upload() async throws {
        let id = "0123456789abcdef0123456789abcdef"
        let (_, receipts) = try await signedIn([
            "POST /api/receipts": Routes.json(
                201, #"{"id":"\#(id)","name":"receipt.png","mime":"image/png","uri":"/api/receipts/\#(id)"}"#)
        ])
        #expect(receipts.isAvailable)
        let reference = try await receipts.upload(candidate) { _ in }
        #expect(
            reference == ReceiptReference(id: id, name: "receipt.png", uri: "/api/receipts/\(id)", mime: "image/png"))
    }

    @Test("whenTheServerAnswers401_AccountReceipts_ShouldEndTheSessionKeepingLocalWork")
    func expired() async throws {
        let (controller, receipts) = try await signedIn([
            "POST /api/receipts": Routes.json(401, #"{"error":"Please sign in to continue."}"#),
            "GET /api/receipts/abc": Routes.json(401, #"{"error":"Please sign in to continue."}"#),
        ])
        await #expect(throws: APIError.unauthorized(message: "Please sign in to continue.")) {
            try await receipts.upload(candidate) { _ in }
        }
        #expect(controller.state == .signedOut(.sessionExpired(email: email)))
        #expect(!receipts.isAvailable)
        await #expect(throws: APIError.unauthorized(message: nil)) { try await receipts.download(id: "abc") }
    }

    @Test("whenDownloaded_AccountReceipts_ShouldReturnTheBytesAndTreatForbiddenAsNotFound")
    func download() async throws {
        let (_, receipts) = try await signedIn([
            "GET /api/receipts/mine": { _ in
                HTTPResult(status: 200, headers: ["content-type": "image/png"], body: ReceiptBytes.png)
            },
            "GET /api/receipts/theirs": Routes.json(404, #"{"error":"Receipt not found."}"#),
        ])
        #expect(try await receipts.download(id: "mine").data == ReceiptBytes.png)
        await #expect(throws: APIError.notFound(message: "Receipt not found.")) {
            try await receipts.download(id: "theirs")
        }
    }
}

/// Reports body progress the way `URLSessionTransport` does, then answers.
private final class ProgressTransport: HTTPTransport {
    let result: HTTPResult

    init(_ result: HTTPResult) { self.result = result }

    func send(_ request: URLRequest) async throws -> HTTPResult { result }

    func send(_ request: URLRequest, progress: UploadProgress?) async throws -> HTTPResult {
        let total = Int64(request.httpBody?.count ?? 0)
        progress?(0, 0)
        progress?(total / 2, total)
        progress?(total, total)
        return result
    }
}

@Suite("Receipt upload progress")
struct ReceiptUploadProgressTests {
    @Test("whenTransportReportsBodyProgress_UploadReceipt_ShouldForwardFractionsOfTheBody")
    func progress() async throws {
        let transport = ProgressTransport(
            HTTPResult(
                status: 201, body: Data(#"{"id":"r1","name":"a.png","mime":"image/png","uri":"/api/receipts/r1"}"#.utf8)
            ))
        let fractions = Mutex<[Double]>([])
        _ = try await APIFixtures.client(transport: transport)
            .uploadReceipt(name: "a.png", mime: "image/png", data: ReceiptBytes.png) { fraction in
                fractions.withLock { $0.append(fraction) }
            }
        #expect(fractions.withLock { $0 } == [0.5, 1])
    }

    @Test("whenFileIsEmptyOrOverTheLimit_UploadReceipt_ShouldFailBeforeSending")
    func limits() async throws {
        let transport = StubTransport(json: "{}")
        let client = try APIFixtures.client(transport: transport)
        await #expect(throws: APIError.invalidRequest(.invalidField("base64"))) {
            try await client.uploadReceipt(name: "a.png", mime: "image/png", data: Data())
        }
        await #expect(throws: APIError.invalidRequest(.invalidField("base64"))) {
            try await client.uploadReceipt(
                name: "a.png", mime: "image/png", data: Data(count: ReceiptRules.maxBytes + 1))
        }
        #expect(transport.sent.isEmpty)
    }
}
