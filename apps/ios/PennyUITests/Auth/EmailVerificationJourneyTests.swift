import Foundation
import PennyAccessibility
import XCTest

private typealias Verification = AccessibilityID.EmailVerification

/// Email verification (MAZ-172) against the real API: Check your email after sign-up, Change
/// email, the Shared tab's reminder and the profile's state. Needs a stack that sends email
/// (`PENNY_STACK_SMTP=1 scripts/ios.sh ui-test …`); skipped otherwise.
final class EmailVerificationJourneyTests: PennyUITestCase {
    @MainActor
    func test_whenSigningUpOnAServerThatSendsEmail_CheckEmail_ShouldLetTheAccountChangeEmailAndContinue()
        async throws
    {
        let stack = try await stack()
        guard try await stack.sendsEmail() else { throw XCTSkip("The stack sends no email (PENNY_STACK_SMTP=1).") }
        let tag = "\(UUID().uuidString.prefix(8).lowercased()).\(stack.configuration.runID)"
        let email = "verify-\(tag)@penny.test"
        let moved = "moved-\(tag)@penny.test"
        let password = "pw-\(UUID().uuidString)"
        let penny = try await launch()

        try penny.tap(AccessibilityID.Auth.switchMode)
        try penny.type("Robin Test", into: AccessibilityID.Profile.signUpName)
        try penny.type(email, into: AccessibilityID.Auth.email)
        try penny.type(password, into: AccessibilityID.Auth.password)
        try penny.tap(AccessibilityID.Auth.createAccount)
        try penny.wait(for: Verification.checkEmailScreen, timeout: 30)
        penny.dismissSavePassword(timeout: 3)
        XCTAssertTrue(try penny.wait(for: Verification.address).label.contains(email))

        // Change email: a wrong password is refused, then the account moves to the new address.
        try penny.tap(Verification.changeEmail, opening: Verification.changeEmailScreen)
        try penny.type(moved, into: Verification.newEmail)
        try penny.type("not the password", into: Verification.password)
        try penny.tap(Verification.send)
        XCTAssertTrue(penny.app.staticTexts["Your current password is incorrect."].waitForExistence(timeout: 20))
        try penny.type(password, into: Verification.password)
        try penny.tap(Verification.send)
        try penny.waitForAbsence(of: Verification.changeEmailScreen, timeout: 20)
        let address = try penny.wait(for: Verification.address)
        XCTAssertTrue(address.waitForLabel(containing: moved, timeout: 20))
        _ = try await stack.signIn(email: moved, password: password)

        // Continue: the Shared tab reminds, and sharing stays available.
        try penny.tap(Verification.continueToPenny)
        try penny.waitForShell()
        try penny.openShared()
        try penny.wait(for: Verification.reminder, timeout: 20)
        try penny.wait(for: AccessibilityID.Households.create)

        // Opening the link (here the test control) verifies the address.
        try await stack.markEmailVerified(moved)
        try penny.openSettings()
        try penny.tap(AccessibilityID.Settings.account, opening: AccessibilityID.Profile.screen)
        // Profile reads the account again when it opens: the Sign-in row now says Verified.
        let row = try penny.wait(for: AccessibilityID.Profile.signIn, timeout: 20)
        XCTAssertTrue(row.waitForLabel(containing: "Verified", timeout: 20))
        XCTAssertFalse(row.label.contains("Not verified"))
    }
}
