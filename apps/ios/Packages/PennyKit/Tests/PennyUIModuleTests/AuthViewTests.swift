import PennyData
import PennyDomain
import Testing

@testable import PennyUI

@Suite("Sign-in screens")
struct AuthViewTests {
    private let server: ServerURL? = try? ServerURL("https://penny.example.test:8443")

    @Test("whenChangesArePending_SignOutButton_ShouldSayHowManyWouldBeLost")
    func pendingWarning() {
        #expect(SignOutButton.title(pending: 2, host: "penny.example.test") == "2 changes haven’t synced")
        #expect(SignOutButton.title(pending: 1, host: "penny.example.test") == "1 change hasn’t synced")
        #expect(SignOutButton.message(pending: 2, host: "penny.example.test").contains("these 2 would be lost"))
        #expect(SignOutButton.title(pending: 0, host: "penny.example.test") == "Sign out of penny.example.test?")
        #expect(
            SignOutButton.message(pending: 0, host: "penny.example.test").contains("stay safe on penny.example.test"))
    }

    @Test("whenServerChipHasAChangeButton_ServerChip_ShouldLabelTheServerOnItsOwn")
    func chipLabel() throws {
        let server = try #require(server)
        #expect(ServerChip.label(SavedServer(server: server)) == "Server penny.example.test:8443")
        #expect(ServerChip.label(nil) == "No server chosen")
        #expect(SignInView.unremovedMessage(email: "a@example.test").contains("a@example.test"))
    }

    @Test("whenServerVerified_ServerConnectView_ShouldListItsSignInMethods")
    func methods() throws {
        let server = try #require(server)
        let sso = ServerCheck(server: server, version: "2.0.0", singleSignOn: true, singleSignOnLabel: "Company ID")
        #expect(ServerConnectView.methods(sso) == "Email · Company ID")
        let email = ServerCheck(server: server, version: "2.0.0", singleSignOn: false, singleSignOnLabel: nil)
        #expect(ServerConnectView.methods(email) == "Email")
    }

    @Test("whenServerHasAPort_ServerChip_ShouldShowHostAndPort")
    func host() throws {
        #expect(ServerText.host(try #require(server)) == "penny.example.test:8443")
    }
}
