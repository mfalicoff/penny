import Foundation
import PennyDomain
import Synchronization
import Testing

@testable import PennyData

/// Emailed receipts (MAZ-184): the API's answers, the inbox and attach rules, the offline
/// state and attaching through the normal saves. Fixture ids and `.test` addresses only.
@Suite("Receipt inbox")
@MainActor
struct ReceiptInboxTests {
    nonisolated static let itemId = "0123456789abcdef0123456789abcdef"
    nonisolated static let emailJSON = """
        {"enabled":true,"domain":"receipts.example.test","address":{"address":"r-abcdefghijklmnopqrst@receipts.example.test",
        "createdAt":1793000000000,"expiresAt":1800776000000,"lastReceivedAt":null,"allowedSenders":["shop.example.test"]}}
        """
    nonisolated static let pageJSON = """
        {"items":[{"id":"\(itemId)","from":"Acme Store","subject":"Your order","receivedAt":1794500000000,
        "status":"partly_attached","senderVerified":false,"expiresAt":1797092000000,"attachedAt":null,
        "files":[{"receiptId":"r-email","kind":"email","name":"Your order.pdf","mime":"application/pdf",
        "sizeBytes":20480,"linked":false,"uri":"/api/receipts/r-email"},{"receiptId":"r-inv","kind":"attachment",
        "name":"invoice-0412.pdf","mime":"application/pdf","sizeBytes":40960,"linked":true,
        "uri":"/api/receipts/r-inv"}]}],"next":"\(itemId)"}
        """

    private func path(_ request: URLRequest?) -> String {
        guard let url = request?.url else { return "" }
        return "\(request?.httpMethod ?? "") \(url.path())\(url.query().map { "?\($0)" } ?? "")"
    }

    // MARK: Decoding and requests

    @Test("whenTheServerAnswers_ReceiptEmail_ShouldDecodeTheAddressAndTheOffState")
    func decodesEmail() async throws {
        let transport = StubTransport(json: Self.emailJSON)
        let email = try await APIFixtures.client(transport: transport).receiptEmail()
        #expect(email.enabled)
        #expect(email.domain == "receipts.example.test")
        #expect(email.address?.address == "r-abcdefghijklmnopqrst@receipts.example.test")
        #expect(email.address?.lastReceivedAt == nil)
        #expect(email.address?.allowedSenders == ["shop.example.test"])
        #expect(path(transport.sent.first) == "GET /api/receipt-email")

        let off = try await APIFixtures.client(
            transport: StubTransport(json: #"{"enabled":false,"domain":null,"address":null}"#)
        )
        .receiptEmail()
        #expect(off == WireReceiptEmail(enabled: false, domain: nil, address: nil))
    }

    @Test("whenTheInboxIsRead_APIClient_ShouldSendTheFilterAndCursorAndDecodeItems")
    func decodesInbox() async throws {
        let transport = StubTransport(json: Self.pageJSON)
        let page = try await APIFixtures.client(transport: transport).receiptInbox(.attached, before: Self.itemId)
        #expect(path(transport.sent.first) == "GET /api/receipt-inbox?status=attached&before=\(Self.itemId)")
        let item = try #require(page.items.first)
        #expect(page.next == Self.itemId)
        #expect(item.from == "Acme Store")
        #expect(item.status == "partly_attached")
        #expect(!item.senderVerified)
        #expect(item.attachedAt == nil)
        #expect(item.files.map(\.kind) == ["email", "attachment"])
        #expect(item.files[1].linked)
        #expect(item.files[0].sizeBytes == 20480)
    }

    @Test("whenAnItemIsDiscardedOrDone_APIClient_ShouldCallItsRouteAndDecodeTheCleanup")
    func cleanup() async throws {
        let transport = StubTransport(json: #"{"deleted":1,"kept":1}"#)
        let client = try APIFixtures.client(transport: transport)
        #expect(try await client.discardInboxItem(id: Self.itemId) == WireReceiptInboxCleanup(deleted: 1, kept: 1))
        _ = try await client.finishInboxItem(id: Self.itemId)
        #expect(
            transport.sent.map(path) == [
                "DELETE /api/receipt-inbox/\(Self.itemId)", "POST /api/receipt-inbox/\(Self.itemId)/done",
            ])
        await #expect(throws: APIError.invalidRequest(.invalidField("id"))) {
            try await client.discardInboxItem(id: "")
        }
    }

