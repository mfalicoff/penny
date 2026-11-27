import PennyData
import PennyDesign
import SwiftUI

#if os(iOS)
    import UIKit
#endif

/// Settings › Preferences › Monthly recap (`iphone-recap-setting` card, MAZ-292): off by default.
/// Turning it on asks for notification permission (only then) and schedules "Your <month> recap is
/// ready." at 9 AM on the 1st; denied leaves it off and the footer says why. Off removes them.
struct RecapSettingRow: View {
    let recap: MonthlyRecap
    let now: () -> Date

    var body: some View {
        // The icon tile and title as every Settings row (a Toggle's own label drops the tile).
        HStack {
            Label {
                VStack(alignment: .leading, spacing: 1) {
                    Text("Monthly recap")
                    Text(RecapSettingText.detail).font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                        .fixedSize(horizontal: false, vertical: true)
                }
            } icon: {
                Image(systemName: "sparkles")
            }
            .labelStyle(.settingsRow)
            Spacer(minLength: 8)
            Toggle(
                "Monthly recap",
                isOn: Binding(
                    get: { recap.notifies },
                    set: { on in Task { await recap.setNotifies(on, now: now()) } })
            )
            .labelsHidden()
            .tint(PennyColor.tint)
        }
        .accessibilityElement(children: .combine)
        .cardSettingsRow()
        .accessibilityIdentifier("settings.monthlyRecap")
    }
}

/// The switch's words, decided without a view.
enum RecapSettingText {
    static let detail = "On the 1st, at 9 AM"

    /// The footer sentence (the card's, after the currency note): what it does, and that it never
    /// shows amounts or entry names.
    static func footer(device: String) -> String {
        "Monthly recap tells you on this \(device) when last month's recap is ready. "
            + "It never shows amounts or entry names."
    }

    static let denied =
        "Notifications are off for Penny, so Monthly recap stays off. Turn them on in iOS Settings to get it."

    /// "iPhone" or "iPad", as the footer names this device.
    @MainActor static var device: String {
        #if os(iOS)
            UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone"
        #else
            "iPhone"
        #endif
    }
}
