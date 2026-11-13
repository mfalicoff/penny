public import Foundation
public import PennyData
public import PennyDomain

/// What a widget shows at one moment, decided from the stored snapshot and the entry's date.
/// Pure, so the rules are tested without WidgetKit (docs/ios-widgets.md#states).
public enum WidgetContent: Hashable, Sendable {
    /// Nobody is signed in, or the app has not written a snapshot yet.
    case signedOut
    /// The snapshot can't be read by this extension (newer format, damaged, or the build
    /// lacks the App Group). Opening Penny rewrites it.
    case openApp
    /// A snapshot to draw, with how current it is.
    case ready(WidgetSnapshot, Freshness)

    public enum Freshness: Hashable, Sendable {
        /// The device's month, built recently.
        case current
        /// The device's month, but built more than `WidgetContent.oldAfter` ago: the widget
        /// shows when it was updated.
        case old(since: Date)
        /// A month that has ended. Left to spend for it is still true, but it is not this
        /// month's; the widget names the month and asks the person to open Penny.
        case pastMonth
    }

    /// After this long without an update, the widget says when it was last updated. The app
    /// rewrites the snapshot on every change and when it becomes active, so a quiet day is
    /// not out of date; this flags changes that may have arrived from other devices.
    public static let oldAfter: TimeInterval = 12 * 60 * 60

    public init(_ read: WidgetSnapshotRead, now: Date, calendar: Calendar = .current) {
        switch read {
        case .signedOut: self = .signedOut
        case .unreadable: self = .openApp
        case .snapshot(let snapshot):
            let month = MonthKey(CalendarDate(now, in: calendar))
            if let stored = MonthKey(snapshot.month), stored < month {
                self = .ready(snapshot, .pastMonth)
            } else if now.timeIntervalSince(snapshot.generatedAt) > Self.oldAfter {
                self = .ready(snapshot, .old(since: snapshot.generatedAt))
            } else {
                self = .ready(snapshot, .current)
            }
        }
    }

    /// The sample shown in the widget gallery and as the loading placeholder (redacted by the
    /// system). Design fixture values (docs/design/penny-ios/system/widgets.html), never data.
    public static let sample = WidgetContent.ready(
        WidgetSnapshot(
            month: "2026-11", currency: "CAD", generatedAt: Date(timeIntervalSince1970: 1_794_000_000),
            income: 320_000, spent: 148_335, invested: 60_000, leftToSpend: 111_665, projectedRemaining: 96_665,
            recentExpenses: [
                .init(title: "Groceries", cents: 4890, date: "2026-11-09", shared: true),
                .init(title: "Coffee", cents: 640, date: "2026-11-09", shared: false),
                .init(title: "Transit", cents: 6200, date: "2026-11-08", shared: false),
            ], waitingToSync: false),
        .current)
}

/// Where a tap on each widget goes. A small widget has one tap target (`widgetURL`).
public enum WidgetLink {
    /// Monthly balance: Home (`DeepLink.home`).
    public static let balance = url("penny:///")
    /// Recent expenses: the add entry sheet, as the legacy widget's + (`DeepLink.addEntry`).
    public static let addEntry = url("penny://entries/new")

    private static func url(_ text: String) -> URL {
        guard let url = URL(string: text) else { preconditionFailure("Invalid widget link \(text)") }
        return url
    }
}

/// The parts of the Monthly balance bar: recorded spending, contributions and what is left,
/// as fractions of the larger of income and outflow (the money flow's `total`), so the bar is
/// always full and never claims money that wasn't recorded.
public struct WidgetFlowBar: Hashable, Sendable {
    public let spent: Double
    public let invested: Double
    public let left: Double

    public init(_ snapshot: WidgetSnapshot) {
        let total = max(snapshot.income, snapshot.spent + snapshot.invested)
        guard total > 0 else {
            spent = 0
            invested = 0
            left = 0
            return
        }
        let whole = Double(total)
        spent = Double(snapshot.spent) / whole
        invested = Double(snapshot.invested) / whole
        left = Double(max(0, snapshot.leftToSpend)) / whole
    }

    public var isEmpty: Bool { spent == 0 && invested == 0 && left == 0 }
}
