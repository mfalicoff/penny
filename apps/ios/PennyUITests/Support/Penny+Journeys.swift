import Foundation
import PennyAccessibility
import XCTest

/// Driver steps the full-journey suites (MAZ-82) share: replacing typed
/// values, Activity search and opening an entry. Like the rest of `Penny`, everything goes
/// through identifiers; system controls without one (segments, the search field) are found
/// inside an identified parent or by their system role.
extension Penny {
    /// Replaces a text field's contents (deletes what it holds, then types `text`).
    func replaceText(_ text: String, in id: String) throws {
        let field = try wait(for: id)
        field.tap()
        let placeholder = field.placeholderValue ?? ""
        func remaining() -> String {
            let value = (field.value as? String) ?? ""
            return value == placeholder ? "" : value
        }
        // The caret lands where the tap did; deleting from there can leave text after it, so
        // check and, if needed, select everything through the edit menu and delete that.
        if !remaining().isEmpty {
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: remaining().count + 2))
        }
        for _ in 0..<2 where !remaining().isEmpty {
            field.press(forDuration: 1.0)
            let selectAll = [app.menuItems["Select All"], app.buttons["Select All"]].first {
                $0.waitForExistence(timeout: 3)
            }
            selectAll?.tap()
            field.typeText(XCUIKeyboardKey.delete.rawValue)
        }
        guard remaining().isEmpty else {
            throw UIExpectationFailed(description: "\(id) still holds \"\(remaining())\" after clearing")
        }
        field.typeText(text)
    }

    /// Replaces the entry form's amount: the keypad's delete at compact width, the text field at
    /// regular width.
    func replaceAmount(_ amount: String) throws {
        let display = try wait(for: AccessibilityID.EntryForm.amount)
        if display.elementType == .textField {
            try replaceText(amount, in: AccessibilityID.EntryForm.amount)
            return
        }
        let typed = (display.value as? String).map { $0 == "Empty" ? 0 : $0.count } ?? 0
        for _ in 0..<(typed + 1) { try tap(AccessibilityID.EntryForm.keypad("delete")) }
        try enterAmount(amount)
    }

    // MARK: Activity

    /// The search field of the current screen: Activity's own (`activity.search`, at the bottom on
    /// iPhone and under the title on iPad, MAZ-255), or a system search field, which on iPhone
    /// can sit collapsed in the navigation bar until the list is pulled down, and on iOS 26+ can
    /// also be a toolbar button that expands into the field.
    func searchField() throws -> XCUIElement {
        let activity = app.textFields.matching(identifier: AccessibilityID.Activity.search).firstMatch
        if activity.waitForExistence(timeout: 3) { return activity }
        let field = app.searchFields.firstMatch
        if field.waitForExistence(timeout: 3) { return field }
        let list = app.collectionViews.firstMatch
        if list.exists { list.swipeDown() }
        if field.waitForExistence(timeout: 3) { return field }
        let button = app.buttons["Search"]
        if button.exists { button.tap() }
        guard field.waitForExistence(timeout: Penny.timeout) else {
            throw UIExpectationFailed(description: "No search field on this screen")
        }
        return field
    }

    /// Types a query into Activity's search field.
    func search(_ query: String) throws {
        let field = try searchField()
        // A tap that lands while the list settles after a save is dropped on iPad (MAZ-195), so tap
        // until the field has keyboard focus.
        try focus(field, id: AccessibilityID.Activity.search)
        if let current = field.value as? String, !current.isEmpty, current != field.placeholderValue {
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count))
        }
        field.typeText(query)
    }

    /// Clears the search field and dismisses the search (the field's Cancel/Close button).
    func endSearch() {
        let back = app.buttons.matching(identifier: AccessibilityID.Activity.searchBack).firstMatch
        let activity = app.textFields.matching(identifier: AccessibilityID.Activity.search).firstMatch
        if activity.exists {
            if Device.isPad {
                let clear = app.buttons.matching(identifier: AccessibilityID.Activity.searchClear).firstMatch
                if clear.exists { clear.tap() }
            } else if back.exists, back.label == "Cancel search" {
                back.tap()
            }
            return
        }
        let field = app.searchFields.firstMatch
        guard field.exists else { return }
        let clear = field.buttons.firstMatch
        if clear.exists { clear.tap() }
        for label in ["Cancel", "Close"] {
            let button = app.navigationBars.buttons[label]
            if button.exists {
                button.tap()
                return
            }
        }
    }

    /// Opens a personal entry's detail from an Activity or Home row: pushed on iPhone, beside the
    /// list on iPad.
    func openEntry(_ id: String) throws {
        let row = try waitForEntry(id)
        // Beside the iPad Activity list, the entry opened before stays in the detail until the
        // selection changes, so its Edit already exists: a dropped tap then left Delete acting
        // on the wrong entry (MAZ-195). Wait for this row to be selected, tapping again if not.
        let showingAnother = element(AccessibilityID.Journeys.detailEdit).exists
        row.tap()
        if showingAnother {
            let selected = NSPredicate(format: "isSelected == true")
            var attempts = 1
            while XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: selected, object: row)], timeout: 5)
                != .completed
            {
                guard attempts < 3 else { throw UIExpectationFailed(description: "\(id) was not selected") }
                row.tap()
                attempts += 1
            }
        }
        // The detail's toolbar Edit, not `screen.entryDetail`: beside the iPad Activity list the
        // detail sits inside `screen.activity`, whose identifier replaces the detail's own.
        try wait(for: AccessibilityID.Journeys.detailEdit)
    }

    /// Edit from the entry detail's toolbar, waiting for the edit sheet.
    func editOpenEntry() throws {
        try tap(AccessibilityID.Journeys.detailEdit)
        try wait(for: AccessibilityID.Screen.editEntry)
    }

    /// Delete from the entry detail's toolbar, confirming the dialog.
    func deleteOpenEntry() throws {
        try tap(AccessibilityID.Journeys.detailDelete)
        try tap(AccessibilityID.Activity.deleteConfirm)
    }

    /// Dismisses an open confirmation dialog without choosing its action: its Cancel button
    /// where the system draws one (by identifier, else by the system's label), otherwise a tap
    /// outside it: on iOS 27 a dialog opened from a toolbar button is a popover with no Cancel,
    /// dismissed through the system's `PopoverDismissRegion`.
    func cancelDialog(_ cancelID: String, confirmID: String) throws {
        let confirm = try wait(for: confirmID)
        let cancel = element(cancelID)
        let outside = element("PopoverDismissRegion")
        if cancel.waitForExistence(timeout: 2) && cancel.isHittable {
            cancel.tap()
        } else if outside.exists {
            outside.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.92)).tap()
        } else {
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.92)).tap()
        }
        guard confirm.waitForNonExistence(timeout: Penny.timeout) else {
            throw UIExpectationFailed(description: "The dialog with \(confirmID) did not close")
        }
    }

    /// Saves the entry form and waits for the sheet to close.
    func saveEntryForm() throws {
        try tap(AccessibilityID.EntryForm.save)
        try waitForAbsence(of: AccessibilityID.Screen.addEntry, timeout: 20)
        try waitForAbsence(of: AccessibilityID.Screen.editEntry, timeout: 20)
    }

    /// Adds an entry through the form: kind, amount and title (the most used category of the
    /// kind is preselected).
    func addEntry(kind: String = "Expense", amount: String, title: String) throws {
        try openAddEntry()
        if kind != "Expense" { try selectSegment(kind, in: AccessibilityID.EntryForm.kind) }
        try enterAmount(amount)
        try type(title, into: AccessibilityID.EntryForm.title)
        try saveEntryForm()
    }

    /// The Activity totals line's spoken summary ("Recorded: spent $…, came in $…").
    func activityTotals() throws -> String {
        try wait(for: AccessibilityID.Activity.totals).label
    }
}
