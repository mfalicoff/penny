import Foundation
import PennyAccessibility
import XCTest

/// One card's data state from contracts/fixtures/redesign-states.json (MAZ-132): the scenario
/// and alias to seed, the view, the appearances to capture, and any fault or stale write.
struct CardState {
    let id: String
    let platform: String
    let appearances: [String]
    let scenario: String?
    let alias: String?
    let client: String?
    let view: String
    let fault: [String: Any]?
    let staleWrite: [String: Any]?
    let blockedBy: String?
    let search: String?

    var signedOut: Bool { client == "signed-out" }

    static func load(_ id: String) throws -> CardState {
        let file = try Checkout.json("contracts/fixtures/redesign-states.json")
        guard
            let state = (file["states"] as? [[String: Any]])?.first(where: { $0["specimen"] as? String == id }),
            let platform = state["platform"] as? String, let appearances = state["appearances"] as? [String],
            let view = state["view"] as? String
        else { throw StackError.malformed("redesign state \(id)") }
        return CardState(
            id: id, platform: platform, appearances: appearances, scenario: state["scenario"] as? String,
            alias: state["as"] as? String, client: state["client"] as? String, view: view,
            fault: state["fault"] as? [String: Any], staleWrite: state["staleWrite"] as? [String: Any],
            blockedBy: state["blockedBy"] as? String,
            search: (state["search"] as? [String: Any])?["query"] as? String)
    }
}

/// What a card's `open` step gets: the app at the signed-in shell (or the signed-out screen),
/// the seeded scenario, the stack, and which appearance this pass captures.
@MainActor
struct CardContext {
    let penny: Penny
    let state: CardState
    let stack: Stack
    let seed: SeedContext?
    let appearance: String
    let early = EarlyCapture()

    /// Captures the screen now, for a state too short-lived to wait for (the 4-second saved
    /// toast: an element query after the save can outlast it). The harness then keeps this shot.
    func captureNow() {
        early.screenshot = XCUIScreen.main.screenshot()
    }

    var app: XCUIApplication { penny.app }

    func seeded() throws -> SeedContext {
        guard let seed else { throw StackError.malformed("card \(state.id) has no scenario") }
        return seed
    }

    /// The card's fault (`fault` in redesign-states.json) as a stack rule.
    func applyFault() async throws {
        guard let fault = state.fault else { return }
        let rule = FaultRule(
            method: fault["method"] as? String, pathPrefix: fault["pathPrefix"] as? String ?? "/",
            status: fault["status"] as? Int, abort: fault["abort"] as? Bool ?? false,
            delayMs: fault["delayMs"] as? Int, times: fault["times"] as? Int)
        try await stack.setFaults([rule])
    }

    /// The card's stale write: a second device sends each request; the statuses are checked.
    /// `acceptedOnly` sends just the requests expected to succeed, so the app makes the stale one.
    func performStaleWrite(as alias: String, acceptedOnly: Bool = false) async throws {
        guard let write = state.staleWrite, let method = write["method"] as? String,
            let path = write["path"] as? String, let requests = write["requests"] as? [[String: Any]]
        else { throw StackError.malformed("card \(state.id) has no staleWrite") }
        let seed = try seeded()
        let resolvedPath = try seed.resolve(path)
        let token = try seed.user(alias).token
        for request in requests {
            let body = try seed.resolve(request["body"] ?? [:]) as? [String: Any]
            let expected = request["expectStatus"] as? Int ?? 200
            if acceptedOnly && !(200..<300).contains(expected) { continue }
            do {
                _ = try await stack.api(method, resolvedPath, body: body, token: token)
                guard (200..<300).contains(expected) else {
                    throw UIExpectationFailed(description: "\(method) \(path) succeeded; expected \(expected)")
                }
            } catch StackError.status(_, let status, _) {
                guard status == expected else {
                    throw UIExpectationFailed(description: "\(method) \(path) answered \(status); expected \(expected)")
                }
            }
        }
    }
}

/// A screenshot taken inside a card's `open` step (`CardContext.captureNow`).
@MainActor
final class EarlyCapture {
    var screenshot: XCUIScreenshot?
}

/// Card capture outcome, written next to the screenshots as `card-<id>.json` and merged into
/// test-results/cards/ios/report.json by scripts/card-report.mjs.
enum CardStatus: String {
    case captured, notBuilt = "not-built", blocked
}

