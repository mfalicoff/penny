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

    /// Taps an element, scrolling the screen's list down to it when it is below the fold
    /// (lazy lists only create rows near the visible area).
    func tap(_ id: String, timeout: TimeInterval = Penny.timeout) throws {
        let target = element(id)
        if !target.waitForExistence(timeout: min(timeout, 5)) {
            let list =
                app.collectionViews.firstMatch.exists ? app.collectionViews.firstMatch : app.scrollViews.firstMatch
            for _ in 0..<4 where !target.exists && list.exists {
                list.swipeUp()
            }
        }
        try wait(for: id, timeout: timeout).tap()
    }

    func type(_ text: String, into id: String) throws {
        let field = try wait(for: id)
        field.tap()
        field.typeText(text)
        // New-password fields can drop fast input while the system's password suggestions
        // appear; a secure field shows one bullet per character, so check and retype slowly.
        guard field.elementType == .secureTextField else { return }
        let typed = (field.value as? String)?.count ?? 0
        guard typed != text.count else { return }
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: max(typed, 1)))
        // Paste instead (the edit menu's Paste is a user action: no paste prompt).
        UIPasteboard.general.string = text
        field.press(forDuration: 1.2)
        let paste = [app.menuItems["Paste"], app.buttons["Paste"]].first { $0.waitForExistence(timeout: 3) }
        if let paste {
            paste.tap()
        } else {
            for character in text { field.typeText(String(character)) }
        }
        UIPasteboard.general.string = ""
        let retyped = (field.value as? String)?.count ?? 0
        guard retyped == text.count else {
            throw UIExpectationFailed(description: "\(id) holds \(retyped) of \(text.count) typed characters")
        }
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
            try wait(for: AccessibilityID.Screen.activity, timeout: 30)
        } else {
            try selectTab("Activity", id: AccessibilityID.Tab.tab("activity"), screen: AccessibilityID.Screen.activity)
        }
    }

    /// Selects an iPhone tab and waits for its screen. A tap that lands while the floating
    /// tab bar is still settling after launch or a sheet is ignored, so it is retried.
    private func selectTab(_ title: String, id: String, screen: String) throws {
        let button = try tabButton(title, id: id)
        for _ in 0..<3 {
            button.tap()
            if element(screen).waitForExistence(timeout: 8) { return }
        }
        throw UIExpectationFailed(description: "The \(title) tab did not open \(screen)")
    }

    func openHome() throws {
        if Device.isPad {
            try tap(AccessibilityID.Sidebar.item("home"))
            try wait(for: AccessibilityID.Screen.home)
        } else {
            try closeSettings()
            try selectTab("Home", id: AccessibilityID.Tab.tab("home"), screen: AccessibilityID.Screen.home)
        }
    }

    /// Settings: the sheet from Home on iPhone, the detail column on iPad.
    func openSettings() throws {
        popSettingsPages()
        if element(AccessibilityID.Screen.settings).exists { return }
        if Device.isPad {
            try tap(AccessibilityID.Sidebar.settings)
        } else {
            try openHome()
            try tap(AccessibilityID.Home.settings)
        }
        try wait(for: AccessibilityID.Screen.settings)
    }

    private static let settingsPages = [
        AccessibilityID.Screen.appearance, AccessibilityID.Screen.currency, AccessibilityID.Screen.appLock,
        AccessibilityID.Screen.recurring, AccessibilityID.Screen.accounts, AccessibilityID.Screen.categories,
    ]

    /// Goes back from a page pushed inside Settings to the Settings list.
    private func popSettingsPages() {
        // One query for all pages: each element query costs about a second.
        let page = app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier IN %@", Self.settingsPages)).firstMatch
        for _ in 0..<3 {
            guard page.exists, !element(AccessibilityID.Screen.settings).exists else { return }
            app.navigationBars.buttons.element(boundBy: 0).tap()
        }
    }

    /// A Settings page (`SettingsRoute` raw value), from wherever the shell is.
    func openSettingsPage(_ route: String, screen: String) throws {
        try openSettings()
        try tap(AccessibilityID.Settings.row(route))
        try wait(for: screen)
    }

    /// Closes the iPhone Settings sheet if it is open (iPad has no sheet).
    func closeSettings() throws {
        guard !Device.isPad else { return }
        popSettingsPages()
        guard element(AccessibilityID.Screen.settings).exists else { return }
        try tap(AccessibilityID.Settings.done)
        try waitForAbsence(of: AccessibilityID.Screen.settings)
    }

    /// The tab bar button (`tab.<AppTab>`). Only buttons are matched: the iOS 26+ floating tab
    /// bar is exposed as a toolbar, and the identifier must not match the tab's content.
    private func tabButton(_ title: String, id: String) throws -> XCUIElement {
        let byID = app.buttons.matching(identifier: id).firstMatch
        if byID.waitForExistence(timeout: 5) { return byID }
        let button = app.tabBars.buttons[title]
        guard button.waitForExistence(timeout: Penny.timeout) else {
            throw UIExpectationFailed(description: "No \(title) tab")
        }
        return button
    }

    // MARK: Entries

    /// Opens the Add entry sheet: the tab bar's add button on iPhone, the sidebar's on iPad.
    /// A tap that lands while the floating tab bar is still settling is ignored, so it is retried.
    func openAddEntry() throws {
        let button =
            Device.isPad
            ? try wait(for: AccessibilityID.Sidebar.add) : try tabButton("Add entry", id: AccessibilityID.Tab.add)
        for _ in 0..<3 {
            button.tap()
            if element(AccessibilityID.Screen.addEntry).waitForExistence(timeout: 8) { return }
        }
        throw UIExpectationFailed(description: "Add entry did not open \(AccessibilityID.Screen.addEntry)")
    }

    /// Types an amount such as "12.34". The form shows the in-sheet keypad at compact width
    /// (iPhone, and the iPad form sheet) and a text field at regular width, so this follows
    /// whichever control the amount actually is rather than the device.
    func enterAmount(_ amount: String) throws {
        if try wait(for: AccessibilityID.EntryForm.amount).elementType == .textField {
            try type(amount, into: AccessibilityID.EntryForm.amount)
            return
        }
        // A tap that lands while the sheet is still presenting can be dropped, so the display
        // (its accessibility value is the typed amount) is checked and the entry retried once.
        let display = element(AccessibilityID.EntryForm.amount)
        for attempt in 0..<2 {
            if attempt > 0 {
                for _ in 0..<((display.value as? String)?.count ?? 0) + 1 {
                    try tap(AccessibilityID.EntryForm.keypad("delete"))
                }
            }
            for character in amount {
                try tap(AccessibilityID.EntryForm.keypad(character == "." ? "separator" : String(character)))
            }
            if display.value as? String == amount { return }
        }
        throw UIExpectationFailed(
            description: "The amount shows \(display.value as? String ?? "nothing") instead of \(amount)")
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
