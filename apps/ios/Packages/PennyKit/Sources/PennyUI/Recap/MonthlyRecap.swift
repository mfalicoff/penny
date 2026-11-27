public import Foundation
public import Observation
public import PennyData
public import PennyDomain

#if canImport(UserNotifications)
    import UserNotifications
#endif

/// The notification center as the monthly recap uses it: local notifications only, behind a
/// protocol so scheduling is tested without the system's prompt or Notification Center.
nonisolated public protocol RecapNotificationCenter: Sendable {
    func permission() async -> PushPermission
    /// Shows the system prompt (once per install; later calls answer at once). True if allowed.
    func requestPermission() async -> Bool
    /// The identifiers of the notifications waiting to be delivered.
    func pendingIdentifiers() async -> [String]
    func schedule(_ reminder: RecapReminder, body: String) async throws
    func removePending(_ identifiers: [String]) async
}

#if canImport(UserNotifications)
    /// `UNUserNotificationCenter`: a calendar trigger at 9:00 local time on the 1st, which does not
    /// repeat (the next one names another month).
    nonisolated public struct SystemRecapNotificationCenter: RecapNotificationCenter {
        public init() {}

        public func permission() async -> PushPermission {
            switch await UNUserNotificationCenter.current().notificationSettings().authorizationStatus {
            case .notDetermined: .notDetermined
            case .denied: .denied
            default: .allowed
            }
        }

        public func requestPermission() async -> Bool {
            (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]))
                ?? false
        }

        public func pendingIdentifiers() async -> [String] {
            await UNUserNotificationCenter.current().pendingNotificationRequests().map(\.identifier)
        }

        public func schedule(_ reminder: RecapReminder, body: String) async throws {
            let content = UNMutableNotificationContent()
            // No title: Penny's name is the notification's header; the body never names an amount
            // or an entry.
            content.body = body
            content.sound = .default
            content.userInfo = RecapNotification(month: reminder.month).userInfo
            var when = DateComponents()
            when.year = reminder.day.year
            when.month = reminder.day.month
            when.day = reminder.day.day
            when.hour = RecapReminder.hour
            when.minute = RecapReminder.minute
            let trigger = UNCalendarNotificationTrigger(dateMatching: when, repeats: false)
            try await UNUserNotificationCenter.current().add(
                UNNotificationRequest(identifier: reminder.identifier, content: content, trigger: trigger))
        }

        public func removePending(_ identifiers: [String]) async {
            UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: identifiers)
        }
    }
#endif

/// The monthly recap's device settings (MAZ-292): which months' banners were dismissed, and
/// Settings › Monthly recap, the opt-in notification at 9 AM on the 1st. Both are kept on this
/// device (not per account): the notification says only "Your October recap is ready.", with no
/// amounts or names, so it belongs to whoever opens Penny.
///
/// - Turning the switch on asks for notification permission, only then. When iOS says no, the
///   switch stays off and Settings says why (`permissionDenied`).
/// - A repeating trigger can't change its text, so the next `scheduledCount` notifications are
///   scheduled one by one, and again each time Penny becomes active (`reschedule`). Turning the
///   switch off removes them.
@MainActor
@Observable
public final class MonthlyRecap {
    public private(set) var notifies: Bool
    /// The person turned the switch on and notifications are off for Penny in iOS Settings.
    public private(set) var permissionDenied = false
    private(set) var dismissed: Set<String>
    /// Years whose January year-in-review banner was dismissed here (MAZ-292, phase 2).
    private(set) var dismissedYears: Set<String>

    @ObservationIgnored private let defaults: UserDefaults?
    @ObservationIgnored private let center: (any RecapNotificationCenter)?

    static let notifiesKey = "penny.recap.notifies"
    static let dismissedKey = "penny.recap.dismissed"
    static let dismissedYearsKey = "penny.yearReview.dismissed"
    /// About a year ahead: enough for a person who doesn't open Penny for months.
    static let scheduledCount = 12
    /// Dismissed banners kept; older months can't show a banner again anyway.
    static let keptDismissals = 24

    /// `defaults` nil keeps everything in memory (previews and tests); `center` nil offers no
    /// notification.
    public init(defaults: UserDefaults?, center: (any RecapNotificationCenter)?) {
        self.defaults = defaults
        self.center = center
        notifies = center != nil && (defaults?.bool(forKey: Self.notifiesKey) ?? false)
        dismissed = Set(defaults?.stringArray(forKey: Self.dismissedKey) ?? [])
        dismissedYears = Set(defaults?.stringArray(forKey: Self.dismissedYearsKey) ?? [])
    }

