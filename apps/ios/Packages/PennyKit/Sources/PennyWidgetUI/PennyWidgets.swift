public import Foundation
import PennyData
import PennyDomain
public import SwiftUI
public import WidgetKit

/// One timeline entry: when it applies and what to draw.
public struct PennyWidgetEntry: TimelineEntry, Sendable {
    public let date: Date
    public let content: WidgetContent

    public init(date: Date, content: WidgetContent) {
        self.date = date
        self.content = content
    }
}

/// Reads the App Group snapshot the app wrote (MAZ-80). It never computes money and never
/// reaches the network: the app is the only writer and reloads the timelines after each write.
///
/// The timeline is one entry, reloaded after the next local midnight so a month that ends is
/// shown as past (`WidgetContent.Freshness.pastMonth`) without the app running. The system
/// also reloads whenever the app calls `WidgetCenter.reloadTimelines(ofKind:)`.
public struct PennyTimelineProvider: TimelineProvider {
    /// Reads the shared snapshot; nil when the build lacks the App Group.
    let read: @Sendable () -> WidgetSnapshotRead?
    let calendar: Calendar

    public init(calendar: Calendar = .current) {
        self.init(calendar: calendar) {
            guard let container = try? SharedContainer(appGroup: AppIdentity.appGroup) else { return nil }
            return WidgetSnapshotStore(container: container).read()
        }
    }

    init(calendar: Calendar, read: @escaping @Sendable () -> WidgetSnapshotRead?) {
        self.calendar = calendar
        self.read = read
    }

    public func placeholder(in context: Context) -> PennyWidgetEntry {
        PennyWidgetEntry(date: .now, content: .sample)
    }

    public func getSnapshot(in context: Context, completion: @escaping @Sendable (PennyWidgetEntry) -> Void) {
        // The gallery shows the sample, never the person's numbers.
        completion(context.isPreview ? placeholder(in: context) : entry(at: .now))
    }

    public func getTimeline(
        in context: Context, completion: @escaping @Sendable (Timeline<PennyWidgetEntry>) -> Void
    ) {
        let now = Date.now
        completion(Timeline(entries: [entry(at: now)], policy: .after(nextReload(after: now))))
    }

    func entry(at date: Date) -> PennyWidgetEntry {
        guard let stored = read() else { return PennyWidgetEntry(date: date, content: .openApp) }
        return PennyWidgetEntry(date: date, content: WidgetContent(stored, now: date, calendar: calendar))
    }

    /// Just after the next local midnight.
    func nextReload(after date: Date) -> Date {
        let midnight = calendar.nextDate(
            after: date, matching: DateComponents(hour: 0, minute: 0, second: 0), matchingPolicy: .nextTime)
        return (midnight ?? date.addingTimeInterval(24 * 60 * 60)).addingTimeInterval(60)
    }
}

/// Monthly balance (`BalanceChartWidget`, a frozen kind so placed widgets stay): Left to
/// spend for the month, Projected, and the recorded flow. Taps open Home.
public struct BalanceWidget: Widget {
    public init() {}

    public var body: some WidgetConfiguration {
        StaticConfiguration(kind: AppIdentity.balanceWidgetKind, provider: PennyTimelineProvider()) { entry in
            BalanceWidgetView(content: entry.content)
                .containerBackground(PennyWidgetStyle.background, for: .widget)
                .widgetURL(WidgetLink.balance)
        }
        .configurationDisplayName("Monthly balance")
        .description("Left to spend this month, from what you've recorded.")
        .supportedFamilies(PennyWidgetStyle.families)
    }
}

/// Recent expenses (`RecentExpensesWidget`): the latest recorded expenses and the + shortcut.
/// Taps open the add entry sheet.
public struct RecentExpensesWidget: Widget {
    public init() {}

    public var body: some WidgetConfiguration {
        StaticConfiguration(kind: AppIdentity.recentExpensesWidgetKind, provider: PennyTimelineProvider()) { entry in
            RecentExpensesWidgetView(content: entry.content)
                .containerBackground(PennyWidgetStyle.background, for: .widget)
                .widgetURL(WidgetLink.addEntry)
        }
        .configurationDisplayName("Recent expenses")
        .description("Your latest spending and a shortcut to add an expense.")
        .supportedFamilies(PennyWidgetStyle.families)
    }
}