/// Captures the native app in each redesign card's state (MAZ-122, docs/design/penny-ios): seed
/// the card's scenario as its alias, pin the clock, sign in, open the view and take one
/// screenshot per appearance (`card-<id>-<appearance>`, kept on success).
class CardTestCase: PennyUITestCase {
    override func tearDown() async throws {
        await MainActor.run {
            XCUIDevice.shared.appearance = .light
            XCUIDevice.shared.orientation = .portrait
        }
        try await super.tearDown()
    }

    /// Opens and captures one card. `open` starts at the signed-in shell (Home) or, for
    /// signed-out cards, at the sign-in screen, and leaves the app showing the card's state.
    /// `freshSeedPerAppearance` reseeds and signs in again before each appearance, for cards whose
    /// steps change the seeded data (a payment, an edit). `followsSystem` keeps Appearance on
    /// System (the device's appearance still picks light or dark), for cards that show the
    /// setting; `standInFaceID` answers Face ID with the Debug stand-in, so the lock can be on.
    /// `portrait` captures an iPad card upright, for the cards drawn in portrait (`ipad-home-portrait`).
    @MainActor
    func card(
        _ id: String, freshSeedPerAppearance: Bool = false, followsSystem: Bool = false,
        standInFaceID: Bool = false, portrait: Bool = false, note: String? = nil,
        open: (CardContext) async throws -> Void
    ) async throws {
        let state = try CardState.load(id)
        try requireDevice(state)
        if let blockedBy = state.blockedBy {
            record(state, status: .blocked, note: blockedBy)
            return
        }
        let stack = try await stack()
        var seed: SeedContext?
        for (index, appearance) in state.appearances.enumerated() {
            if let scenario = state.scenario, seed == nil || freshSeedPerAppearance {
                try await stack.clearFaults()
                seed = try await stack.seed(scenario)
            }
            let signsIn = !state.signedOut && (index == 0 || freshSeedPerAppearance)
            XCUIDevice.shared.appearance = appearance == "dark" ? .dark : .light
            // The iPad cards are drawn in landscape (1290×914 in contracts/design-baseline.json),
            // except the few drawn in portrait.
            if state.platform == "iPad" { XCUIDevice.shared.orientation = portrait ? .portrait : .landscapeLeft }
            var options = LaunchOptions()
            options.seed = ContainerSeed(standardDefaults: ["penny.appearance": followsSystem ? "system" : appearance])
            options.standInFaceID = standInFaceID
            // A card that shows System selected is drawn in each appearance: System shows it.
            if followsSystem { options.systemAppearance = appearance }
            options.resetsState = state.signedOut || signsIn
            let penny = try await launch(options)
            if signsIn, let alias = state.alias, let user = seed?.users[alias] {
                try penny.wait(for: AccessibilityID.Auth.email, timeout: 30)
                try penny.signIn(email: user.email, password: user.password)
                penny.dismissSavePassword(timeout: 3)
            } else if !state.signedOut {
                try penny.waitForShell()
            }
            let context = CardContext(penny: penny, state: state, stack: stack, seed: seed, appearance: appearance)
            try await open(context)
            if let shot = context.early.screenshot {
                capture("card-\(id)-\(appearance)", shot)
            } else {
                penny.dismissSavePassword(timeout: 0.5)
                capture("card-\(id)-\(appearance)", XCUIScreen.main.screenshot())
            }
            app.terminate()
        }
        try await stack.clearFaults()
        record(state, status: .captured, note: note)
    }

    /// A card whose screen or state the native app does not have yet; recorded, not failed.
    @MainActor
    func notBuilt(_ id: String, note: String) throws {
        let state = try CardState.load(id)
        try requireDevice(state)
        record(state, status: .notBuilt, note: note)
    }

    /// A card whose state the harness cannot reach (`blockedBy` cards go through `card`).
    @MainActor
    func blocked(_ id: String, note: String) throws {
        let state = try CardState.load(id)
        try requireDevice(state)
        record(state, status: .blocked, note: note)
    }

    @MainActor
    private func requireDevice(_ state: CardState) throws {
        switch state.platform {
        case "iPhone" where Device.isPad: throw XCTSkip("\(state.id) is an iPhone card")
        case "iPad" where !Device.isPad: throw XCTSkip("\(state.id) is an iPad card")
        default: break
        }
    }

