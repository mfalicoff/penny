import PennyWidgetUI
import SwiftUI
import WidgetKit

/// The WidgetKit extension (MAZ-80, docs/ios-widgets.md). Its bundle id and widget kinds
/// (`PennyDomain.AppIdentity`) are frozen for TestFlight/App Store continuity, so widgets
/// people already placed keep working across upgrades. Everything else lives in PennyKit's PennyWidgetUI.
@main
struct PennyWidgetBundle: WidgetBundle {
    var body: some Widget {
        BalanceWidget()
        RecentExpensesWidget()
    }
}
