import Foundation
import PennyAccessibility
import XCTest

/// A UI expectation that did not hold. Helpers throw it rather than calling `XCTFail`, so an
/// async test stops at the first failure (XCTest cannot stop async code after `XCTFail`).
struct UIExpectationFailed: Error, CustomStringConvertible {
    let description: String
}

/// Drives Penny through stable accessibility identifiers (`AccessibilityID`), hiding the
/// iPhone/iPad differences: the tab bar and Settings sheet on iPhone, the sidebar and detail
/// column on iPad.
@MainActor
struct Penny {
    let app: XCUIApplication

    static let timeout: TimeInterval = 15

    func element(_ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    @discardableResult
    func wait(for id: String, timeout: TimeInterval = Penny.timeout) throws -> XCUIElement {
        let element = element(id)
        guard element.waitForExistence(timeout: timeout) else {
            throw UIExpectationFailed(description: "\(id) did not appear within \(Int(timeout))s")
        }
        return element
    }

    func waitForAbsence(of id: String, timeout: TimeInterval = Penny.timeout) throws {
        guard element(id).waitForNonExistence(timeout: timeout) else {
            throw UIExpectationFailed(description: "\(id) is still showing after \(Int(timeout))s")
        }
    }

    func tap(_ id: String, timeout: TimeInterval = Penny.timeout) throws {
        try wait(for: id, timeout: timeout).tap()
    }

    func type(_ text: String, into id: String) throws {
        let field = try wait(for: id)
        field.tap()
        field.typeText(text)
    }

    /// The text a field holds.
    func value(of id: String) throws -> String? {
        try wait(for: id).value as? String
    }

    // MARK: Signed out

    /// Signs in with the password form and waits for the shell.
    func signIn(email: String, password: String) throws {
        try type(email, into: AccessibilityID.Auth.email)
        try type(password, into: AccessibilityID.Auth.password)
        try tap(AccessibilityID.Auth.signIn)
        try waitForShell()
    }

    func waitForShell(timeout: TimeInterval = 30) throws {
        try wait(for: AccessibilityID.Screen.home, timeout: timeout)
    }

    var isShowingSignIn: Bool { element(AccessibilityID.Auth.signIn).exists }

    // MARK: Shell navigation

    func openActivity() throws {
        if Device.isPad {
            try tap(AccessibilityID.Sidebar.item("activity"))
        } else {
            try tabButton("Activity", id: AccessibilityID.Tab.tab("activity")).tap()
        }
        try wait(for: AccessibilityID.Screen.activity)
    }

    func openHome() throws {
        if Device.isPad {
            try tap(AccessibilityID.Sidebar.item("home"))
        } else {
            try closeSettings()
            try tabButton("Home", id: AccessibilityID.Tab.tab("home")).tap()
        }
        try wait(for: AccessibilityID.Screen.home)
    }

    /// Settings: the sheet from Home on iPhone, the detail column on iPad.
    func openSettings() throws {
        if Device.isPad {
            try tap(AccessibilityID.Sidebar.settings)
        } else if !element(AccessibilityID.Screen.settings).exists {
            try openHome()
            try tap(AccessibilityID.Home.settings)
        }
        try wait(for: AccessibilityID.Screen.settings)
    }

    /// A Settings page (`SettingsRoute` raw value), from wherever the shell is.
    func openSettingsPage(_ route: String, screen: String) throws {
        try openSettings()
        try tap(AccessibilityID.Settings.row(route))
        try wait(for: screen)
    }

    /// Closes the iPhone Settings sheet if it is open (iPad has no sheet).
    func closeSettings() throws {
        guard !Device.isPad, element(AccessibilityID.Screen.settings).exists else { return }
        let done = element(AccessibilityID.Settings.done)
        if !done.exists {
            // On a pushed page: go back to the Settings list first.
            app.navigationBars.buttons.firstMatch.tap()
        }
        try tap(AccessibilityID.Settings.done)
        try waitForAbsence(of: AccessibilityID.Screen.settings)
    }

    /// The tab bar button: SwiftUI does not always carry a `Tab`'s identifier onto the
    /// system tab bar item, so the label is the fallback (tab titles are fixed copy).
    private func tabButton(_ title: String, id: String) throws -> XCUIElement {
        let byID = element(id)
        if byID.exists, byID.isHittable { return byID }
        let button = app.tabBars.buttons[title]
        guard button.waitForExistence(timeout: Penny.timeout) else {
            throw UIExpectationFailed(description: "No \(title) tab")
        }
        return button
    }

    // MARK: Data on screen

    /// Waits for an entry row, pulling to refresh while the background sync catches up.
    @discardableResult
    func waitForEntry(_ id: String, timeout: TimeInterval = 30) throws -> XCUIElement {
        let row = element(AccessibilityID.Row.entry(id))
        let deadline = Date().addingTimeInterval(timeout)
        while !row.waitForExistence(timeout: 3) {
            guard Date() < deadline else {
                throw UIExpectationFailed(description: "Entry \(id) did not appear within \(Int(timeout))s")
            }
            pullToRefresh()
        }
        return row
    }

    func pullToRefresh() {
        let list = app.collectionViews.firstMatch.exists ? app.collectionViews.firstMatch : app.scrollViews.firstMatch
        guard list.exists else { return }
        let top = list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2))
        top.press(forDuration: 0.05, thenDragTo: list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8)))
    }

    /// Whether a selectable row (currency, appearance) shows as selected.
    func isSelected(_ id: String) throws -> Bool {
        try wait(for: id).isSelected
    }

    /// Waits until a selectable row shows as selected.
    func waitForSelection(_ id: String, timeout: TimeInterval = Penny.timeout) throws {
        let element = try wait(for: id)
        let selected = NSPredicate(format: "isSelected == true")
        let result = XCTWaiter.wait(
            for: [XCTNSPredicateExpectation(predicate: selected, object: element)], timeout: timeout)
        guard result == .completed else { throw UIExpectationFailed(description: "\(id) did not become selected") }
    }

    /// A button in a confirmation dialog or alert, by its label (dialog buttons are system
    /// controls without identifiers). Skips the element that opened the dialog when it has the
    /// same label.
    func dialogButton(_ label: String) throws -> XCUIElement {
        let button = app.buttons.matching(NSPredicate(format: "label == %@ AND identifier == ''", label)).firstMatch
        guard button.waitForExistence(timeout: Penny.timeout) else {
            throw UIExpectationFailed(description: "No \"\(label)\" dialog button")
        }
        return button
    }

    // MARK: System UI

    /// SpringBoard, for system alerts and sheets outside the app's process.
    static var springboard: XCUIApplication { XCUIApplication(bundleIdentifier: "com.apple.springboard") }

    /// Taps `button` on a system alert (a permission prompt and the like) if one appears, from
    /// SpringBoard or the app. Returns whether it did.
    @discardableResult
    func acceptSystemAlert(_ button: String, timeout: TimeInterval = 5) -> Bool {
        for source in [Penny.springboard, app] {
            let alert = source.alerts.firstMatch
            if alert.waitForExistence(timeout: timeout), alert.buttons[button].exists {
                alert.buttons[button].tap()
                return true
            }
        }
        return false
    }
}
