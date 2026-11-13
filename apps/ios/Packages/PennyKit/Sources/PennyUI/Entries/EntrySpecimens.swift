import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

// Xcode previews of the redesign cards MAZ-73 owns, named after their cards (the iOS-native
// cards in docs/design/penny-ios). Open
// them in light and dark, at large text sizes and on iPhone and iPad. Made-up data only.

private struct EntrySpecimenHost<Content: View>: View {
    let shell: ShellModel
    @ViewBuilder let content: () -> Content

    var body: some View {
        content()
            .environment(shell)
            .environment(AppearanceModel(preferences: EphemeralDevicePreferences()))
            .environment(Specimen.lock(enabled: false))
            .tint(PennyColor.tint)
    }
}

@MainActor
private enum EntrySpecimen {
    static func demo() -> ShellModel { Specimen.shell(DemoWorkspace(today: Specimen.today), demo: true) }

    static func entry(_ shell: ShellModel, split: Bool = false) -> LedgerEntry {
        let entries = shell.workspace.load.ledger?.transactions ?? []
        return entries.first { ($0.share != $0.total) == split } ?? entries[0]
    }
}

#Preview("iphone-activity · activity") {
    let shell = EntrySpecimen.demo()
    EntrySpecimenHost(shell: shell) { NavigationStack { ActivityView() } }
}

#Preview("activity-expenses") {
    let shell = EntrySpecimen.demo()
    shell.activityFilters.kind = .expense
    return EntrySpecimenHost(shell: shell) { NavigationStack { ActivityView() } }
}

#Preview("iphone-search-empty · search-empty") {
    let shell = EntrySpecimen.demo()
    shell.activityFilters = ActivityFilters(period: .month(MonthKey(Specimen.today)), kind: .expense, query: "sushi")
    return EntrySpecimenHost(shell: shell) { NavigationStack { ActivityView() } }
}

#Preview("filters") {
    let shell = EntrySpecimen.demo()
    shell.activityFilters.kind = .expense
    return EntrySpecimenHost(shell: shell) { ActivityFiltersSheet() }
}

#Preview("iphone-add-expense · add-expense") {
    let shell = EntrySpecimen.demo()
    EntrySpecimenHost(shell: shell) { EntryFormSheet(mode: .new) }
}

#Preview("iphone-add-income · add-income") {
    let shell = EntrySpecimen.demo()
    var editor = EntryEditor(new: .income, today: Specimen.today, ledger: Specimen.ledger())
    editor.draft.title = "Payday"
    editor.draft.amount = "2250"
    editor.draft.date = Specimen.today.adding(days: 6).description
    shell.drafts.keep(editor)
    return EntrySpecimenHost(shell: shell) { EntryFormSheet(mode: .new) }
}

#Preview("add-investment") {
    let shell = EntrySpecimen.demo()
    var editor = EntryEditor(new: .investment, today: Specimen.today, ledger: Specimen.ledger())
    editor.draft.title = "TFSA contribution"
    editor.draft.amount = "200"
    shell.drafts.keep(editor)
    return EntrySpecimenHost(shell: shell) { EntryFormSheet(mode: .new) }
}

#Preview("edit-entry") {
    let shell = EntrySpecimen.demo()
    EntrySpecimenHost(shell: shell) { EntryFormSheet(mode: .edit(EntrySpecimen.entry(shell, split: true))) }
}

#Preview("iphone-entry-extras · entry-extras · repeat-picker · trip-picker") {
    let shell = EntrySpecimen.demo()
    let model = EntryFormModel(editor: EntryEditor(new: .expense, today: Specimen.today, ledger: Specimen.ledger())) {
        _, _ in nil
    }
    return EntrySpecimenHost(shell: shell) {
        NavigationStack {
            EntryExtrasView(
                model: model, upload: ReceiptUploadModel(transfers: nil) { _ in }, ledger: Specimen.ledger(), save: {})
        }
    }
}

#Preview("iphone-split · split") {
    @Previewable @State var draft = EntryDraft(
        kind: .expense, title: "Dinner with friends", amount: "74.40", date: "2026-11-09", categoryId: "food",
        split: .equal, shareInput: "3")
    EntrySplitSheet(draft: $draft, currency: "CAD")
}

#Preview("iphone-category-picker · category-picker") {
    @Previewable @State var selection = "food"
    let shell = EntrySpecimen.demo()
    EntrySpecimenHost(shell: shell) {
        EntryCategoryPickerSheet(kind: .expense, selection: $selection, ledger: Specimen.ledger(), editCategories: {})
    }
}

#Preview("account-picker") {
    @Previewable @State var selection: String? = "demo-visa"
    let shell = EntrySpecimen.demo()
    EntrySpecimenHost(shell: shell) {
        NavigationStack { EntryAccountPicker(selection: $selection, ledger: Specimen.ledger()) }
    }
}

#Preview("date-picker") {
    @Previewable @State var date = "2026-11-09"
    EntryDatePickerSheet(date: $date, today: Specimen.today)
}

#Preview("iphone-entry-detail · entry-detail") {
    let shell = EntrySpecimen.demo()
    EntrySpecimenHost(shell: shell) {
        NavigationStack { EntryDetailView(id: EntrySpecimen.entry(shell, split: true).id) }
    }
}

#Preview("iphone-delete-confirm · delete-entry") {
    @Previewable @State var target: LedgerEntry? = Specimen.ledger().transactions.first
    let shell = EntrySpecimen.demo()
    EntrySpecimenHost(shell: shell) {
        Color.clear.deleteEntryConfirmation($target)
    }
}

#Preview("save-error (entry form)") {
    let problem = WorkspaceProblem(.storage, "This device couldn't keep the entry. Free some space, then try again.")
    let shell = Specimen.shell(
        FixedWorkspace(load: .ready(Specimen.ledger()), saveFailure: .server(problem)))
    var editor = EntryEditor(new: .expense, today: Specimen.today, ledger: Specimen.ledger())
    editor.draft.title = "Groceries"
    editor.draft.amount = "48.90"
    shell.drafts.keep(editor)
    return EntrySpecimenHost(shell: shell) { EntryFormSheet(mode: .new) }
}
