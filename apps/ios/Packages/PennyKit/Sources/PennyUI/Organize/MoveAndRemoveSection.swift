import PennyDesign
import PennyDomain
import SwiftUI

/// Remove on the account and category forms (`account-form`, as the web's `organize-remove`).
/// Nothing uses the record: "Remove account". Something does: "Move them to" a record of the
/// same sort, then "Move and remove", with the note saying what uses it. With nowhere to move
/// them, the row is locked and the note says to add one first.
///
/// ```swift
/// MoveAndRemoveSection(
///     noun: "account", note: note, targets: others.map { ($0.id, $0.name) },
///     moveTo: $model.moveTo, ids: .init(moveTo: "accountForm.moveTo", ...)
/// ) { confirmingRemoval = true }
/// ```
struct MoveAndRemoveSection: View {
    /// "account" or "category".
    let noun: String
    /// What uses the record (`removalNote`); nil when nothing does.
    let note: String?
    /// The records "Move them to" offers, as id and name.
    let targets: [(id: String, name: String)]
    @Binding var moveTo: String?
    /// The identifiers, as literals each form spells out (`AccessibilityIDTests` reads them).
    let ids: IDs
    /// Asks to confirm; the form runs the removal.
    let remove: () -> Void

    struct IDs {
        let moveTo: String
        let moveAndRemove: String
        let remove: String
        let reason: String
    }

    private var inUse: Bool { note != nil }

    var body: some View {
        Section {
            if inUse, !targets.isEmpty {
                Picker("Move them to", selection: $moveTo) {
                    Text("Choose").tag(String?.none)
                    ForEach(targets, id: \.id) { target in
                        Text(target.name).tag(Optional(target.id))
                    }
                }
                .pickerStyle(.menu)
                .tint(PennyColor.secondaryLabel)
                .frame(minHeight: Metrics.minTouchTarget)
                .accessibilityIdentifier(ids.moveTo)
                Button(role: .destructive, action: remove) {
                    Label("Move and remove", systemImage: "trash")
                        .frame(maxWidth: .infinity, minHeight: Metrics.minTouchTarget)
                        // Gray until a destination is chosen, as the card draws it.
                        .foregroundStyle(moveTo == nil ? PennyColor.tertiaryLabel : PennyColor.danger)
                }
                .disabled(moveTo == nil)
                .accessibilityHint(moveTo == nil ? "Choose where to move them first" : "")
                .accessibilityIdentifier(ids.moveAndRemove)
            } else {
                Button(role: .destructive, action: remove) {
                    Label("Remove \(noun)", systemImage: inUse ? "lock" : "trash")
                        .frame(maxWidth: .infinity, minHeight: Metrics.minTouchTarget)
                }
                .disabled(inUse)
                .accessibilityHint(note ?? "")
                .accessibilityIdentifier(ids.remove)
            }
        } footer: {
            if let note {
                Text(note).frame(maxWidth: .infinity).multilineTextAlignment(.center)
                    .accessibilityIdentifier(ids.reason)
            }
        }
    }
}
