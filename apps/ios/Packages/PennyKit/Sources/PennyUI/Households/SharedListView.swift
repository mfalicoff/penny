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
                        Text(Self.overall(directory, currency: shell.currency))
                            .font(.subheadline)
                            .foregroundStyle(PennyColor.secondaryLabel)
                            .listRowBackground(Color.clear)
                            .accessibilityIdentifier("shared.overall")
                    }
                }
                rows("Households", directory.households.filter { $0.trip == nil }, directory)
                rows("Trips", directory.households.filter { $0.trip != nil }, directory)
                Section {
                    Button {
                        shell.route.householdStart = .join(code: nil, server: nil)
                    } label: {
                        ActionRow(
                            title: "Join with a code", detail: "Someone shared an invite code or QR code with you",
                            symbol: "qrcode.viewfinder")
                    }
                    .accessibilityIdentifier("shared.join")
                    Button {
                        shell.route.householdStart = .create
                    } label: {
                        ActionRow(
                            title: "New household", detail: "Split rent, bills and groceries every month",
                            symbol: "plus")
                    }
                    .accessibilityIdentifier("shared.create")
                } footer: {
                    Text(HouseholdText.onlineRequirement)
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
        .sheet(item: $shell.route.householdStart) { start in
            HouseholdStartSheet(start: start).environment(shell).environment(invites)
        }
        .accessibilityIdentifier("screen.shared")
    }

    @ViewBuilder
    private func rows(_ title: String, _ households: [WireHousehold], _ directory: HouseholdDirectory) -> some View {
        if !households.isEmpty {
            Section(title) {
                ForEach(households) { household in
                    NavigationLink(value: DetailRoute.household(id: household.id)) {
                        HouseholdRow(
                            household: household, balance: directory.balances[household.id],
                            initials: directory.memberInitials[household.id] ?? [])
                    }
                    .accessibilityIdentifier("shared.household.\(household.id)")
                }
            }
        }
    }

    static func overall(_ directory: HouseholdDirectory, currency: String) -> String {
        let month = HouseholdText.shortMonth(directory.currentMonth)
        let total = directory.overallBalance
        return total == 0
            ? "\(month) · all settled" : "\(month) · \(HouseholdText.balance(total, currency: currency)) overall"
    }
}

private struct ActionRow: View {
    let title: String
    let detail: String
    let symbol: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.body.weight(.semibold))
                .foregroundStyle(PennyColor.tint)
                .frame(width: 34, height: 34)
                .background(PaletteToken.tintSoft.value.color, in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.body.weight(.semibold)).foregroundStyle(PennyColor.label)
                Text(detail).font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(minHeight: Metrics.minTouchTarget)
        .accessibilityElement(children: .combine)
    }
}

private struct HouseholdRow: View {
    let household: WireHousehold
    let balance: Int64?
    let initials: [String]

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(household.name).font(.body.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 8) {
                    MonogramStack(initials: initials)
                    Text(subtitle).font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                }
            }
            Spacer(minLength: 8)
            if let balance {
                Text(HouseholdText.balance(balance, currency: household.currency))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(balance > 0 ? PennyColor.income : PennyColor.label)
                    .multilineTextAlignment(.trailing)
            }
        }
        .frame(minHeight: Metrics.minTouchTarget)
        .accessibilityElement(children: .combine)
    }

    private var subtitle: String {
        if let trip = household.trip {
            return "\(HouseholdText.day(trip.startDate)) – \(HouseholdText.day(trip.endDate))"
        }
        return household.memberCount == 1 ? "1 member" : "\(household.memberCount) members"
    }
}
