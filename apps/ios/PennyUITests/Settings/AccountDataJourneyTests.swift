import Foundation
import PennyAccessibility
import XCTest

private typealias AccountData = AccessibilityID.AccountData

/// Settings › Profile › Your data (MAZ-152) against the real API: the full export, and deleting
/// the account (a wrong password is refused, then the account is gone and sign-in says so).
final class AccountDataJourneyTests: PennyUITestCase {
    @MainActor
    private func openProfile(_ label: String) async throws -> (Penny, TestAccount) {
        let account = try await makeAccount(label)
        let penny = try await launch()
        try penny.signIn(email: account.email, password: account.password)
        try penny.wait(for: AccessibilityID.Home.empty)
        try penny.openSettings()
        try penny.tap(AccessibilityID.Settings.account, opening: AccessibilityID.Profile.screen)
        return (penny, account)
    }

    @MainActor
    func test_whenExportingAllData_ExportAll_ShouldPrepareTheZipToSaveOrShare() async throws {
        let (penny, _) = try await openProfile("export")
        try penny.tap(AccountData.exportRow, opening: AccountData.exportScreen)
        let file = try penny.wait(for: AccountData.exportFile, timeout: 60)
        XCTAssertTrue(file.label.contains("penny-export-"), file.label)
        XCTAssertTrue(file.label.contains(".zip"), file.label)
        XCTAssertTrue(file.label.contains("ready"), file.label)
        try penny.wait(for: AccountData.exportShare)
        screenshot("export-all-ready")
    }

    @MainActor
    func test_whenDeletingTheAccount_DeleteAccount_ShouldRefuseAWrongPasswordThenSignOutForGood() async throws {
        let (penny, account) = try await openProfile("delete")
        try penny.tap(AccountData.deleteRow, opening: AccountData.deleteScreen)

        try penny.type("not the password", into: AccountData.deletePassword)
        try penny.tap(AccountData.deleteConfirm)
        let error = try penny.wait(for: AccountData.deleteError, timeout: 20)
        XCTAssertTrue(error.label.contains("incorrect"), error.label)
        try penny.wait(for: AccountData.deleteScreen)

        try penny.type(account.password, into: AccountData.deletePassword)
        try penny.tap(AccountData.deleteConfirm)
        try penny.wait(for: AccountData.deletedNotice, timeout: 30)
        screenshot("account-deleted-sign-in")

        // The server no longer signs the account in.
        let stack = try await stack()
        do {
            _ = try await stack.signIn(email: account.email, password: account.password)
            XCTFail("The deleted account could still sign in")
        } catch {}
    }
}
