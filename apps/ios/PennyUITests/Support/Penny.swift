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

    /// The element with an identifier. Known identifiers are looked up among elements of their
    /// type only (`Penny.elementType(of:)`): a query over every element (`.any`) reads the
    /// identifier of everything on screen, one accessibility round trip each, and on a slow CI
    /// runner a large iPad screen made that time out (MAZ-163).
    func element(_ id: String) -> XCUIElement {
        app.descendants(matching: Penny.elementType(of: id)).matching(identifier: id).firstMatch
    }

    @discardableResult
    func wait(for id: String, timeout: TimeInterval = Penny.timeout) throws -> XCUIElement {
        try wait(for: element(id), id: id, timeout: timeout)
    }

    /// Waits for an element already resolved from `id`, so callers that looked for it first do
    /// not build and evaluate the query again.
    @discardableResult
    private func wait(for element: XCUIElement, id: String, timeout: TimeInterval) throws -> XCUIElement {
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
            let list = scrollableList()
            for _ in 0..<4 where !target.exists && list.exists {
                list.swipeUp()
            }
            try wait(for: target, id: id, timeout: timeout)
        }
        target.tap()
    }

    /// The screen's list: a collection view (SwiftUI `List`), else a scroll view.
    private func scrollableList() -> XCUIElement {
        let collection = app.collectionViews.firstMatch
        return collection.exists ? collection : app.scrollViews.firstMatch
    }

    func type(_ text: String, into id: String) throws {
        let field = try wait(for: id)
        try focus(field, id: id)
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

    /// Taps a field until it has keyboard focus. A tap that lands while the screen is still
    /// settling after launch is dropped, and typing then fails with "Neither element nor any
    /// descendant has keyboard focus" (MAZ-212 saw it on `auth.email` on a CI runner).
    /// Each focus check is a snapshot, which takes seconds on a loaded iPad simulator once the
    /// keyboard is up, so wait long enough that a slow snapshot isn't taken for a dropped tap:
    /// a second tap then only adds queries to an app that's barely answering them.
    private func focus(_ field: XCUIElement, id: String) throws {
        let focused = NSPredicate(format: "hasKeyboardFocus == true")
        for _ in 0..<3 {
            field.tap()
            let result = XCTWaiter.wait(
                for: [XCTNSPredicateExpectation(predicate: focused, object: field)], timeout: 12)
            if result == .completed { return }
        }
        throw UIExpectationFailed(description: "\(id) did not take keyboard focus after three taps")
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

    /// An iPad sidebar row or button, showing the sidebar first when it is hidden: in portrait
    /// the shell starts with the detail alone (`ipad-home-portrait`), the sidebar behind the
    /// system's toggle in the navigation bar.
    @discardableResult
    func sidebarRow(_ id: String) throws -> XCUIElement {
        let row = element(id)
        if row.waitForExistence(timeout: 3), row.isHittable { return row }
        let toggle = app.navigationBars.buttons.matching(
            NSPredicate(format: "identifier == 'ToggleSidebar' OR label IN {'Show Sidebar', 'Sidebar'}")
        ).firstMatch
        if toggle.waitForExistence(timeout: 5) { toggle.tap() }
        let deadline = Date().addingTimeInterval(Penny.timeout)
        while Date() < deadline {
            if row.exists, row.isHittable { return row }
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        }
        throw UIExpectationFailed(description: "\(id) did not show in the sidebar")
    }

    func openActivity() throws {
        if Device.isPad {
            // A tap that lands while the shell is still settling after sign-in is ignored, so it
            // is retried, as in `openTrips` and `openSettings`.
            let row = try sidebarRow(AccessibilityID.Sidebar.item("activity"))
            for _ in 0..<3 {
                row.tap()
                if element(AccessibilityID.Screen.activity).waitForExistence(timeout: 10) { return }
            }
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
            try sidebarRow(AccessibilityID.Sidebar.item("home")).tap()
            try wait(for: AccessibilityID.Screen.home)
        } else {
            try closeSettings()
            try selectTab("Home", id: AccessibilityID.Tab.tab("home"), screen: AccessibilityID.Screen.home)
        }
    }

    /// Insights from Home: the Follow your money card's Insights pill on iPhone, the sidebar's
    /// Insights row on iPad (`home` and `ipad-home` cards, MAZ-254).
    func openInsights() throws {
        if Device.isPad {
            try sidebarRow(AccessibilityID.Sidebar.item("insights")).tap()
        } else {
            try tap(AccessibilityID.Home.insights)
        }
        try wait(for: AccessibilityID.Screen.insights)
    }

    /// The calendar sheet, from Home's toolbar button (MAZ-254).
    func openCalendar() throws {
        try tap(AccessibilityID.Home.calendar)
        try wait(for: AccessibilityID.Screen.calendar)
    }

    /// Settings: the sheet from Home on iPhone, the detail column on iPad.
    func openSettings() throws {
        popSettingsPages()
        if element(AccessibilityID.Screen.settings).exists { return }
        // A tap that lands while Home is still settling after sign-in or a sheet is ignored
        // (MAZ-82 saw it right after sign-in), so it is retried like the tab bar's.
        let button: XCUIElement
        if Device.isPad {
            button = try sidebarRow(AccessibilityID.Sidebar.settings)
        } else {
            try openHome()
            button = try wait(for: AccessibilityID.Home.settings)
        }
        for attempt in 0..<3 {
            // The iPad sidebar's button can report not hittable while it works; tap it the first
            // time regardless, and again only when it is still there to be tapped.
            if attempt == 0 || button.isHittable { button.tap() }
            if element(AccessibilityID.Screen.settings).waitForExistence(timeout: 8) { return }
        }
        try wait(for: AccessibilityID.Screen.settings)
    }

    private static let settingsPages = [
        AccessibilityID.Screen.appearance, AccessibilityID.Screen.currency, AccessibilityID.Screen.appLock,
        AccessibilityID.Screen.recurring, AccessibilityID.Screen.accounts, AccessibilityID.Screen.categories,
    ]

    /// Goes back from a page pushed inside Settings to the Settings list.
    private func popSettingsPages() {
        // One query for all pages (each element query costs about a second); every Settings page
        // root is a collection view (`Penny.elementType(of:)`).
        let page = app.collectionViews.matching(NSPredicate(format: "identifier IN %@", Self.settingsPages)).firstMatch
        // The navigation bar's back button by its system identifier: on iPad the first button in
        // a navigation bar can be the sidebar's Add entry, not Back.
        let back = app.navigationBars.buttons.matching(identifier: "BackButton").firstMatch
        let settings = element(AccessibilityID.Screen.settings)
        for _ in 0..<3 {
            guard page.exists, !settings.exists, back.exists else { return }
            back.tap()
        }
    }

    /// A Settings page (`SettingsRoute` raw value), from wherever the shell is.
    func openSettingsPage(_ route: String, screen: String) throws {
        // On iPad the Manage pages are sidebar rows only; the Settings list leaves them out.
        if Device.isPad, ["recurring", "accounts", "categories"].contains(route) {
            try sidebarRow(AccessibilityID.Sidebar.item(route)).tap()
            try wait(for: screen)
            return
        }
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
        // The cards' tab bar (`PennyTabBar`, MAZ-254), not the system's: found by identifier.
        let byID = app.buttons.matching(identifier: id).firstMatch
        // On iPhone, Activity's root shows its search bar in the tab bar's place (`activity` card,
        // MAZ-255): its back button (× while searching) leads back to the tabs.
        let back = app.buttons.matching(identifier: AccessibilityID.Activity.searchBack).firstMatch
        for _ in 0..<2 where !byID.waitForExistence(timeout: 2) && back.exists {
            back.tap()
        }
        guard byID.waitForExistence(timeout: Penny.timeout) else {
            throw UIExpectationFailed(description: "No \(title) tab")
        }
        return byID
    }

    // MARK: Entries

    /// Opens the Add entry sheet: the tab bar's add button on iPhone; on iPad the copper capsule
    /// of Home, Activity or Settings, whichever is shown, and ⌘N elsewhere (MAZ-254).
    /// A tap that lands while the floating tab bar is still settling is ignored, so it is retried.
    func openAddEntry() throws {
        let button: XCUIElement? =
            Device.isPad
            ? padAddEntryButton() : try tabButton("Add entry", id: AccessibilityID.Tab.add)
        for _ in 0..<3 {
            if let button { button.tap() } else { app.typeKey("n", modifierFlags: .command) }
            if element(AccessibilityID.Screen.addEntry).waitForExistence(timeout: 8) { return }
        }
        throw UIExpectationFailed(description: "Add entry did not open \(AccessibilityID.Screen.addEntry)")
    }

    /// iPad: the Add entry capsule of the screen shown (Home, Activity or Settings), or nil
    /// where there is none (⌘N then opens Add entry).
    private func padAddEntryButton() -> XCUIElement? {
        for id in [AccessibilityID.Home.add, AccessibilityID.Activity.add, AccessibilityID.Settings.add] {
            let button = app.buttons[id].firstMatch
            if button.exists, button.isHittable { return button }
        }
        return nil
    }

    /// Types an amount such as "12.34". The form shows the in-sheet keypad at compact width
    /// (iPhone, and the iPad form sheet) and a text field at regular width, so this follows
    /// whichever control the amount actually is rather than the device. The shared expense form
    /// has the same amount and keypad (`into: AccessibilityID.Households.formAmount`).
    func enterAmount(_ amount: String, into id: String = AccessibilityID.EntryForm.amount) throws {
        let target = try wait(for: id)
        if target.elementType == .textField {
            try type(amount, into: id)
            return
        }
        // iPhone income has no keypad (`iphone-add-income`, MAZ-255): its formatted amount turns
        // into a field when tapped.
        if id == AccessibilityID.EntryForm.amount, !element(AccessibilityID.EntryForm.keypad("1")).exists {
            target.tap()
            let field = app.textFields.matching(identifier: id).firstMatch
            guard field.waitForExistence(timeout: Penny.timeout) else {
                throw UIExpectationFailed(description: "The amount did not turn into a field")
            }
            try type(amount, into: id)
            return
        }
        // A tap that lands while the sheet is still presenting can be dropped, so the display
        // (its accessibility value is the typed amount) is checked and the entry retried once.
        let display = element(id)
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
        let list = scrollableList()
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
        // System dialogs' buttons have no identifier; Penny's own confirmations (sign-out, delete,
        // MAZ-255) name theirs under `signOut.` and `deleteEntry.`.
        let button = app.buttons.matching(
            NSPredicate(
                format:
                    "label == %@ AND (identifier == '' OR identifier BEGINSWITH 'signOut.' OR identifier BEGINSWITH 'deleteEntry.')",
                label)
        ).firstMatch
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

    // MARK: Element types

    /// The element type an identifier is exposed as, or `.any` when it is not known. Each entry
    /// was read from the app's accessibility hierarchy on iPhone and iPad (MAZ-163, MAZ-196); SwiftUI
    /// copies an identifier onto the children of a container, so only types that hold on both
    /// devices are listed. Add an identifier here only after checking its type in a failing test's
    /// "App UI hierarchy" attachment: with the wrong type, `wait(for:)` times out and
    /// `waitForAbsence(of:)` passes at once. Anything not listed keeps the slower `.any` query.
    static func elementType(of id: String) -> XCUIElement.ElementType {
        if let type = exactTypes[id] { return type }
        if let (_, type) = prefixTypes.first(where: { id.hasPrefix($0.prefix) }) { return type }
        return .any
    }

    private static let exactTypes: [String: XCUIElement.ElementType] = [
        AccessibilityID.Root.launch: .other,
        AccessibilityID.Screen.home: .scrollView,
        AccessibilityID.Screen.addEntry: .other,
        AccessibilityID.Screen.activity: .collectionView,
        AccessibilityID.Screen.settings: .collectionView,
        AccessibilityID.Screen.appearance: .collectionView,
        AccessibilityID.Screen.currency: .collectionView,
        AccessibilityID.Screen.appLock: .collectionView,
        AccessibilityID.Screen.recurring: .collectionView,
        AccessibilityID.Screen.accounts: .collectionView,
        AccessibilityID.Screen.categories: .collectionView,
        AccessibilityID.Auth.email: .textField,
        AccessibilityID.Auth.password: .secureTextField,
        AccessibilityID.Auth.signIn: .button,
        AccessibilityID.Home.settings: .button,
        AccessibilityID.Home.empty: .button,
        AccessibilityID.Home.calendar: .button,
        AccessibilityID.Home.insights: .button,
        AccessibilityID.Sidebar.settings: .button,
        AccessibilityID.Tab.add: .button,
        AccessibilityID.EntryForm.title: .textField,
        AccessibilityID.EntryForm.save: .button,
        AccessibilityID.EntryForm.close: .button,
        AccessibilityID.Settings.done: .button,
        AccessibilityID.Settings.row("currency"): .button,
        AccessibilityID.Settings.row("appearance"): .button,
        AccessibilityID.Settings.row("appLock"): .button,
        AccessibilityID.Settings.row("notifications"): .button,
        AccessibilityID.Settings.row("recurring"): .button,
        AccessibilityID.Settings.row("accounts"): .button,
        AccessibilityID.Settings.row("categories"): .button,
        AccessibilityID.Settings.appLockToggle: .switch,
        AccessibilityID.Settings.showCents: .switch,
        AccessibilityID.Settings.reduceTransparency: .switch,
        AccessibilityID.Settings.weekStart: .button,
        AccessibilityID.Settings.account: .button,
        // The Full plan's identifiers (MAZ-196), each read on iPhone and iPad in a full run.
        AccessibilityID.Organize.accountName: .textField,
        AccessibilityID.Organize.accountSave: .button,
        AccessibilityID.Organize.addAccount: .button,
        AccessibilityID.Journeys.searchScopeServer: .other,
        AccessibilityID.Activity.searchEmpty: .staticText,
        AccessibilityID.Activity.totals: .other,
        AccessibilityID.Settings.appLockMessage: .staticText,
        AccessibilityID.Auth.createAccount: .button,
        AccessibilityID.Auth.error: .staticText,
        AccessibilityID.Profile.signUpName: .textField,
        AccessibilityID.Auth.notice: .staticText,
        AccessibilityID.Auth.server: .other,
        AccessibilityID.Auth.signOut: .button,
        AccessibilityID.Auth.singleSignOn: .button,
        AccessibilityID.Auth.switchMode: .button,
        AccessibilityID.Overview.calendarClose: .button,
        AccessibilityID.Overview.calendarDayEntries: .staticText,
        AccessibilityID.Overview.calendarLegend: .staticText,
        AccessibilityID.Overview.calendarToday: .button,
        AccessibilityID.Organize.addCategory: .button,
        "categoryForm.moveAndRemove": .button,
        "categoryForm.moveTo": .button,
        AccessibilityID.Organize.categoryName: .textField,
        "categoryForm.removeConfirm": .button,
        AccessibilityID.Organize.categorySave: .button,
        AccessibilityID.Overview.categoryTotal: .staticText,
        AccessibilityID.Activity.deleteConfirm: .button,
        AccessibilityID.Journeys.detailDelete: .button,
        AccessibilityID.Journeys.detailEdit: .button,
        AccessibilityID.Receipt.detailRow: .button,
        AccessibilityID.Receipt.attached: .button,
        AccessibilityID.Receipt.file: .button,
        AccessibilityID.Receipt.photo: .button,
        AccessibilityID.Receipt.moreDetails: .button,
        AccessibilityID.EntryForm.kind: .segmentedControl,
        "entryForm.restoredDraft": .button,
        AccessibilityID.Home.exploreMoneyFlow: .button,
        AccessibilityID.Home.flow: .button,
        AccessibilityID.Home.hero: .staticText,
        AccessibilityID.Home.projected: .other,
        AccessibilityID.Households.month: .button,
        AccessibilityID.Households.startClose: .button,
        AccessibilityID.Households.code: .textField,
        AccessibilityID.Households.createButton: .button,
        AccessibilityID.Households.startError: .staticText,
        AccessibilityID.Households.joinButton: .button,
        AccessibilityID.Households.name: .textField,
        AccessibilityID.Households.otherServer: .staticText,
        AccessibilityID.Households.scan: .button,
        AccessibilityID.Overview.insightsComparison: .staticText,
        AccessibilityID.Lock.unlock: .button,
        AccessibilityID.Overview.flowChart: .other,
        AccessibilityID.Overview.flowDetails: .other,
        AccessibilityID.Overview.flowFocus: .other,
        AccessibilityID.Overview.flowFocusClear: .button,
        AccessibilityID.Overview.flowHint: .staticText,
        AccessibilityID.Overview.flowTable: .button,
        AccessibilityID.Overview.flowTotals: .other,
        AccessibilityID.Receipt.viewerClose: .button,
        AccessibilityID.Receipt.viewerError: .other,
        AccessibilityID.Receipt.viewerImage: .image,
        AccessibilityID.Receipt.viewerPageCount: .staticText,
        AccessibilityID.Receipt.viewerPDF: .other,
        AccessibilityID.Receipt.viewerRetry: .button,
        AccessibilityID.Receipt.viewerShare: .button,
        AccessibilityID.Receipt.dismiss: .button,
        AccessibilityID.Receipt.error: .button,
        AccessibilityID.Receipt.retry: .button,
        AccessibilityID.Organize.addSchedule: .button,
        AccessibilityID.Households.scannerDenied: .staticText,
        AccessibilityID.Households.scannerTypeCode: .button,
        AccessibilityID.Journeys.scheduleAmount: .textField,
        AccessibilityID.Organize.scheduleSave: .button,
        AccessibilityID.Journeys.scheduleTitle: .textField,
        AccessibilityID.Screen.accountForm: .other,
        AccessibilityID.Screen.calendar: .scrollView,
        AccessibilityID.Screen.categoryForm: .other,
        AccessibilityID.Screen.categorySpending: .scrollView,
        AccessibilityID.Screen.editEntry: .other,
        AccessibilityID.Screen.entryExtras: .collectionView,
        AccessibilityID.Screen.household: .other,
        AccessibilityID.Screen.householdExpense: .other,
        AccessibilityID.Households.Screen.start: .other,
        AccessibilityID.Screen.insights: .scrollView,
        AccessibilityID.Households.Screen.scanner: .other,
        AccessibilityID.Screen.lock: .other,
        AccessibilityID.Screen.moneyFlow: .scrollView,
        AccessibilityID.Receipt.screen: .other,
        AccessibilityID.Screen.scheduleForm: .other,
        AccessibilityID.Screen.shared: .collectionView,
        AccessibilityID.Trips.Screen.sharedTrip: .other,
        AccessibilityID.Screen.trip: .other,
        AccessibilityID.Screen.trips: .other,
        AccessibilityID.Trips.shareConfirm: .button,
        AccessibilityID.Households.create: .button,
        AccessibilityID.Households.join: .button,
        AccessibilityID.Trips.formClose: .button,
        AccessibilityID.Trips.formDelete: .button,
        AccessibilityID.Trips.formDeleteNote: .staticText,
        AccessibilityID.Trips.formName: .textField,
        AccessibilityID.Trips.formSave: .button,
        AccessibilityID.Trips.addExpense: .button,
        AccessibilityID.Trips.edit: .button,
        AccessibilityID.Trips.outside: .staticText,
        AccessibilityID.Trips.share: .button,
        AccessibilityID.Trips.new: .button,
        // Not rows, so not under the `schedule.` prefix below; not seen in a run.
        AccessibilityID.Organize.scheduleMore: .any,
        AccessibilityID.Cards.scheduleCadence: .any,
    ]

    private static let prefixTypes: [(prefix: String, type: XCUIElement.ElementType)] = [
        ("tab.", .button), ("keypad.", .button), ("currency.", .button), ("appearance.", .button),
        // Each sidebar row is a button carrying its identifier (MAZ-182).
        ("sidebar.", .button),
        // A transaction row is a button in Activity and Home's Recent.
        ("entry.", .button),
        // Rows, options and chart nodes the Full plan taps (MAZ-196).
        ("activity.filter.", .button), ("account.", .button), ("category.", .button), ("schedule.", .button),
        ("calendar.day.", .button), ("appLock.delay.", .button), ("moneyFlow.node.", .button),
        ("insights.category.", .button), ("household.expense.", .button),
    ]
}
