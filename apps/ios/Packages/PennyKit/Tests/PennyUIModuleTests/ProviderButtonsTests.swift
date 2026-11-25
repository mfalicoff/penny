import Foundation
import PennyData
import SwiftUI
import Testing

@testable import PennyUI

/// MAZ-170: the sign-in provider buttons, their placement, the profile's provider mark and the
/// Sign in with Apple switch.
@Suite("Sign-in provider buttons")
struct ProviderButtonsTests {
    private let apple = SignInProvider(id: "apple", label: "Apple", icon: "apple", native: true)
    private let google = SignInProvider(id: "google", label: "Google", icon: "google")
    private let sso = SignInProvider(id: "sso", label: "Acme ID", icon: "sso")
    private let other = SignInProvider(id: "partner", label: "Partner login", icon: "partner")

    @Test("whenAppleOrGoogle_ProviderText_ShouldFollowTheirButtonRules")
    func brandWords() {
        let all = [apple, google, sso]
        #expect(ProviderText.action(apple, creating: false, among: all) == "Sign in with Apple")
        #expect(ProviderText.action(google, creating: true, among: all) == "Sign up with Google")
        #expect(ProviderText.accessibilityLabel(google, creating: false, among: all) == "Sign in with Google")
    }

    @Test("whenOneSingleSignOn_ProviderText_ShouldSayContinueWithSSOAndNameItToVoiceOver")
    func loneSSO() {
        let all = [apple, google, sso]
        #expect(ProviderText.action(sso, creating: false, among: all) == "Continue with SSO")
        #expect(ProviderText.action(sso, creating: true, among: [sso]) == "Continue with SSO")
        #expect(ProviderText.accessibilityLabel(sso, creating: false, among: all) == "Continue with SSO, Acme ID")
    }

    @Test("whenSeveralSingleSignOns_ProviderText_ShouldNameEachSoTheyCanBeToldApart")
    func severalSSO() {
        let all = [sso, other]
        #expect(ProviderText.action(sso, creating: false, among: all) == "Continue with Acme ID")
        #expect(ProviderText.action(other, creating: false, among: all) == "Continue with Partner login")
        #expect(ProviderText.accessibilityLabel(other, creating: false, among: all) == "Continue with Partner login")
    }

    @Test("whenAppleOrGoogleIsListed_ProviderText_ShouldLeadWithTheProviders")
    func placement() {
        #expect(ProviderText.leads([sso, google]))
        #expect(ProviderText.leads([apple]))
        #expect(!ProviderText.leads([sso]))
        #expect(!ProviderText.leads([sso, other]))
        #expect(!ProviderText.leads([]))
    }

    @Test("whenCancelled_SignInView_ShouldOfferTheOtherWayIn")
    func cancelled() {
        #expect(
            SignInView.cancelledNotice(apple)
                == "Sign-in with Apple was cancelled. You can try again or use your email.")
        #expect(
            SignInView.cancelledNotice(sso) == "Single sign-on was cancelled. You can try again or use your password.")
    }

    @Test("whenAccountSignsInWithAProvider_ProfileText_ShouldPickItsMark")
    func profileMark() {
        let google = WireProfile(userId: "u", email: "a@example.test", signIn: "oidc", providerIcon: "google")
        #expect(ProfileText.brandMark(google) == .google)
        let apple = WireProfile(userId: "u", email: "a@example.test", signIn: "oidc", providerIcon: "apple")
        #expect(ProfileText.brandMark(apple) == .apple)
        let sso = WireProfile(userId: "u", email: "a@example.test", signIn: "oidc", providerIcon: "sso")
        #expect(ProfileText.brandMark(sso) == nil)
        let unconfigured = WireProfile(userId: "u", email: "a@example.test", signIn: "oidc")
        #expect(ProfileText.brandMark(unconfigured) == nil)
        let password = WireProfile(userId: "u", email: "a@example.test", providerIcon: "google")
        #expect(ProfileText.brandMark(password) == nil)
    }

    @Test("whenTheBuildSettingIsRead_AppleSignIn_ShouldBeOnOnlyForYes")
    func appleSwitch() {
        #expect(AppleSignInAuthenticator.isEnabled("YES"))
        #expect(AppleSignInAuthenticator.isEnabled(true))
        #expect(!AppleSignInAuthenticator.isEnabled("NO"))
        #expect(!AppleSignInAuthenticator.isEnabled(""))
        #expect(!AppleSignInAuthenticator.isEnabled("$(PENNY_SIGN_IN_WITH_APPLE)"))
        #expect(!AppleSignInAuthenticator.isEnabled(nil))
    }

    @Test("whenReadingTheCardsPaths_SVGShape_ShouldSplitNumbersAndCommands")
    func tokens() {
        #expect(
            SVGShape.tokens("M1.5-2c.3.4-1e2 0z")
                == [
                    .command("M"), .number(1.5), .number(-2), .command("c"), .number(0.3), .number(0.4),
                    .number(-100), .number(0), .command("z"),
                ])
    }

    @Test("whenDrawingTheMarks_SVGShape_ShouldFillTheirBox")
    func bounds() {
        let rect = CGRect(x: 0, y: 0, width: 19, height: 19)
        let google = SVGShape(viewBox: 48, paths: ProviderMark.google.map(\.path)).path(in: rect).boundingRect
        #expect(abs(google.minX) < 0.01 && abs(google.minY) < 0.01)
        #expect(abs(google.maxX - 19 * 46.98 / 48) < 0.05 && abs(google.maxY - 19) < 0.01)
        let apple = SVGShape(viewBox: 24, paths: [ProviderMark.apple]).path(in: rect).boundingRect
        // The logo spans y 2.96 to 21.08 of its 24-unit box, so about 14.3 of 19 points.
        #expect(abs(apple.height - 19 * (21.08 - 2.96) / 24) < 0.3 && apple.width > 11 && rect.contains(apple))
        // Relative horizontal and vertical lines, and a smooth curve, land where the card puts them.
        let lines = SVGShape.parse("M0 0h10v5H2V1z").boundingRect
        #expect(lines == CGRect(x: 0, y: 0, width: 10, height: 5))
    }
}