    @Test("whenTheAddressChanges_APIClient_ShouldSendOnlyWhatChanged")
    func addressRequests() async throws {
        let transport = StubTransport { request in
            let body = request.httpMethod == "DELETE" ? #"{"ok":true}"# : Self.emailJSON
            return HTTPResult(status: 200, headers: [:], body: Data(body.utf8))
        }
        let client = try APIFixtures.client(transport: transport)
        _ = try await client.createReceiptEmail()
        _ = try await client.updateReceiptEmail(extend: true)
        _ = try await client.updateReceiptEmail(allowedSenders: ["me@example.test"])
        try await client.deleteReceiptEmail()
        #expect(
            transport.sent.map(path) == [
                "POST /api/receipt-email", "PATCH /api/receipt-email", "PATCH /api/receipt-email",
                "DELETE /api/receipt-email",
            ])
        #expect(try APIFixtures.object(transport.sent[1].httpBody) as NSDictionary == ["extend": true])
        #expect(
            try APIFixtures.object(transport.sent[2].httpBody) as NSDictionary == [
                "allowedSenders": ["me@example.test"]
            ])
        await #expect(throws: APIError.invalidRequest(.invalidField("extend"))) {
            try await client.updateReceiptEmail()
        }
        await #expect(throws: APIError.invalidRequest(.invalidField("allowedSenders"))) {
            try await client.updateReceiptEmail(allowedSenders: Array(repeating: "a.test", count: 51))
        }
    }

    @Test("whenTooManyAddressesWereMade_ReceiptInboxModel_ShouldSaySoAndKeepTheAddress")
    func rateLimited() async throws {
        let service = FakeInbox()
        let model = ReceiptInboxModel(service: service)
        await model.refreshEmail()
        service.failNext(APIError.rateLimited(retryAfter: nil))
        let failure = await model.createAddress()
        #expect(failure == "You've made several new addresses today. Try again tomorrow.")
        #expect(model.address?.address == FakeInbox.address)
    }

    // MARK: Suggestions

    private static let day = CalendarDate(year: 2026, month: 11, day: 12) ?? .earliest

    private static func entry(
        _ id: String, _ offset: Int, kind: EntryKind = .expense, receipt: Bool = false, title: String? = nil
    ) -> LedgerEntry {
        LedgerEntry(
            id: id, title: title ?? id, kind: kind, total: 450, share: 450,
            categoryId: kind == .expense ? "food" : kind == .income ? "salary" : "investments",
            date: day.adding(days: offset),
            receipt: receipt
                ? ReceiptReference(id: "old", name: "old.pdf", uri: "/api/receipts/old", mime: "application/pdf") : nil)
    }

    @Test("whenSuggesting_ReceiptInboxRules_ShouldOfferExpensesWithoutReceiptsWithinAWeekNearestFirst")
    func suggestions() {
        let targets: [AttachTarget] = [
            .personal(Self.entry("far-before", -8)),
            .personal(Self.entry("edge-before", -7)),
            .personal(Self.entry("two-before", -2)),
            .personal(Self.entry("same-day", 0)),
            .personal(Self.entry("one-after", 1)),
            .personal(Self.entry("one-before", -1)),
            .personal(Self.entry("edge-after", 7)),
            .personal(Self.entry("far-after", 8)),
            .personal(Self.entry("pay", 0, kind: .income)),
            .personal(Self.entry("invest", 0, kind: .investment)),
            .personal(Self.entry("has-receipt", 0, receipt: true)),
        ]
        let ids = ReceiptInboxRules.suggestions(targets, received: Self.day).map(\.title)
        #expect(ids == ["same-day", "one-after", "one-before", "two-before", "edge-after"])
        let all = ReceiptInboxRules.suggestions(targets, received: Self.day, limit: 20).map(\.title)
        #expect(all == ["same-day", "one-after", "one-before", "two-before", "edge-after", "edge-before"])
    }

    @Test("whenSuggesting_ReceiptInboxRules_ShouldMixSharedExpensesAndSkipSharedOnesWithReceipts")
    func sharedSuggestions() {
        var withReceipt = FakeHouseholds.expense("rent", date: "2026-11-12")
        withReceipt.receiptId = "r-old"
        let targets: [AttachTarget] = [
            .shared(FakeHouseholds.expense("hydro", date: "2026-11-13"), householdName: "Flat 4B"),
            .shared(withReceipt, householdName: "Flat 4B"),
            .personal(Self.entry("coffee", 3)),
        ]
        let suggested = ReceiptInboxRules.suggestions(targets, received: Self.day)
        #expect(suggested.map(\.id) == ["shared house-1 hydro", "entry coffee"])
        #expect(suggested.first?.householdName == "Flat 4B")
    }

    @Test("whenSearching_ReceiptInboxRules_ShouldMatchEveryExpenseIncludingOnesWithReceipts")
    func search() {
        let targets: [AttachTarget] = [
            .personal(Self.entry("a", -40, receipt: true, title: "Café Mill St")),
            .personal(Self.entry("b", 0, kind: .income, title: "Mill payroll")),
            .personal(Self.entry("c", -1, title: "Groceries")),
        ]
        #expect(ReceiptInboxRules.search(targets, query: "cafe mill").map(\.title) == ["Café Mill St"])
        #expect(ReceiptInboxRules.search(targets, query: "  ").isEmpty)
    }

    // MARK: Items

    private static func item(
        _ files: [WireReceiptInboxFile], status: String = "to_attach", expiresIn days: Double? = 30
    )
        -> WireReceiptInboxItem
    {
        WireReceiptInboxItem(
            id: itemId, from: "Acme Store", subject: "Order", receivedAt: 1_794_500_000_000, status: status,
            senderVerified: true,
            expiresAt: days.map {
                Int64((Date(timeIntervalSince1970: 1_794_500_000).timeIntervalSince1970 + $0 * 86_400) * 1000)
            },
            files: files)
    }

    private static func file(_ id: String, _ kind: String, linked: Bool = false) -> WireReceiptInboxFile {
        WireReceiptInboxFile(
            receiptId: id, kind: kind, name: "\(id).pdf", mime: "application/pdf", sizeBytes: 1024, linked: linked,
            uri: "/api/receipts/\(id)")
    }

    @Test("whenAnItemHasSeveralFiles_ReceiptInboxRules_ShouldPutTheEmailFirstAndPreselectTheFirstAttachment")
    func files() {
        let item = Self.item([
            Self.file("inv", "attachment"), Self.file("mail", "email"), Self.file("photo", "attachment"),
        ])
        #expect(ReceiptInboxRules.orderedFiles(item).map(\.receiptId) == ["mail", "inv", "photo"])
        #expect(ReceiptInboxRules.preselectedFile(item)?.receiptId == "inv")
        #expect(ReceiptInboxRules.preselectedFile(Self.item([Self.file("mail", "email")]))?.receiptId == "mail")
        #expect(ReceiptInboxRules.fileLabel(Self.file("mail", "email")) == "Email")
    }

    @Test("whenAnItemNearsItsExpiry_ReceiptInboxRules_ShouldSayWhenItIsDeletedOnlyInTheLastThreeDays")
    func expiry() {
        let now = Date(timeIntervalSince1970: 1_794_500_000)
        #expect(ReceiptInboxRules.expiryNotice(Self.item([], expiresIn: 10), now: now) == nil)
        #expect(ReceiptInboxRules.expiryNotice(Self.item([], expiresIn: 3), now: now) == "Deleted in 3 days")
        #expect(ReceiptInboxRules.expiryNotice(Self.item([], expiresIn: 0.5), now: now) == "Deleted in 1 day")
        #expect(ReceiptInboxRules.expiryNotice(Self.item([], status: "attached", expiresIn: 1), now: now) == nil)
        #expect(ReceiptInboxRules.expiryNotice(Self.item([], expiresIn: nil), now: now) == nil)
    }

    @Test("whenDiscarding_ReceiptInboxRules_ShouldCountTheFilesDeletedAndKept")
    func discardText() {
        let item = Self.item(
            [Self.file("mail", "email"), Self.file("inv", "attachment", linked: true), Self.file("b", "attachment")],
            status: "partly_attached")
        #expect(
            ReceiptInboxRules.discardMessage(item)
                == "Discard this email? Its 2 files will be deleted. This can't be undone. 1 file attached to an entry is kept."
        )
        #expect(ReceiptInboxRules.progress(item) == "1 of 3 attached")
        #expect(ReceiptInboxRules.spokenCount(3) == "3 receipts to attach")
    }

    @Test("whenShowingEmailText_ReceiptInboxText_ShouldKeepItLiteralAndDropControlAndBidiCharacters")
    func plainText() {
        // Markdown and HTML stay literal text; nothing is interpreted.
        #expect(
            ReceiptInboxText.plain("**Paid** [link](https://evil.example.test) <b>x</b>")
                == "**Paid** [link](https://evil.example.test) <b>x</b>")
        // A line break, a tab, a bidi override and a zero-width space can't rearrange the row.
        #expect(ReceiptInboxText.plain("Acme\r\nStore\t\u{202E}gnp.exe\u{200B}") == "Acme Store gnp.exe")
        #expect(ReceiptInboxText.plain(String(repeating: "a", count: 600)).count == 500)
        let blank = Self.item([])
        #expect(
            ReceiptInboxText.sender(
                WireReceiptInboxItem(
                    id: blank.id, from: " \u{0007} ", subject: "", receivedAt: 0, status: "to_attach",
                    senderVerified: true,
                    expiresAt: nil, files: [])) == "Unknown sender")
    }

    @Test("whenTheEmailArrivedLateAtNight_ReceiptInboxRules_ShouldUseTheDayInThePersonsTimeZone")
    func receivedDay() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try #require(TimeZone(identifier: "America/Toronto"))
        // 2026-11-13T03:30Z is 22:30 on the 12th in Toronto.
        #expect(ReceiptInboxRules.receivedDay(1_794_540_600_000, in: calendar) == Self.day)
    }

    // MARK: Offline

    @Test("whenOffline_ReceiptInboxModel_ShouldSendNothingAndSayToConnect")
    func offline() async {
        let service = FakeInbox()
        let model = ReceiptInboxModel(service: service, available: { false })
        await model.refresh()
        await model.refresh(.toAttach)
        #expect(!model.isAvailable)
        #expect(model.isSupported)
        #expect(model.email == nil)
        #expect(service.calls.isEmpty)
        #expect(await model.discard(Self.item([])) == ReceiptInboxFailure.offline)
        #expect(await model.createAddress() == ReceiptInboxFailure.offline)
        #expect(service.calls.isEmpty)
    }

    @Test("whenTheFeatureIsOff_ReceiptInboxModel_ShouldShowNothing")
    func featureOff() async {
        let service = FakeInbox(enabled: false)
        let model = ReceiptInboxModel(service: service)
        await model.refresh()
        #expect(!model.isEnabled)
        #expect(model.toAttachCount == 0)
        #expect(service.calls == ["receiptEmail"], "the inbox isn't read while the feature is off")
    }

    @Test("whenDiscarding_ReceiptInboxModel_ShouldRemoveTheItemAndKnowItsReceipts")
    func discard() async throws {
        let service = FakeInbox()
        let model = ReceiptInboxModel(service: service)
        await model.refresh()
        #expect(model.toAttachCount == 1)
        #expect(model.isInboxReceipt("r-email"))
        let item = try #require(model.item(id: FakeInbox.item.id))
        #expect(await model.discard(item) == nil)
        #expect(model.toAttachCount == 0)
        #expect(service.calls.last == "discard \(FakeInbox.item.id)")
    }

    @Test("whenAnItemIsAlreadyGone_ReceiptInboxModel_ShouldDropItAndSayItIsUnavailable")
    func gone() async throws {
        let service = FakeInbox()
        let model = ReceiptInboxModel(service: service)
        await model.refresh()
        service.failNext(APIError.notFound(message: nil))
        let failure = await model.discard(try #require(model.item(id: FakeInbox.item.id)))
        #expect(failure?.contains("isn't available") == true)
        #expect(model.toAttachCount == 0)
    }

    @Test("whenAddingSenders_ReceiptInboxModel_ShouldKeepAddressesAndDomainsOnly")
    func senders() {
        #expect(ReceiptInboxModel.normalizedSender(" Me@Example.TEST ") == "me@example.test")
        #expect(ReceiptInboxModel.normalizedSender("shop.example.test") == "shop.example.test")
        #expect(ReceiptInboxModel.normalizedSender("not an address") == nil)
        #expect(ReceiptInboxModel.normalizedSender("@example.test") == nil)
        #expect(ReceiptInboxModel.normalizedSender("localhost") == nil)
        #expect(ReceiptInboxModel.normalizedSenders(["a.test", "A.test", "", "b.test"]) == ["a.test", "b.test"])
    }

    // MARK: Attaching

    @Test("whenAttachingToAPersonalExpense_ReceiptAttacher_ShouldSaveTheLedgerEditWithTheReceipt")
    func attachPersonal() async throws {
        let coffee = Self.entry("coffee", 0, title: "Coffee at Mill St.")
        let workspace = FixedWorkspace(load: .ready(Ledger(transactions: [coffee])))
        let attacher = ReceiptAttacher(workspace: workspace, households: nil, email: FakeHouseholds.email)
        let result = await attacher.attach(Self.file("r-inv", "attachment"), to: .personal(coffee))
        let attachment = try result.get()
        #expect(attachment.message == "Receipt attached to Coffee at Mill St.")
        #expect(workspace.load.ledger?.entry(id: "coffee")?.receipt?.id == "r-inv")
        #expect(attachment.previousReceiptId == nil)
    }

    @Test("whenTheEntryChangedOnAnotherDevice_ReceiptAttacher_ShouldAttachNothing")
    func attachStale() async {
        let coffee = Self.entry("coffee", 0)
        var changed = coffee
        changed.total = 999
        let workspace = FixedWorkspace(load: .ready(Ledger(transactions: [changed])))
        let attacher = ReceiptAttacher(workspace: workspace, households: nil, email: FakeHouseholds.email)
        let result = await attacher.attach(Self.file("r-inv", "attachment"), to: .personal(coffee))
        #expect(throws: ReceiptAttachFailure.self) { try result.get() }
        #expect(workspace.load.ledger?.entry(id: "coffee")?.receipt == nil)
    }

    @Test("whenAttachingToASharedExpense_ReceiptAttacher_ShouldUpdateItWithItsRevisionAndKeepItsSplit")
    func attachShared() async throws {
        let households = FakeHouseholds.standard()
        let hydro = try await households.sharedExpense(householdId: FakeHouseholds.home, id: "hydro")
        let attacher = ReceiptAttacher(
            workspace: FixedWorkspace(load: .ready(Ledger())), households: households, email: FakeHouseholds.email,
            timezoneOffset: { -300 })
        let attachment = try await attacher.attach(
            Self.file("r-inv", "attachment"), to: .shared(hydro, householdName: "Apartment")
        ).get()
        let body = try #require(households.state.withLock { $0.bodies["hydro"] })
        #expect(body.receiptId == "r-inv")
        #expect(body.revision == 0)
        #expect(body.splitMode == "equal")
        #expect(body.allocations == nil)
        #expect(body.totalCents == hydro.totalCents)
        #expect(attachment.target.householdName == "Apartment")

        // Undo unlinks it again, on the new revision.
        #expect(await attacher.undo(attachment) == nil)
        let undone = try #require(households.state.withLock { $0.bodies["hydro"] })
        #expect(undone.receiptId == nil)
        #expect(undone.revision == 1)
    }

    @Test("whenTheSharedExpenseChangedMeanwhile_ReceiptAttacher_ShouldReturnItsNewValuesToConfirmAgain")
    func attachSharedConflict() async throws {
        let households = FakeHouseholds.standard()
        let stale = try await households.sharedExpense(householdId: FakeHouseholds.home, id: "hydro")
        households.state.withLock { $0.expenses["hydro"]?.revision = 4 }
        let attacher = ReceiptAttacher(
            workspace: FixedWorkspace(load: .ready(Ledger())), households: households, email: FakeHouseholds.email)
        let result = await attacher.attach(
            Self.file("r-inv", "attachment"), to: .shared(stale, householdName: "Apartment"))
        guard case .failure(.changed(.shared(let fresh, let name))) = result else {
            Issue.record("expected a conflict, got \(result)")
            return
        }
        #expect(fresh.revision == 4)
        #expect(name == "Apartment")
    }

    @Test("whenListingSharedTargets_ReceiptAttacher_ShouldSkipHouseholdsThePersonLeft")
    func sharedTargets() async throws {
        let households = FakeHouseholds.standard()
        let attacher = ReceiptAttacher(
            workspace: FixedWorkspace(load: .ready(Ledger())), households: households, email: FakeHouseholds.email)
        let list = households.state.withLock { $0.households }
        let targets = await attacher.sharedTargets(list, received: Self.day)
        #expect(targets.contains { $0.id == "shared house-1 hydro" })

        households.state.withLock {
            $0.members[FakeHouseholds.home] = [
                FakeHouseholds.member(FakeHouseholds.me, leftAt: 1_793_000_000_000),
                FakeHouseholds.member(FakeHouseholds.bea),
            ]
        }
        #expect(await attacher.sharedTargets(list, received: Self.day).isEmpty)
    }
}

