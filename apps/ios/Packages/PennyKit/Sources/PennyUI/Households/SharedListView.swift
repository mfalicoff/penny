import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// The Shared tab (`iphone-shared-list`, MAZ-75): households and shared trips with the viewer's
/// balance this month, then Join with a code and New household. Shared data is online-only:
/// a failed read keeps the last list and says why, with Try again.
struct SharedView: View {
    @Environment(ShellModel.self) private var shell
    @Environment(InviteHandoff.self) private var invites: InviteHandoff?
    @Environment(PushNotifications.self) private var push: PushNotifications?

    var body: some View {
        @Bindable var shell = shell
        let directory = shell.households
        List {
            Section {
                SyncBanner().listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                DemoBanner().listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                if let failure = directory.load.failure {
                    HouseholdFailureBanner(failure: failure, onList: true) {
                        Task { await directory.refresh() }
                    }
                    .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                }
            }
            .listSectionSeparator(.hidden)

            if directory.isAvailable {
                if !directory.households.isEmpty {
                    Section {
                        // The card's subtitle under the large title, the overall amount bold in its
                        // meaning color.
                        Text(Self.overallText(directory, currency: shell.currency))
                            .font(.subheadline)
                            .foregroundStyle(PennyColor.secondaryLabel)
                            .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                            .accessibilityLabel(Self.overall(directory, currency: shell.currency))
                            .accessibilityIdentifier("shared.overall")
                    }
                    .compactSectionSpacing()
                    // MAZ-79: notifications are offered here, once there is a household to hear about.
                    if let push, push.offersPrompt {
                        Section { NotificationPrompt(push: push) }
                    }
                }
                rows("Households", directory.households.filter { $0.trip == nil }, directory)
                rows("Trips", directory.households.filter { $0.trip != nil }, directory)
                Section {
                    Button {
                        shell.route.householdStart = .join(code: nil, server: nil)
                    } label: {
                        ActionRow(
                            title: "Join with a code", detail: "Someone shared an invite code with you",
                            symbol: "key")
                    }
                    .accessibilityIdentifier("shared.join")
                    Button {
                        shell.route.householdStart = .create
                    } label: {
                        ActionRow(
                            title: "New household", detail: "Split rent, bills and groceries every month",
                            symbol: "person.badge.plus")
                    }
                    .accessibilityIdentifier("shared.create")
                }
            }
        }
        .insetGroupedList()
        .overlay {
            if !directory.isAvailable {
                PennyStateView(
                    .unavailable, title: "No households in the demo",
                    message:
                        "In your account, households you create or join show up here, with what you owe and are owed.")
            } else if directory.households.isEmpty, directory.load == .loading {
                PennyStateView(.loading, title: "Loading households…")
            }
        }
        .refreshable { await directory.refresh() }
        .task { await directory.refresh() }
        .background(PennyColor.background)
        .navigationTitle("Shared")
        .toolbar {
            if directory.isAvailable {
                ToolbarItem(placement: .primaryAction) {
                    Menu("Add", systemImage: "plus") {
                        Button("New household", systemImage: "person.badge.plus") {
                            shell.route.householdStart = .create
                        }
                        Button("Join with a code", systemImage: "key") {
                            shell.route.householdStart = .join(code: nil, server: nil)
                        }
                    }
                    .neutralToolbarGlyph()
                    .accessibilityIdentifier("shared.add")
                }
            }
        }
        // A join link waits until this tab is on screen and nothing else is closing.
        .onChange(of: shell.route.pendingHouseholdStart, initial: true) { shell.presentPendingHouseholdStart() }
        .task(id: shell.route.pendingHouseholdStart) {
            // A safety net if a closing sheet never reported its dismissal.
            guard shell.route.pendingHouseholdStart != nil else { return }
            try? await Task.sleep(for: .seconds(1.5))
            shell.presentPendingHouseholdStart(force: true)
        }
        .sheet(item: $shell.route.householdStart, onDismiss: shell.sheetDismissed) { start in
            HouseholdStartSheet(start: start).environment(shell).environment(invites)
        }
        .accessibilityIdentifier("screen.shared")
    }

