import Foundation
import PennyAccessibility
import XCTest

/// Native sign-in journeys against the real API and the stack's local OIDC provider
/// (moved here from MAZ-68). Full plan.
final class AuthJourneyTests: PennyUITestCase {
    @MainActor
    func test_whenPasswordIsWrong_SignIn_ShouldShowTheErrorAndKeepTheEmail() async throws {
        let account = try await makeAccount("wrong-password")
        let penny = try await launch()

        try penny.type(account.email, into: AccessibilityID.Auth.email)
        try penny.type("not-the-password", into: AccessibilityID.Auth.password)
        try penny.tap(AccessibilityID.Auth.signIn)

        try penny.wait(for: AccessibilityID.Auth.error)
        XCTAssertEqual(try penny.value(of: AccessibilityID.Auth.email), account.email)
        XCTAssertFalse(penny.element(AccessibilityID.Screen.home).exists)
        screenshot("wrong-password")
    }

    @MainActor
    func test_whenCreatingAnAccount_CreateAccount_ShouldOpenAnEmptyHomeForAWorkingAccount() async throws {
        let stack = try await stack()
        let email = "new-\(UUID().uuidString.prefix(8).lowercased()).\(stack.configuration.runID)@penny.test"
        let password = "pw-\(UUID().uuidString)"
        let penny = try await launch()

        try penny.tap(AccessibilityID.Auth.switchMode)
        try penny.type(email, into: AccessibilityID.Auth.email)
        try penny.type(password, into: AccessibilityID.Auth.password)
        try penny.tap(AccessibilityID.Auth.createAccount)
        try penny.waitForShell()
        try penny.wait(for: AccessibilityID.Home.empty)

        // The account exists on the server with that password.
        let token = try await stack.signIn(email: email, password: password)
        XCTAssertFalse(token.isEmpty)
    }

    @MainActor
    func test_whenSingleSignOnSucceeds_SignIn_ShouldOpenTheShell() async throws {
        let stack = try await stack()
        guard stack.configuration.oidcIssuer != nil else { throw XCTSkip("The stack runs without --oidc.") }
        try await stack.setSingleSignOnProvider(["fail": NSNull(), "emailVerified": true])
        let penny = try await launch()

        try penny.tap(AccessibilityID.Auth.singleSignOn)
        // The provider approves at once and returns through penny://auth/callback.
        try penny.waitForShell(timeout: 45)
        screenshot("single-sign-on")
    }

    @MainActor
    func test_whenSingleSignOnIsCancelled_SignIn_ShouldStayAndExplain() async throws {
        let stack = try await stack()
        guard stack.configuration.oidcIssuer != nil else { throw XCTSkip("The stack runs without --oidc.") }
        // The provider shows an error page instead of approving, so the sheet stays open.
        try await stack.setSingleSignOnProvider(["fail": "authorize"])
        addTeardownBlock { @MainActor in try? await stack.setSingleSignOnProvider(["fail": NSNull()]) }
        let penny = try await launch()

        try penny.tap(AccessibilityID.Auth.singleSignOn)
        // The authentication sheet is a system view; its Cancel shows in the app's tree or
        // SpringBoard's depending on the OS.
        let deadline = Date().addingTimeInterval(30)
        var cancel: XCUIElement?
        while cancel == nil, Date() < deadline {
            cancel = [penny.app, Penny.springboard].map { $0.buttons["Cancel"] }.first { $0.exists }
            if cancel == nil { _ = penny.app.buttons["Cancel"].waitForExistence(timeout: 2) }
        }
        guard let cancel else { throw UIExpectationFailed(description: "The sign-in sheet did not open") }
        screenshot("single-sign-on-sheet")
        cancel.tap()

        try penny.wait(for: AccessibilityID.Auth.notice)
        XCTAssertTrue(penny.isShowingSignIn)
        screenshot("single-sign-on-cancelled")
    }

    /// The server ends sessions after 30 days of its time: moving its clock past that makes the
    /// relaunch ask to sign in again, with the email filled in.
    @MainActor
    func test_whenSessionExpiresWhileClosed_Relaunch_ShouldAskToSignInAgainWithTheEmail() async throws {
        let stack = try await stack()
        let account = try await makeAccount("expiry")
        let penny = try await launch()
        try penny.signIn(email: account.email, password: account.password)

        try await stack.setClock("2026-11-20T12:00:00Z")
        let relaunched = try await relaunch()
        try relaunched.wait(for: AccessibilityID.Auth.notice, timeout: 30)
        XCTAssertEqual(try relaunched.value(of: AccessibilityID.Auth.email), account.email)
        screenshot("session-expired")

        // Signing in again restores the account.
        try relaunched.type(account.password, into: AccessibilityID.Auth.password)
        try relaunched.tap(AccessibilityID.Auth.signIn)
        try relaunched.waitForShell()
    }

    /// Signing out with a change that has not synced asks first; "Sync, then sign out" keeps it.
    @MainActor
    func test_whenChangesArePending_SignOut_ShouldAskAndSyncBeforeRemovingThem() async throws {
        let stack = try await stack()
        let account = try await makeAccount("pending-signout")
        let penny = try await launch()
        try penny.signIn(email: account.email, password: account.password)

        try penny.wait(for: AccessibilityID.Home.empty)
        try penny.openSettingsPage("currency", screen: AccessibilityID.Screen.currency)
        // The ledger is loaded; from here the server drops every ledger request.
        try await stack.setFaults([.offline("/api/ledger")])
        try penny.tap(AccessibilityID.Settings.currency("EUR"))
        try penny.waitForSelection(AccessibilityID.Settings.currency("EUR"))
        try penny.openSettings()
        try penny.tap(AccessibilityID.Auth.signOut)

        let syncFirst = try penny.dialogButton("Sync, then sign out")
        screenshot("sign-out-pending")
        try await stack.clearFaults()
        syncFirst.tap()

        try penny.wait(for: AccessibilityID.Auth.email, timeout: 30)
        let ledger = try await stack.ledger(token: account.token).ledger
        XCTAssertEqual(ledger["currency"] as? String, "EUR", "The pending change was lost")
    }

    /// After signing out of one account and into another, nothing of the first shows.
    @MainActor
    func test_whenSwitchingAccounts_Shell_ShouldNotShowThePreviousAccountsData() async throws {
        let stack = try await stack()
        let first = try await makeAccount("switch-a")
        let second = try await makeAccount("switch-b")
        let entryID = "switch-\(stack.configuration.runID)-\(Device.name)"
        try await stack.addTransaction(token: first.token, id: entryID, title: "First account rent", cents: 90_000)
        let penny = try await launch()

        try penny.signIn(email: first.email, password: first.password)
        try penny.openActivity()
        try penny.waitForEntry(entryID)
        try penny.openSettings()
        try penny.tap(AccessibilityID.Auth.signOut)
        try penny.dialogButton("Sign out").tap()

        try penny.signIn(email: second.email, password: second.password)
        try penny.wait(for: AccessibilityID.Home.empty)
        try penny.openActivity()
        XCTAssertFalse(
            penny.element(AccessibilityID.Row.entry(entryID)).waitForExistence(timeout: 3),
            "The previous account's entry is visible")
        screenshot("switched-account")
    }
}
