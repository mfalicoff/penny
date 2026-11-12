import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// New trip and Edit trip (`trip-form`, card `iphone-trip-form`, MAZ-76). A personal trip is
/// saved to the ledger on this device, so it works offline; Share with others creates a shared
/// trip on the server instead (you're its organizer; invite from People). The organizer of a
/// shared trip edits its name and dates here. A personal trip with no entries can be deleted.
/// Refusals point at the field and keep everything typed.
struct TripFormSheet: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.dismiss) private var dismiss
    @State private var model: TripFormModel?
    @State private var confirmDelete = false
    @FocusState private var nameFocused: Bool

    let target: TripFormModel.Target
    /// Entries on the personal trip: Delete trip is refused while there are any.
    let expenseCount: Int
    let onSaved: (TripFormModel.Saved) -> Void

    init(target: TripFormModel.Target, expenseCount: Int, onSaved: @escaping (TripFormModel.Saved) -> Void) {
        self.target = target
        self.expenseCount = expenseCount
        self.onSaved = onSaved
    }

    var body: some View {
        NavigationStack {
            Group {
                if let model {
                    form(model)
                } else {
                    Color.clear
                }
            }
            .scrollContentBackground(.hidden)
            .background(PennyColor.background)
            .inlineNavigationTitle()
        }
        .onAppear { if model == nil { model = TripFormModel(target: target, today: shell.today) } }
        .interactiveDismissDisabled(model?.isSaving ?? false)
        .accessibilityIdentifier("screen.tripForm")
    }

    private var currency: Currency { shell.workspace.load.ledger?.currency ?? .cad }

    @ViewBuilder
    private func form(_ model: TripFormModel) -> some View {
        @Bindable var model = model
        Form {
            if let failure = model.failure {
                Section {
                    StatusBanner(tone: .error, title: "Nothing was saved", message: failure)
                }
                .listRowBackground(Color.clear).listRowInsets(EdgeInsets())
                .accessibilityIdentifier("tripForm.error")
            }
            Section {
                TextField("Lisbon", text: $model.draft.name)
                    .nameEntry()
                    .focused($nameFocused)
                    .submitLabel(.done)
                    .accessibilityIdentifier("tripForm.name")
                if let problem = model.problems[.name] {
                    Text(problem).font(.footnote).foregroundStyle(PennyColor.danger)
                        .accessibilityIdentifier("tripForm.nameProblem")
                }
            } header: {
                Text("Trip name")
            }
            Section {
                DatePicker(
                    "Starts",
                    selection: Binding(
                        get: { DayText.date(model.draft.startDate) },
                        set: { model.draft.startDate = CalendarDate($0) }),
                    in: DayText.date(.earliest)...DayText.date(.latest), displayedComponents: .date
                )
                .accessibilityIdentifier("tripForm.start")
                DatePicker(
                    "Ends",
                    selection: Binding(
                        get: { DayText.date(model.draft.endDate) },
                        set: { model.draft.endDate = CalendarDate($0) }),
                    in: DayText.date(.earliest)...DayText.date(.latest), displayedComponents: .date
                )
                .accessibilityIdentifier("tripForm.end")
                if let problem = model.problems[.endDate] ?? model.problems[.startDate] {
                    Text(problem).font(.footnote).foregroundStyle(PennyColor.danger)
                        .accessibilityIdentifier("tripForm.dateProblem")
                }
                if model.isNew {
                    LabeledContent("Currency", value: currency.rawValue)
                }
            } header: {
                Text("When")
            } footer: {
                Text(TripText.datesNote)
            }
            people(model)
            if case .personal = target {
                Section {
                    Button("Delete trip", systemImage: "trash", role: .destructive) { confirmDelete = true }
                        .disabled(expenseCount > 0 || model.isSaving)
                        .accessibilityIdentifier("tripForm.delete")
                } footer: {
                    if let note = TripFormModel.deleteNote(expenseCount: expenseCount) {
                        Text(note).accessibilityIdentifier("tripForm.deleteNote")
                    }
                }
            }
        }
        .navigationTitle(model.title)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel", systemImage: "xmark") { dismiss() }
                    .disabled(model.isSaving)
                    .accessibilityIdentifier("tripForm.close")
            }
            ToolbarItem(placement: .confirmationAction) {
                Button(model.saveTitle, systemImage: "checkmark") { Task { await save(model) } }
                    .disabled(model.isSaving)
                    .accessibilityIdentifier("tripForm.save")
            }
        }
        .confirmationDialog(
            "Delete \(model.draft.trimmedName.isEmpty ? "this trip" : model.draft.trimmedName)?",
            isPresented: $confirmDelete, titleVisibility: .visible
        ) {
            Button("Delete trip", role: .destructive) { Task { await delete(model) } }
            Button("Keep trip", role: .cancel) {}
        } message: {
            Text("The trip goes away on every device. It has no entries, so nothing else changes.")
        }
        .onAppear { if model.isNew { nameFocused = true } }
    }

    @ViewBuilder
    private func people(_ model: TripFormModel) -> some View {
        @Bindable var model = model
        switch target {
        case .new:
            Section {
                Toggle("Share with others", isOn: $model.share)
                    .disabled(!shell.trips.isAvailable || model.isSaving)
                    .accessibilityIdentifier("tripForm.share")
                if model.share {
                    LabeledContent("You", value: "Organizer")
                    LabeledContent("Invite people", value: "After saving")
                }
            } header: {
                Text("People")
            } footer: {
                Text(shareNote(model))
            }
        case .shared:
            Section {
            } footer: {
                Text(
                    "Only you, the organizer, can change the name and dates. Changing them never moves an expense "
                        + "or changes anyone's share.")
            }
        case .personal(let trip):
            if trip.sharedHouseholdId != nil {
                Section {
                } footer: {
                    Text("This trip was shared. Its expenses here stay private to you.")
                }
            }
        }
    }

    private func shareNote(_ model: TripFormModel) -> String {
        if !shell.trips.isAvailable { return "The demo can't share trips. Only you see a personal trip." }
        return model.share
            ? "A shared trip in \(currency.rawValue). Everyone in it sees its shared expenses and their own share. "
                + "Creating it needs a connection."
            : "Only you see a personal trip. You can share it later; what you add before sharing stays private."
    }

    private func save(_ model: TripFormModel) async {
        let shell = self.shell
        let saved = await model.save(
            commit: { change, summary in await shell.commit(change, summary: summary) }, trips: shell.trips,
            currency: currency)
        if let saved {
            if case .shared(let household) = saved, case .shared = target {
                shell.households.update(household)
            }
            Task { await shell.refreshShared() }
            onSaved(saved)
            dismiss()
        } else if model.problems[.name] != nil {
            nameFocused = true
        }
    }

    private func delete(_ model: TripFormModel) async {
        let shell = self.shell
        if let saved = await model.delete(commit: { change, summary in await shell.commit(change, summary: summary) }) {
            onSaved(saved)
            dismiss()
        }
    }
}