    #if canImport(UserNotifications)
        public static func live() -> MonthlyRecap {
            MonthlyRecap(defaults: .standard, center: SystemRecapNotificationCenter())
        }
    #endif

    /// Whether this device can schedule the notification (not in previews).
    public var offersNotification: Bool { center != nil }

    // MARK: Banner

    func isDismissed(_ month: MonthKey) -> Bool { dismissed.contains(month.description) }

    /// The banner's close button: that month's banner doesn't come back on this device.
    func dismiss(_ month: MonthKey) {
        dismissed.insert(month.description)
        let kept = dismissed.sorted().suffix(Self.keptDismissals)
        dismissed = Set(kept)
        defaults?.set(Array(kept), forKey: Self.dismissedKey)
    }

    /// The month whose banner shows on Home and Insights today: last month during the first 7 days
    /// (`MonthReview.bannerMonth`), unless its recap would be empty or it was dismissed here.
    func bannerMonth(today: CalendarDate, report: LedgerReport) -> MonthKey? {
        guard let month = MonthReview.bannerMonth(today: today), !isDismissed(month),
            !report.month(month, today: today).recordedEntries.isEmpty
        else { return nil }
        return month
    }

    // MARK: Year in review (MAZ-292, phase 2)

    func isDismissed(year: Int) -> Bool { dismissedYears.contains(String(year)) }

    /// The January banner's close button: that year's banner doesn't come back on this device.
    func dismiss(year: Int) {
        dismissedYears.insert(String(year))
        let kept = dismissedYears.sorted().suffix(Self.keptDismissals)
        dismissedYears = Set(kept)
        defaults?.set(Array(kept), forKey: Self.dismissedYearsKey)
    }

    /// The year whose banner shows on Home and Insights: last year, in January
    /// (`YearReview.bannerYear`), unless nothing was recorded in it or it was dismissed here.
    func bannerYear(today: CalendarDate, report: LedgerReport) -> Int? {
        guard let year = YearReview.bannerYear(today: today), !isDismissed(year: year),
            YearReviewText.hasEntries(year, report: report, today: today)
        else { return nil }
        return year
    }

    /// The banner on Home and Insights. In January the year's banner takes the monthly recap
    /// banner's place while it shows (owner decision for iOS and the web: the two never stack, so
    /// Home stays uncrowded); once it's dismissed, December's recap banner shows for the rest of
    /// its first 7 days.
    func banner(today: CalendarDate, report: LedgerReport) -> RecapBannerItem? {
        if let year = bannerYear(today: today, report: report) { return .year(year) }
        return bannerMonth(today: today, report: report).map(RecapBannerItem.month)
    }

    // MARK: Notification

    /// The Settings switch. On asks for permission when iOS hasn't asked yet, and schedules the
    /// next notifications; denied leaves it off. Off removes every pending recap notification.
    public func setNotifies(_ on: Bool, now: Date, calendar: Calendar = .current) async {
        guard let center else { return }
        guard on else {
            store(false)
            permissionDenied = false
            await removeScheduled()
            return
        }
        var permission = await center.permission()
        if permission == .notDetermined {
            permission = await center.requestPermission() ? .allowed : .denied
        }
        guard permission == .allowed else {
            permissionDenied = true
            store(false)
            return
        }
        permissionDenied = false
        store(true)
        await reschedule(now: now, calendar: calendar)
    }

    /// Replaces the pending recap notifications with the next ones from `now`, so each names its
    /// month. Called when Penny becomes active. When notifications were turned off for Penny in iOS
    /// Settings meanwhile, the switch goes off and says why.
    public func reschedule(now: Date, calendar: Calendar = .current) async {
        guard let center, notifies else { return }
        if await center.permission() == .denied {
            permissionDenied = true
            store(false)
            await removeScheduled()
            return
        }
        let time = calendar.dateComponents([.hour, .minute], from: now)
        let reminders = RecapReminder.upcoming(
            today: CalendarDate(now, in: calendar), minutesIntoDay: (time.hour ?? 0) * 60 + (time.minute ?? 0),
            count: Self.scheduledCount)
        await removeScheduled()
        for reminder in reminders {
            try? await center.schedule(reminder, body: RecapText.notificationBody(reminder.month))
        }
    }

    private func removeScheduled() async {
        guard let center else { return }
        let pending = await center.pendingIdentifiers().filter { $0.hasPrefix(RecapReminder.identifierPrefix) }
        if !pending.isEmpty { await center.removePending(pending) }
    }

    private func store(_ on: Bool) {
        notifies = on
        defaults?.set(on, forKey: Self.notifiesKey)
    }
}