    @ViewBuilder
    private func rows(_ title: String, _ households: [WireHousehold], _ directory: HouseholdDirectory) -> some View {
        // Each household is its own card under the group's heading, as on `iphone-shared-list`.
        ForEach(Array(households.enumerated()), id: \.element.id) { index, household in
            Section {
                // A shared trip opens its trip page (MAZ-76).
                NavigationLink(
                    value: household.trip == nil
                        ? DetailRoute.household(id: household.id) : DetailRoute.trip(id: household.id)
                ) {
                    HouseholdRow(
                        household: household, balance: directory.balances[household.id],
                        faces: directory.memberFaces[household.id] ?? [])
                }
                .listRowInsets(EdgeInsets(top: 16, leading: 16, bottom: 16, trailing: 16))
                .accessibilityIdentifier("shared.household.\(household.id)")
            } header: {
                if index == 0 { Text(title).cardSectionHeader() }
            }
        }
    }

    static func overall(_ directory: HouseholdDirectory, currency: String) -> String {
        let month = HouseholdText.shortMonth(directory.currentMonth)
        let total = directory.overallBalance
        return total == 0
            ? "\(month) · all settled" : "\(month) · \(HouseholdText.balance(total, currency: currency)) overall"
    }

    /// "November · you're owed **$104.30** overall": the amount bold, green when owed to you.
    static func overallText(_ directory: HouseholdDirectory, currency: String) -> AttributedString {
        let total = directory.overallBalance
        var text = AttributedString("\(HouseholdText.shortMonth(directory.currentMonth)) · ")
        guard total != 0 else { return text + AttributedString("all settled") }
        var amount = AttributedString(MoneyFormat.amount(abs(total), currency: currency))
        amount.inlinePresentationIntent = .stronglyEmphasized
        amount.foregroundColor = total > 0 ? PennyColor.income : PennyColor.label
        text += AttributedString(total > 0 ? "you're owed " : "you owe ")
        return text + amount + AttributedString(" overall")
    }
}

/// An action in a list (`iphone-shared-list`'s Join with a code and New household): a soft copper
/// tile, the title in copper and a line under it.
struct ActionRow: View {
    let title: String
    let detail: String
    let symbol: String
    @ScaledMetric(relativeTo: .body) private var tile: Double = 36

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.body.weight(.medium))
                .foregroundStyle(PennyColor.tint)
                .frame(width: tile, height: tile)
                .background(
                    PaletteToken.tintSoft.value.color, in: RoundedRectangle(cornerRadius: 11, style: .continuous)
                )
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.body.weight(.semibold)).foregroundStyle(PennyColor.tintText)
                Text(detail).font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(minHeight: Metrics.minTouchTarget)
        .accessibilityElement(children: .combine)
    }
}

/// A household or shared trip on the Shared list: its neutral tile (a house, or a plane for a
/// trip), the name with the members and a detail, then the viewer's balance this month as a
/// caption over the amount ("you're owed" over a green $142.50), or Settled with a check.
private struct HouseholdRow: View {
    let household: WireHousehold
    let balance: Int64?
    let faces: [PersonFace]

    var body: some View {
        HStack(spacing: 14) {
            CategoryIcon.neutral(symbol: household.trip == nil ? "house" : "airplane", size: 48)
            VStack(alignment: .leading, spacing: 6) {
                Text(household.name).font(.body.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 8) {
                    MonogramStack(faces: faces, size: 26)
                    Text(subtitle).font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                }
            }
            Spacer(minLength: 8)
            if let balance { BalanceLabel(cents: balance, currency: household.currency) }
        }
        .accessibilityElement(children: .combine)
    }

    private var subtitle: String {
        if let trip = household.trip {
            return "\(HouseholdText.day(trip.startDate)) – \(HouseholdText.day(trip.endDate))"
        }
        return household.memberCount == 1 ? "1 member" : "\(household.memberCount) members"
    }
}

/// The viewer's balance as on `iphone-shared-list`: "you owe" or "you're owed" in small text over
/// the semibold amount (green when owed to you), or Settled with a check in the secondary color.
struct BalanceLabel: View {
    let cents: Int64
    let currency: String

    var body: some View {
        Group {
            if cents == 0 {
                Label("Settled", systemImage: "checkmark.circle")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(PennyColor.secondaryLabel)
            } else {
                VStack(alignment: .trailing, spacing: 1) {
                    Text(cents > 0 ? "you're owed" : "you owe")
                        .font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                    Text(MoneyFormat.amount(abs(cents), currency: currency))
                        .font(.body.weight(.semibold).monospacedDigit())
                        .foregroundStyle(cents > 0 ? PennyColor.income : PennyColor.label)
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(HouseholdText.balance(cents, currency: currency))
    }
}
