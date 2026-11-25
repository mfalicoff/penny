import PennyData
import PennyDomain
import SwiftUI

/// Connects the shell to the app's crash and performance reports (MAZ-129): tells the recorder
/// which account and server reports go to (none in the demo), reads `/api/info` again so a
/// server that starts or stops taking reports is noticed, records the launch, sends what's
/// waiting when the app goes to the background, and asks "Help fix problems faster?" once.
struct ClientMonitoring: ViewModifier {
    @Bindable var shell: ShellModel
    @Environment(ClientTelemetry.self) private var telemetry: ClientTelemetry?
    @Environment(\.scenePhase) private var scenePhase

    /// What reports depend on: the account, whether its server takes them, the demo.
    private struct Destination: Equatable {
        var account: SignedInAccount?
        var offered: Bool
        var demo: Bool
    }

    private var destination: Destination {
        Destination(
            account: shell.account, offered: shell.auth?.server?.nativeTelemetry == true, demo: shell.isDemo)
    }

    func body(content: Content) -> some View {
        content
            .task(id: destination) {
                guard let telemetry else { return }
                let destination = destination
                // Reports are posted without tracing: telemetry never reports on itself.
                telemetry.update(
                    account: destination.account, offered: destination.offered, demo: destination.demo,
                    transport: URLSessionTransport())
                telemetry.recordLaunch()
            }
            .task {
                if !shell.isDemo { await shell.auth?.refreshServerInfo() }
            }
            .onChange(of: scenePhase) {
                if scenePhase == .background { telemetry?.flush() }
            }
            .sheet(isPresented: prompt) {
                if let telemetry {
                    MonitoringPromptSheet().environment(shell).environment(telemetry)
                }
            }
    }

    /// Asked once per install, for an account on a server that takes reports, while no other
    /// sheet is up and after "What should people call you?".
    private var prompt: Binding<Bool> {
        Binding(
            get: {
                guard let telemetry, shell.account != nil else { return false }
                return telemetry.shouldAsk(offered: destination.offered, demo: shell.isDemo)
                    && !shell.profile.showsNamePrompt && !shell.route.isAddEntryPresented
                    && shell.editingEntry == nil && !shell.route.isCalendarPresented
                    && !shell.route.isSettingsPresented && shell.route.householdStart == nil
            },
            set: { _ in })
    }
}
