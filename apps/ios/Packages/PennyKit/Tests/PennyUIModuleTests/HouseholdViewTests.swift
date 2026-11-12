import Foundation
import PennyData
import PennyDomain
import SwiftUI
import Testing

@testable import PennyUI

/// Camera permission as the system would answer it, without a camera.
private struct FakeCamera: CameraAccess {
    var current: CameraAccessStatus
    var grants: Bool

    func status() -> CameraAccessStatus { current }
    func request() async -> Bool { grants }
}

@Suite("Household screens (MAZ-75)")
@MainActor
struct HouseholdViewTests {
    private let today = CalendarDate(year: 2026, month: 11, day: 9) ?? .earliest

    @Test("whenCameraAccessIsDenied_InviteScanner_ShouldOfferTypedEntryInstead")
    func cameraDenied() async {
        let denied = InviteScannerModel(access: FakeCamera(current: .denied, grants: false), allowsLoopbackHTTP: false)
        await denied.start()
        #expect(denied.state == .denied)
        // Asked for the first time when the scanner opens, and refused.
        let refused = InviteScannerModel(
            access: FakeCamera(current: .notDetermined, grants: false), allowsLoopbackHTTP: false)
        await refused.start()
        #expect(refused.state == .denied)
        let noCamera = InviteScannerModel(
            access: FakeCamera(current: .unavailable, grants: false), allowsLoopbackHTTP: false)
        await noCamera.start()
        #expect(noCamera.state == .unavailable)
    }

    @Test("whenCameraAccessIsGranted_InviteScanner_ShouldScanAndRejectWhatIsntAnInvite")
    func scanning() async throws {
        let scanner = InviteScannerModel(
            access: FakeCamera(current: .notDetermined, grants: true), allowsLoopbackHTTP: false)
        await scanner.start()
        #expect(scanner.state == .scanning)
        #expect(scanner.read("https://example.test/menu") == nil)
        guard case .rejected = scanner.state else {
            Issue.record("a URL that isn't an invite must be rejected")
            return
        }
        #expect(scanner.read("penny://join?code=A1B2C3D4E5&server=http%3A%2F%2Fpenny.example.test") == nil)
        #expect(scanner.state == .rejected(HouseholdStartSheet.message(.insecureServer)))
        let link = try #require(scanner.read("penny://join?code=a1b2c3d4e5&server=https%3A%2F%2Fpenny.example.test"))
        #expect(link.code.value == "A1B2C3D4E5")
        #expect(scanner.state == .scanning)
    }

    @Test("whenAnInviteArrives_InviteHandoff_ShouldOpenOnceAndWaitForTheRightServer")
    func handoff() {
        let invites = InviteHandoff(allowsLoopbackHTTP: true)
        #expect(invites.takeForShell() == nil)
        invites.receive(code: "A1B2C3D4E5", server: "https://friends.example.test")
        let taken = invites.takeForShell()
        #expect(taken?.code == "A1B2C3D4E5")
        #expect(invites.takeForShell() == nil, "an invite opens once")
        // The person chose to sign out and join on the other server: this shell leaves it alone.
        invites.keepForSignIn(code: "A1B2C3D4E5", server: "https://friends.example.test")
        #expect(invites.takeForShell() == nil)
        invites.signedIn()
        #expect(invites.takeForShell()?.server == "https://friends.example.test")
        invites.receive(code: "FFFFFFFFFF", server: nil)
        invites.clear()
        #expect(invites.invite == nil)
    }

    @Test("whenAJoinLinkIsDelivered_ShellModel_ShouldShowSharedWithTheJoinSheet")
    func joinLink() {
        let shell = ShellModel(workspace: FixedWorkspace(load: .ready(Ledger())), session: .demo, today: today)
        shell.navigate { $0.open(.join(code: "A1B2C3D4E5", server: nil)) }
        #expect(shell.route.tab == .shared)
        #expect(shell.route.householdStart == .join(code: "A1B2C3D4E5", server: nil))
    }

    @Test("whenInTheDemo_HouseholdDirectory_ShouldBeUnavailableAndAskNothing")
    func demo() async {
        let shell = ShellModel(workspace: DemoWorkspace(today: today), session: .demo, today: today, leaveDemo: {})
        #expect(!shell.households.isAvailable)
        #expect(shell.households.model(for: "h1") == nil)
        await shell.households.refresh()
        #expect(shell.households.load == .idle)
    }

    @Test("whenDescribingBalances_HouseholdText_ShouldSayWhoOwesWithoutColorAlone")
    func balances() {
        #expect(HouseholdText.balance(14250, currency: "CAD").hasPrefix("you're owed"))
        #expect(HouseholdText.balance(-3820, currency: "CAD").hasPrefix("you owe"))
        #expect(HouseholdText.balance(0, currency: "CAD") == "Settled")
        #expect(HouseholdText.memberBalance(-11040, currency: "CAD").hasSuffix("owes"))
        #expect(HouseholdText.memberBalance(14250, currency: "CAD").hasSuffix("gets back"))
        #expect(HouseholdText.recordExplanation(payer: "Jo").contains("doesn't send money"))
    }

    @Test("whenTheMonthOnScreenIsPast_SharedExpenseForm_ShouldDateANewExpenseInThatMonth")
    func defaultDate() throws {
        let october = try #require(MonthKey(year: 2026, month: 10))
        #expect(SharedExpenseFormSheet.defaultDate(MonthKey(today), today) == today)
        #expect(SharedExpenseFormSheet.defaultDate(october, today) == october.last)
    }

    @Test("whenAnInviteLinkCantBeUsed_HouseholdStartSheet_ShouldSayWhyAndWhatToDo")
    func linkMessages() {
        for problem in [InviteLink.Invalid.invalidCode, .invalidServer, .insecureServer] {
            let message = HouseholdStartSheet.message(problem)
            #expect(message.contains("Ask for a new invite"))
        }
        #expect(HouseholdStartSheet.message(.insecureServer).contains("HTTPS"))
    }
}