/// The receipt address and inbox in memory: one item to attach, and failures on demand.
final class FakeInbox: ReceiptInboxService {
    static let address = "r-abcdefghijklmnopqrst@receipts.example.test"
    static let item = WireReceiptInboxItem(
        id: "0123456789abcdef0123456789abcdef", from: "Acme Store", subject: "Your order",
        receivedAt: 1_794_500_000_000,
        status: "to_attach", senderVerified: true, expiresAt: 1_797_092_000_000,
        files: [
            WireReceiptInboxFile(
                receiptId: "r-email", kind: "email", name: "Your order.pdf", mime: "application/pdf", sizeBytes: 2048,
                linked: false, uri: "/api/receipts/r-email")
        ])

    private struct State {
        var calls: [String] = []
        var failure: APIError?
        var items: [WireReceiptInboxItem] = [FakeInbox.item]
    }

    private let state = Mutex(State())
    private let enabled: Bool

    init(enabled: Bool = true) { self.enabled = enabled }

    var calls: [String] { state.withLock { $0.calls } }
    func failNext(_ error: APIError) { state.withLock { $0.failure = error } }

    private func call(_ name: String) throws {
        try state.withLock { state in
            state.calls.append(name)
            if let failure = state.failure {
                state.failure = nil
                throw failure
            }
        }
    }

