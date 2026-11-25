import Foundation
import Testing

@testable import PennyData

/// MAZ-152: the full export and members who deleted their account.
@Suite("Account data: export and former members")
@MainActor
struct AccountDataTests {
    private func temporaryRoot() -> URL {
        FileManager.default.temporaryDirectory.appending(path: "PennyExportTests-\(UUID().uuidString)")
    }

    // MARK: Export

    @Test("whenTheServerSendsTheZip_APIClient_ShouldReturnItWithItsFileName")
    func exportRequest() async throws {
        let zip = Data([0x50, 0x4B, 0x03, 0x04])
        let transport = StubTransport { _ in
            HTTPResult(
                status: 200,
                headers: [
                    "content-type": "application/zip",
                    "content-disposition": #"attachment; filename="penny-export-2026-11-22.zip""#,
                ], body: zip)
        }
        let export = try await APIFixtures.client(transport: transport).exportAll()
        #expect(export == AccountExport(data: zip, filename: "penny-export-2026-11-22.zip"))
        let sent = try #require(transport.sent.first)
        #expect(sent.httpMethod == "GET")
        #expect(sent.url?.path == "/api/export")
        #expect(sent.value(forHTTPHeaderField: "Authorization") == "Bearer \(APIFixtures.token)")
    }

    @Test("whenTheServerAnswersJSONOrNothing_APIClient_ShouldRefuseItAsAnExport")
    func exportMalformed() async throws {
        let json = StubTransport { _ in
            HTTPResult(status: 200, headers: ["content-type": "application/json"], body: Data("{}".utf8))
        }
        await #expect(throws: APIError.malformedResponse) {
            try await APIFixtures.client(transport: json).exportAll()
        }
        let empty = StubTransport { _ in HTTPResult(status: 200, headers: [:], body: Data()) }
        await #expect(throws: APIError.malformedResponse) {
            try await APIFixtures.client(transport: empty).exportAll()
        }
    }

    @Test(
        "whenTheServerNamesTheFile_AccountExportFile_ShouldKeepAPlainZipName",
        arguments: [
            ("penny-export-2026-11-22.zip", "penny-export-2026-11-22.zip"),
            ("../../etc/passwd", "etcpasswd.zip"),
            (".hidden.zip", "hidden.zip"),
            ("report", "report.zip"),
        ])
    func safeName(name: String, expected: String) {
        #expect(AccountExportFile.safeName(name) == expected)
    }

    @Test("whenTheServerSendsNoName_AccountExportFile_ShouldNameItForToday")
    func defaultName() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try #require(TimeZone(identifier: "UTC"))
        let date = Date(timeIntervalSince1970: 1_795_000_000)  // 2026-11-18 UTC
        #expect(AccountExportFile.defaultName(on: date, calendar: calendar) == "penny-export-2026-11-18.zip")
        #expect(AccountExportFile.safeName(nil).hasPrefix("penny-export-"))
        #expect(AccountExportFile.safeName("  ").hasSuffix(".zip"))
    }

    @Test("whenPrepared_AccountExportModel_ShouldWriteTheFileAndRemoveItWhenClosed")
    func prepareAndClose() async throws {
        let root = temporaryRoot()
        defer { AccountExportFile.purge(root: root) }
        let service = FakeProfiles()
        let model = AccountExportModel(service: service, root: root)
        await model.prepare()
        guard case .ready(let file) = model.state else {
            Issue.record("Expected a ready file, got \(model.state)")
            return
        }
        #expect(file.filename == "penny-export-2026-11-22.zip")
        #expect(file.byteCount == 2)
        #expect(try Data(contentsOf: file.url) == Data("PK".utf8))

        await model.prepare()
        #expect(service.exports == 1, "a prepared file isn't asked for again")

        model.close()
        #expect(model.state == .idle)
        #expect(!FileManager.default.fileExists(atPath: file.url.path))
    }

    @Test(
        "whenTheExportFails_AccountExportModel_ShouldSayWhyAndTryAgain",
        arguments: [
            (APIError.offline, AccountDeletionFailure.offlineMessage),
            (APIError.server(status: 500, message: nil), AccountExportModel.failedMessage),
        ])
    func failure(error: APIError, message: String) async throws {
        let root = temporaryRoot()
        defer { AccountExportFile.purge(root: root) }
        let service = FakeProfiles()
        service.failure = error
        let model = AccountExportModel(service: service, root: root)
        await model.prepare()
        #expect(model.state == .failed(message))

        service.failure = nil
        await model.prepare()
        guard case .ready = model.state else {
            Issue.record("Try again should prepare the file")
            return
        }
    }

    @Test("whenThereIsNoServer_AccountExportModel_ShouldPrepareNothing")
    func demo() async {
        let model = AccountExportModel(service: nil, root: temporaryRoot())
        await model.prepare()
        guard case .failed = model.state else {
            Issue.record("The demo has nothing to export")
            return
        }
    }

    @Test(
        "whenShown_FileSizeText_ShouldMatchTheWeb",
        arguments: [(512, "512 bytes"), (820_000, "820 KB"), (14_200_000, "14.2 MB"), (999_499, "999 KB")])
    func fileSize(bytes: Int, text: String) {
        #expect(FileSizeText.text(bytes) == text)
    }

    // MARK: Former members

    @Test("whenAMemberDeletedTheirAccount_HouseholdPeople_ShouldShowFormerMemberWithoutEmailOrInitials")
    func formerMember() throws {
        let json = #"""
            {"userId":"u-gone","email":"deleted-u-gone@deleted.invalid","joinedAt":1,"leftAt":2,"deleted":true,
             "avatarUrl":"/api/users/u-gone/avatar?v=0123456789abcdef0123456789abcdef"}
            """#
        let gone = try JSONDecoder().decode(WireHouseholdMember.self, from: Data(json.utf8))
        #expect(gone.isDeleted)
        let me = WireHouseholdMember(userId: "u-me", email: "contract-user@example.test", joinedAt: 1)
        let people = HouseholdPeople(members: [me, gone], email: me.email)
        #expect(people.name("u-gone") == "Former member")
        #expect(gone.shownName == "Former member")
        #expect(people.initials("u-gone") == "?")
        #expect(people.face("u-gone").avatarUrl == nil)
        #expect(!people.possessive("u-gone").contains("deleted.invalid"))
    }

    @Test("whenTheFlagIsAbsent_WireHouseholdMember_ShouldBeAnOrdinaryMember")
    func ordinaryMember() throws {
        let json = #"{"userId":"u-bea","email":"bea@example.test","joinedAt":1,"displayName":"Bea"}"#
        let member = try JSONDecoder().decode(WireHouseholdMember.self, from: Data(json.utf8))
        #expect(!member.isDeleted)
        #expect(member.shownName == "Bea")
    }
}
