import PennyData
import Testing

@Suite("Expo import notice in Settings")
struct ExpoImportNoticeTests {
    static func account(_ outcome: ExpoMigrationReport.LedgerOutcome) -> ExpoMigrationReport.Account {
        ExpoMigrationReport.Account(
            key: "ledger", server: "https://penny.example.test", email: "alex@example.test", outcome: outcome)
    }

    @Test(
        "whenTheImportNeedsNothing_ExpoImportNotice_ShouldShowNothing",
        arguments: [
            ExpoMigrationReport(status: .nothingToImport),
            ExpoMigrationReport(status: .finished, accounts: [account(.retired)]),
            ExpoMigrationReport(status: .waitingForSync, accounts: [account(.imported(pendingChanges: 2))]),
            ExpoMigrationReport(status: .waitingForSync, notes: [.cleanupFailed, .themeImported(.dark)]),
        ])
    func nothingToSay(report: ExpoMigrationReport) {
        #expect(ExpoImportNotice(report) == nil)
    }

    @Test("whenAnExpoRecordIsDamaged_ExpoImportNotice_ShouldSayItIsKeptAndWhatToDo")
    func damaged() throws {
        let notice = try #require(
            ExpoImportNotice(ExpoMigrationReport(status: .needsAttention, accounts: [Self.account(.unreadable)])))
        #expect(notice.title == "Some earlier entries couldn't be imported")
        #expect(notice.message.contains("kept on this device"))
        #expect(ExpoImportNotice(ExpoMigrationReport(status: .needsAttention, notes: [.storeCorrupt])) == notice)
    }

    @Test("whenTheImportMustWait_ExpoImportNotice_ShouldNameTheNextStep")
    func nextSteps() throws {
        let locked = try #require(ExpoImportNotice(ExpoMigrationReport(status: .retryLater)))
        #expect(locked.message.contains("Unlock this device"))
        let full = try #require(
            ExpoImportNotice(
                ExpoMigrationReport(status: .needsAttention, accounts: [Self.account(.blocked(.writeFailed))])))
        #expect(full.message.contains("Free some space"))
        let server = try #require(
            ExpoImportNotice(ExpoMigrationReport(status: .needsAttention, accounts: [Self.account(.unknownServer)])))
        #expect(server.message.contains("Choose the server you used"))
    }
}
