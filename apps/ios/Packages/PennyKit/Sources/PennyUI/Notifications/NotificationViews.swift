import PennyData
import PennyDesign
import SwiftUI

#if os(iOS)
    import UIKit
#endif

/// What the notification setting says and does (MAZ-79), decided without a view.
enum NotificationText {
    static let explanation =
        "Penny tells you when someone in your household adds or changes a shared expense or records a "
        + "reimbursement. Notifications never show names or amounts."

    static func value(permission: PushPermission, status: PushRegistrationStatus) -> String {
        switch (permission, status) {
        case (.notDetermined, _): "Off"
        case (.denied, _): "Off in Settings"
        case (.allowed, .unavailable): "Unavailable"
        case (.allowed, .failed): "Not connected"
        case (.allowed, _): "On"
        }
    }

    /// The footer under the row: why, and what to do when something is wrong.
    static func footer(permission: PushPermission, status: PushRegistrationStatus) -> String {
        switch (permission, status) {
        case (.denied, _):
            "Notifications are off for Penny. Turn them on in iOS Settings to hear about household changes."
        case (.allowed, .unavailable):
            "This device couldn't set up notifications. Penny works without them and tries again next time."
        case (.allowed, .failed):
            "Your server didn't accept this device yet. Penny tries again when you come back."
        default: explanation
        }
    }
}

/// The Notifications row in Settings: asks for permission the first time, then opens Penny's
/// page in iOS Settings, where notifications are turned on or off.
struct NotificationSettingsRow: View {
    let push: PushNotifications
    @Environment(\.openURL) private var openURL

    var body: some View {
        Button {
            if push.permission == .notDetermined {
                Task { await push.requestPermission() }
            } else {
                Self.openSystemSettings(openURL)
            }
        } label: {
            HStack {
                Label("Notifications", systemImage: "bell")
                    .foregroundStyle(PennyColor.label)
                Spacer()
                Text(NotificationText.value(permission: push.permission, status: push.registrar.status))
                    .foregroundStyle(PennyColor.secondaryLabel)
            }
            .frame(minHeight: Metrics.minTouchTarget)
        }
        .accessibilityHint(push.permission == .notDetermined ? "Asks to send you notifications" : "Opens iOS Settings")
        .accessibilityIdentifier("settings.notifications")
    }

    static func openSystemSettings(_ openURL: OpenURLAction) {
        #if os(iOS)
            if let url = URL(string: UIApplication.openNotificationSettingsURLString) { openURL(url) }
        #endif
    }
}

/// The Shared tab's one-time offer, shown once the person is in a household and hasn't
/// decided: the context in which notifications are useful. Not now hides it on this device;
/// Settings still offers it.
struct NotificationPrompt: View {
    let push: PushNotifications

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Hear about household changes", systemImage: "bell.badge")
                .font(.body.weight(.semibold))
            Text(NotificationText.explanation)
                .font(.subheadline)
                .foregroundStyle(PennyColor.secondaryLabel)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 16) {
                Button("Turn on") { Task { await push.requestPermission() } }
                    .buttonStyle(.borderedProminent)
                    .accessibilityIdentifier("notifications.allow")
                Button("Not now") { push.dismissPrompt() }
                    .accessibilityIdentifier("notifications.notNow")
            }
            .frame(minHeight: Metrics.minTouchTarget)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("notifications.prompt")
    }
}