/// Share trip (`share-personal-trip`, MAZ-76): a shared trip with the same name and dates,
/// linked to this personal trip. What the personal trip already has stays private: it is never
/// sent, and shows only to you under Only you. If the link can't be kept on this device, the new
/// shared trip is archived again, so nothing is left half done.
struct ShareTripSheet: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.dismiss) private var dismiss
    let trip: Trip
    let expenseCount: Int
    let currency: Currency
    let onShared: (WireHousehold) -> Void

    @State private var working = false
    @State private var failure: String?

    var body: some View {
        NavigationStack {
            Form {
                if let failure {
                    Section {
                        StatusBanner(tone: .error, title: "Not shared", message: failure)
                    }
                    .listRowBackground(Color.clear).listRowInsets(EdgeInsets())
                    .accessibilityIdentifier("shareTrip.error")
                }
                Section {
                    point(
                        "person.2", "A shared trip with the same name and dates",
                        "You're the organizer and invite people with a code. It uses \(currency.rawValue).")
                    point("lock", privateTitle, "What you added before sharing is shown only to you, under Only you.")
                        .accessibilityIdentifier("shareTrip.private")
                    point(
                        "calendar", "Balances settle by month",
                        "Like a household, each month is settled on its own. Add trip expenses afterwards to split "
                            + "them with everyone.")
                }
                Section {
                    Button {
                        Task { await share() }
                    } label: {
                        ProgressLabel(title: "Share trip", working: working)
                    }
                    .disabled(working)
                    .accessibilityIdentifier("shareTrip.confirm")
                } footer: {
                    Text("Sharing needs a connection. Nothing is sent until you choose Share trip.")
                }
            }
            .scrollContentBackground(.hidden)
            .background(PennyColor.background)
            .navigationTitle("Share \(trip.name)?")
            .inlineNavigationTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", systemImage: "xmark") { dismiss() }
                        .disabled(working)
                        .accessibilityIdentifier("shareTrip.close")
                }
            }
        }
        .interactiveDismissDisabled(working)
        .accessibilityIdentifier("screen.shareTrip")
    }

    private var privateTitle: String {
        switch expenseCount {
        case 0: "Nothing to move"
        case 1: "Your 1 expense stays private"
        default: "Your \(expenseCount) expenses stay private"
        }
    }

    private func point(_ symbol: String, _ title: String, _ detail: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol).foregroundStyle(PennyColor.tint).frame(width: 24).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.body.weight(.semibold))
                Text(detail).font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    private func share() async {
        guard !working else { return }
        working = true
        defer { working = false }
        failure = nil
        let shell = self.shell
        let outcome = await shell.trips.share(trip, currency: currency) { change, summary in
            await shell.commit(change, summary: summary)
        }
        switch outcome {
        case .shared(let household):
            Task { await shell.refreshShared() }
            onShared(household)
            dismiss()
        case .refused(let refused):
            failure = refused.message
        case .undone(let saveFailure):
            failure =
                "Penny couldn't link the trip on this device, so the shared trip was removed again and nothing "
                + "changed. \(saveFailure.message)"
        case .leftBehind(let household, _):
            failure =
                "\(household.name) was created as a shared trip, but Penny couldn't link it to your trip or remove "
                + "it again. Open it from Trips and archive it from People before sharing again."
        }
    }
}
