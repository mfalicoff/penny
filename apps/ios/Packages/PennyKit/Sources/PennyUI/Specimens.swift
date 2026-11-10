import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

// Xcode previews of the redesign cards this issue owns (MAZ-69). Each preview is named after
// its card in contracts/design-baseline.json; open them in light and dark, at large text
// sizes and on iPhone and iPad from Xcode's preview canvas. They use made-up data only.

@MainActor
enum Specimen {
    static let today = CalendarDate(year: 2026, month: 11, day: 9) ?? .earliest

    static func shell(_ workspace: any LedgerWorkspace, demo: Bool = false) -> ShellModel {
        ShellModel(
            workspace: workspace, session: .demo, today: today, startDemo: demo ? nil : {},
            leaveDemo: demo ? {} : nil)
    }

    static func ledger() -> Ledger { DemoLedger.make(today: today) }

    static func lock(enabled: Bool = true) -> AppLockController {
        AppLockController(store: EphemeralAppLockSettingStore(enabled: enabled), authenticator: PreviewAuthenticator())
    }
}

@MainActor
private final class PreviewAuthenticator: DeviceAuthenticator {
    let biometry = BiometryKind.faceID
    func canEnable() -> AuthenticationResult { .success }
    func authenticate(_ purpose: AuthenticationPurpose, reason: String) async -> AuthenticationResult { .cancelled }
    func cancel() {}
}

private struct SpecimenHost<Content: View>: View {
    let shell: ShellModel
    var lock = Specimen.lock(enabled: false)
    @ViewBuilder let content: () -> Content

    var body: some View {
        content()
            .environment(shell)
            .environment(AppearanceModel(preferences: EphemeralDevicePreferences()))
            .environment(lock)
            .tint(PennyColor.tint)
    }
}

/// `system-foundations`: meaning colors, type scale, glass controls and solid content.
struct FoundationsSpecimen: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack(spacing: 10) {
                    ForEach(
                        [
                            ("Tint", PennyColor.tint), ("Income", PennyColor.income), ("Invest", PennyColor.invest),
                            ("Pending", PennyColor.pending), ("Danger", PennyColor.danger),
                        ], id: \.0
                    ) { name, color in
                        VStack {
                            RoundedRectangle(cornerRadius: 10).fill(color).frame(width: 48, height: 48)
                            Text(name).font(.caption)
                        }
                    }
                }
                HeroAmount("Left to spend", cents: 111_665, currency: "CAD")
                ForEach(TypeScale.allCases.filter { $0 != .hero }, id: \.self) { scale in
                    Text("\(scale.rawValue) · \(Int(scale.size))").font(PennyFont.style(scale))
                }
                HStack {
                    GlassCapsuleButton("November", systemImage: "chevron.down") {}
                    GlassIconButton("Settings", systemImage: "gearshape") {}
                    GlassIconButton("Add entry", systemImage: "plus", tinted: true) {}
                }
                VStack(alignment: .leading, spacing: 8) {
                    MoneyText(4_890, meaning: .expense, currency: "CAD")
                    MoneyText(320_000, meaning: .income, currency: "CAD")
                    MoneyText(20_000, meaning: .investment, currency: "CAD")
                }
                .pennyCard()
                StatusBanner(tone: .offline, title: "Offline · 2 changes waiting") { InlineActionButton("Retry") {} }
                SaveToast(title: "Expense added", detail: "Groceries · $48.90", undo: {})
            }
            .padding(Metrics.gutter)
        }
        .background(PennyColor.background)
    }
}

#Preview("system-foundations") { FoundationsSpecimen() }

#Preview("iphone-home (demo-home)") {
    let shell = Specimen.shell(DemoWorkspace(today: Specimen.today), demo: true)
    SpecimenHost(shell: shell) { AppShell(shell: shell) }
}

#Preview("iphone-empty-home") {
    let shell = Specimen.shell(FixedWorkspace(load: .ready(Ledger())))
    SpecimenHost(shell: shell) { NavigationStack { HomeView() } }
}

#Preview("iphone-offline") {
    let ledger = Specimen.ledger()
    let shell = Specimen.shell(
        FixedWorkspace(
            load: .ready(ledger), sync: .offline(pending: 2, lastSynced: nil),
            pendingEntryIDs: Set(ledger.transactions.suffix(2).map(\.id))))
    SpecimenHost(shell: shell) { AppShell(shell: shell) }
}

#Preview("iphone-saved-toast") {
    let shell = Specimen.shell(FixedWorkspace(load: .ready(Ledger())))
    SpecimenHost(shell: shell) { AppShell(shell: shell) }
        .task {
            await shell.commit(.changeCurrency(.usd), summary: ChangeSummary(title: "Currency updated", detail: "USD"))
        }
}

#Preview("iphone-save-error") {
    let problem = WorkspaceProblem(.server, "The server didn't respond. Your draft is kept.")
    SaveErrorBanner(failure: .server(problem)) {}.padding()
}

#Preview("iphone-settings") {
    let shell = Specimen.shell(FixedWorkspace(load: .ready(Specimen.ledger()), sync: .upToDate(lastSynced: .now)))
    SpecimenHost(shell: shell, lock: Specimen.lock()) {
        NavigationStack {
            SettingsView(onDone: {}).navigationDestination(for: SettingsRoute.self) { SettingsPage(route: $0) }
        }
    }
}

#Preview("iphone-appearance") {
    let shell = Specimen.shell(FixedWorkspace(load: .ready(Ledger())))
    SpecimenHost(shell: shell) { NavigationStack { AppearanceSettingsView() } }
}

#Preview("currency") {
    let shell = Specimen.shell(FixedWorkspace(load: .ready(Ledger())))
    SpecimenHost(shell: shell) { NavigationStack { CurrencySettingsView() } }
}

#Preview("iphone-app-lock") {
    let shell = Specimen.shell(FixedWorkspace(load: .ready(Ledger())))
    SpecimenHost(shell: shell) { NavigationStack { AppLockSettingsView() } }
}

#Preview("iphone-lock") {
    LockScreen(lock: Specimen.lock())
}
