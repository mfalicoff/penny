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

    /// `iphone-shared-list`, `iphone-notifications-prompt`: the bell on a tinted tile beside the
    /// title and explanation, then Turn on and Not now as equal capsules.
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 14) {
                Image(systemName: "bell.badge")
                    .font(.title3)
                    .foregroundStyle(PennyColor.tint)
                    .frame(width: 44, height: 44)
                    .background(
                        PaletteToken.tintSoft.value.color, in: RoundedRectangle(cornerRadius: 13, style: .continuous)
                    )
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Hear about household changes").font(.body.weight(.semibold))
                        .accessibilityAddTraits(.isHeader)
                    Text(NotificationText.explanation)
                        .font(.subheadline)
                        .foregroundStyle(PennyColor.secondaryLabel)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            HStack(spacing: 10) {
                Button {
                    Task { await push.requestPermission() }
                } label: {
                    Text("Turn on").promptButton(primary: true)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("notifications.allow")
                Button {
                    push.dismissPrompt()
                } label: {
                    Text("Not now").promptButton(primary: false)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("notifications.notNow")
            }
        }
        .padding(18)
        .background(PennyColor.surface, in: RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous))
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets())
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("notifications.prompt")
    }
}

extension View {
    fileprivate func promptButton(primary: Bool) -> some View {
        font(.callout.weight(.semibold))
            .foregroundStyle(primary ? Color.white : PennyColor.label)
            .frame(maxWidth: .infinity, minHeight: Metrics.minTouchTarget)
            .background(primary ? PennyColor.tint : PennyColor.fill, in: Capsule())
            .contentShape(Capsule())
    }
}
