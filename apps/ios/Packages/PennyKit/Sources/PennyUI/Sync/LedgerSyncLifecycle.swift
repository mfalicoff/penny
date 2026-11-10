public import PennyData
public import SwiftUI

extension View {
    /// Shares the offline ledger model with the views below (`@Environment(LedgerSyncModel.self)`)
    /// and tells it when the scene becomes active or goes to the background, so it syncs on
    /// foreground and stops retry timers in the background (MAZ-71, docs/ios-offline-sync.md).
    public func ledgerSync(_ model: LedgerSyncModel) -> some View {
        modifier(LedgerSyncLifecycle(model: model))
    }
}

struct LedgerSyncLifecycle: ViewModifier {
    let model: LedgerSyncModel
    @Environment(\.scenePhase) private var scenePhase

    func body(content: Content) -> some View {
        content
            .environment(model)
            .task { model.start() }
            .onChange(of: scenePhase) {
                switch scenePhase {
                case .active: model.sceneDidBecomeActive()
                case .background: model.sceneDidEnterBackground()
                default: break
                }
            }
    }
}