    @MainActor
    private func capture(_ name: String, _ screenshot: XCUIScreenshot) {
        // A landscape screenshot is stored as portrait pixels with an orientation tag; redraw it
        // upright so tools that ignore the tag compare it with the landscape iPad baselines.
        let image = screenshot.image
        let format = UIGraphicsImageRendererFormat()
        format.scale = image.scale
        let upright = UIGraphicsImageRenderer(size: image.size, format: format).image { _ in image.draw(at: .zero) }
        let attachment =
            upright.pngData().map { XCTAttachment(data: $0, uniformTypeIdentifier: "public.png") }
            ?? XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor
    private func record(_ state: CardState, status: CardStatus, note: String?) {
        let report: [String: Any] = [
            "id": state.id, "status": status.rawValue, "device": Device.name, "view": state.view,
            "appearances": state.appearances, "note": note ?? "",
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: report, options: [.sortedKeys]) else { return }
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = "card-\(state.id)-report"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}

@MainActor
extension Penny {
    /// Chooses a month in the toolbar's month menu (`home.month`, on Home and Activity), by its
    /// long title such as "September 2026".
    func selectMonth(_ title: String) throws {
        let menu = try wait(for: AccessibilityID.Home.month)
        for _ in 0..<3 {
            menu.tap()
            let item = app.buttons[title].firstMatch
            if item.waitForExistence(timeout: 4) {
                item.tap()
                // The menu's label is the month alone ("September").
                let month = String(title.split(separator: " ").first ?? "")
                if menu.waitForLabel(containing: month, timeout: 5) { return }
            }
        }
        throw UIExpectationFailed(description: "The month menu did not choose \(title)")
    }

    /// Activity's month, stepped back in Filters (the period is a chip, not a menu, MAZ-255).
    func selectActivityMonth(_ title: String) throws {
        try tap(AccessibilityID.Activity.filters)
        try wait(for: "screen.activityFilters")
        for _ in 0..<24 where !app.staticTexts[title].exists {
            try tap("filters.month.previous")
        }
        guard app.staticTexts[title].waitForExistence(timeout: 5) else {
            throw UIExpectationFailed(description: "Filters did not reach \(title)")
        }
        try tap("filters.done")
        try waitForAbsence(of: "screen.activityFilters")
    }

    /// The Trips tab (iPhone) or sidebar row (iPad).
    func openTrips() throws {
        if Device.isPad {
            let row = try sidebarRow(AccessibilityID.Sidebar.item("trips"))
            for _ in 0..<3 {
                row.tap()
                if element(AccessibilityID.Screen.trips).waitForExistence(timeout: 8) { return }
            }
        } else {
            let tab = app.buttons.matching(identifier: AccessibilityID.Tab.tab("trips")).firstMatch
            // The cards' tab bar (`PennyTabBar`, MAZ-254) is found by its identifier.
            guard tab.waitForExistence(timeout: Penny.timeout) else {
                throw UIExpectationFailed(description: "No Trips tab")
            }
            let button = tab
            for _ in 0..<3 {
                button.tap()
                if element(AccessibilityID.Screen.trips).waitForExistence(timeout: 8) { return }
            }
        }
        try wait(for: AccessibilityID.Screen.trips, timeout: 20)
    }

    /// Opens a household from the Shared list, refreshing while the first sync arrives.
    func openHousehold(_ id: String) throws {
        try openShared()
        try waitAfterRefresh(for: AccessibilityID.Households.row(id), on: AccessibilityID.Screen.shared)
        try tap(AccessibilityID.Households.row(id), opening: AccessibilityID.Screen.household)
    }

    /// Dismisses the keyboard by tapping a neutral spot near the top of the screen.
    func hideKeyboard() {
        guard app.keyboards.firstMatch.exists else { return }
        // The iPad keyboard's own key (a tap outside the form sheet could close the sheet).
        let hide = app.keyboards.buttons["Hide keyboard"]
        if hide.exists {
            // By coordinate: XCTest can fail to scroll the key "to visible" under a sheet (MAZ-182).
            hide.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            _ = app.keyboards.firstMatch.waitForNonExistence(timeout: 3)
            return
        }
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.12)).tap()
        // Screens without a tap-to-dismiss: a downward drag dismisses it in a scroll view.
        if !app.keyboards.firstMatch.waitForNonExistence(timeout: 2) {
            // Above the keyboard: a drag across its keys starts the system's slide-to-type tip.
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.15))
                .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.45)))
            _ = app.keyboards.firstMatch.waitForNonExistence(timeout: 2)
        }
        // The keyboard's one-time "slide to type" tip, if it showed.
        let tip = app.keyboards.buttons["Continue"]
        if tip.exists { tip.tap() }
    }
}

extension XCUIElement {
    /// Waits until the element's label contains `text`.
    func waitForLabel(containing text: String, timeout: TimeInterval) -> Bool {
        let predicate = NSPredicate(format: "label CONTAINS %@", text)
        return XCTWaiter.wait(
            for: [XCTNSPredicateExpectation(predicate: predicate, object: self)], timeout: timeout) == .completed
    }
}