    private var email: WireReceiptEmail {
        WireReceiptEmail(
            enabled: enabled, domain: enabled ? "receipts.example.test" : nil,
            address: enabled ? WireReceiptEmailAddress(address: Self.address, createdAt: 0, expiresAt: 1) : nil)
    }

    func receiptEmail() async throws -> WireReceiptEmail {
        try call("receiptEmail")
        return email
    }
    func createReceiptEmail() async throws -> WireReceiptEmail {
        try call("create")
        return email
    }
    func updateReceiptEmail(extend: Bool, allowedSenders: [String]?) async throws -> WireReceiptEmail {
        try call("update")
        return email
    }
    func deleteReceiptEmail() async throws { try call("delete") }
    func receiptInbox(_ filter: ReceiptInboxFilter, before: String?) async throws -> WireReceiptInboxPage {
        try call("inbox \(filter.rawValue)")
        return WireReceiptInboxPage(items: filter == .toAttach ? state.withLock { $0.items } : [], next: nil)
    }
    func discardInboxItem(id: String) async throws -> WireReceiptInboxCleanup {
        try call("discard \(id)")
        state.withLock { $0.items.removeAll { $0.id == id } }
        return WireReceiptInboxCleanup(deleted: 1, kept: 0)
    }
    func finishInboxItem(id: String) async throws -> WireReceiptInboxCleanup {
        try call("done \(id)")
        return WireReceiptInboxCleanup(deleted: 0, kept: 1)
    }
}
