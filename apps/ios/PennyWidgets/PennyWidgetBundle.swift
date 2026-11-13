import PennyWidgetUI
import SwiftUI
import WidgetKit

/// The WidgetKit extension (MAZ-80, docs/ios-widgets.md). It keeps the legacy Expo extension's
/// bundle id and widget kinds (`PennyDomain.AppIdentity`), so widgets people already placed
/// keep working after the upgrade. Everything else lives in PennyKit's PennyWidgetUI.
@main
struct PennyWidgetBundle: WidgetBundle {
    var body: some Widget {
        BalanceWidget()
        RecentExpensesWidget()
    }
}
