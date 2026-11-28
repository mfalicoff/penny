public import Foundation
public import Observation
public import PennyData
import PennyDesign
public import PennyDomain
import SwiftUI

#if canImport(UIKit)
    import UIKit
#endif

#if canImport(UserNotifications)
    import UserNotifications
#endif

/// The notification center as renewal reminders use it: local notifications only, behind a
/// protocol so scheduling is tested without the system's prompt or Notification Center.
nonisolated public protocol RenewalNotificationCenter: Sendable {
    func permission() async -> PushPermission
    /// Shows the system prompt (once per install; later calls answer at once). True if allowed.
    func requestPermission() async -> Bool
    /// The identifiers of the notifications waiting to be delivered.
    func pendingIdentifiers() async -> [String]
    func schedule(_ reminder: RenewalReminder, text: RenewalText.Notification) async throws
    func removePending(_ identifiers: [String]) async
}

#if canImport(UserNotifications)
    /// `UNUserNotificationCenter`: a calendar trigger at 9:00 local time, which does not repeat
    /// (the next one is scheduled when the schedule's next date moves on).
    nonisolated public struct SystemRenewalNotificationCenter: RenewalNotificationCenter {
        public init() {}

        public func permission() async -> PushPermission { await SystemRecapNotificationCenter().permission() }

        public func requestPermission() async -> Bool { await SystemRecapNotificationCenter().requestPermission() }

        public func pendingIdentifiers() async -> [String] {
            await SystemRecapNotificationCenter().pendingIdentifiers()
        }

        public func schedule(_ reminder: RenewalReminder, text: RenewalText.Notification) async throws {
            let content = UNMutableNotificationContent()
            content.title = text.title
            content.body = text.body
            content.sound = .default
            content.userInfo = RenewalNotification(ruleID: reminder.ruleID).userInfo
            var when = DateComponents()
            when.year = reminder.day.year
            when.month = reminder.day.month
            when.day = reminder.day.day
            when.hour = RenewalReminder.hour
            when.minute = RenewalReminder.minute
            let trigger = UNCalendarNotificationTrigger(dateMatching: when, repeats: false)
            try await UNUserNotificationCenter.current().add(
                UNNotificationRequest(identifier: reminder.identifier, content: content, trigger: trigger))
        }

        public func removePending(_ identifiers: [String]) async {
            await SystemRecapNotificationCenter().removePending(identifiers)
        }
    }
#endif

/// One reminder as Penny would schedule it: when, and what it says.
struct PlannedRenewal: Equatable, Hashable, Sendable {
    let reminder: RenewalReminder
    let text: RenewalText.Notification
}

/// Renewal reminders (MAZ-290, phase 2): the Reminder section of a yearly schedule's page, with
/// "Remind me before it renews" and "Show name and amount", and the local notifications they
/// schedule, 3 days before the schedule renews at 9 AM.
///
/// Both switches are kept on this device, for the signed-in account (`owner`): the card says
/// "This iPhone reminds you", the notification is this device's, and whether it may show a name
/// and an amount on the Lock Screen is a question about this device. They are not part of the
/// ledger, so the web (which has no reminders) and the API never see them.
///
/// - Turning a reminder on asks for notification permission the first time. When iOS says no, the
///   switch stays off and the section says why (`permissionDenied`).
/// - The waiting reminders are replaced whenever what they would say changes (`apply`): a new
///   next date (an occurrence recorded, an edit), a pause, a removal, a new title or amount, or a
///   switch. Signing out removes them (`ownerChanged`).
@MainActor
@Observable
public final class RenewalReminders {
    /// Schedules that remind, and those whose reminder shows its name and amount, by rule id.
    public private(set) var reminding: Set<String> = []
    public private(set) var showingDetails: Set<String> = []
    /// The person turned a reminder on and notifications are off for Penny in iOS Settings.
    public private(set) var permissionDenied = false
    /// The account whose switches are loaded (`WidgetSnapshotStore.owner`); nil when signed out
    /// or in the demo, where nothing is scheduled.
    public private(set) var owner: String?

    @ObservationIgnored private let defaults: UserDefaults?
    @ObservationIgnored private let center: (any RenewalNotificationCenter)?
    /// What was last scheduled, so an unchanged ledger schedules nothing again.
    @ObservationIgnored private var scheduled: [PlannedRenewal]?
    /// The latest `apply`, so two never interleave their removals and additions.
    @ObservationIgnored private var applying: Task<Void, Never>?

    static let keyPrefix = "penny.renewal."

    /// `defaults` nil keeps everything in memory (previews and tests); `center` nil offers no
    /// reminder (previews, the demo).
    public init(defaults: UserDefaults?, center: (any RenewalNotificationCenter)?) {
        self.defaults = defaults
        self.center = center
    }

    #if canImport(UserNotifications)
        public static func live() -> RenewalReminders {
            RenewalReminders(defaults: .standard, center: SystemRenewalNotificationCenter())
        }
    #endif

    /// Whether this device can schedule reminders (not in previews or the demo).
    public var offersReminders: Bool { center != nil && owner != nil }

    public func reminds(_ ruleID: String) -> Bool { reminding.contains(ruleID) }
    public func showsDetails(_ ruleID: String) -> Bool { showingDetails.contains(ruleID) }

    // MARK: Account

    /// The signed-in account changed. Another account's (or nobody's) reminders are removed, and
    /// this account's switches are loaded. `.unknown` (restoring) keeps everything as it is.
    public func ownerChanged(_ owner: WidgetPublisher.Owner) async {
        let next: String?
        switch owner {
        case .unknown: return
        case .nobody: next = nil
        case .account(let id): next = id
        }
        guard next != self.owner else { return }
        self.owner = next
        reminding = Set(next.flatMap { defaults?.stringArray(forKey: Self.key($0, "remind")) } ?? [])
        showingDetails = Set(next.flatMap { defaults?.stringArray(forKey: Self.key($0, "details")) } ?? [])
        permissionDenied = false
        scheduled = nil
        await removeScheduled()
    }

    // MARK: Switches

    /// "Remind me before it renews". On asks for permission when iOS hasn't asked yet; denied
    /// leaves it off and says why. Either way the waiting reminders follow at the next `apply`.
    public func setReminds(_ on: Bool, ruleID: String) async {
        guard let center, owner != nil else { return }
        guard on else {
            update(&reminding, ruleID, false, "remind")
            permissionDenied = false
            return
        }
        var permission = await center.permission()
        if permission == .notDetermined {
            permission = await center.requestPermission() ? .allowed : .denied
        }
        guard permission == .allowed else {
            permissionDenied = true
            return
        }
        permissionDenied = false
        update(&reminding, ruleID, true, "remind")
    }

    /// "Show name and amount" on the Lock Screen and in Notification Center. Off by default.
    public func setShowsDetails(_ on: Bool, ruleID: String) {
        guard owner != nil else { return }
        update(&showingDetails, ruleID, on, "details")
    }

    // MARK: Scheduling

    /// The reminders the switches ask for, given the ledger and the local time now.
    func plan(_ ledger: Ledger, now: Date, calendar: Calendar = .current, locale: Locale = .current)
        -> [PlannedRenewal]
    {
        guard offersReminders, !reminding.isEmpty else { return [] }
        let time = calendar.dateComponents([.hour, .minute], from: now)
        let reminders = RenewalReminder.upcoming(
            ledger.recurring, reminding: reminding, today: CalendarDate(now, in: calendar),
            minutesIntoDay: (time.hour ?? 0) * 60 + (time.minute ?? 0))
        return reminders.compactMap { reminder in
            guard let rule = ledger.rule(id: reminder.ruleID) else { return nil }
            let text = RenewalText.notification(
                rule, showsDetails: showsDetails(rule.id), currency: ledger.currency.rawValue, locale: locale)
            return PlannedRenewal(reminder: reminder, text: text)
        }
    }

    /// Replaces the waiting reminders with `planned`, unless they are already what was last
    /// scheduled. Switches of schedules no longer in the ledger (removed here or elsewhere) are
    /// forgotten. When notifications were turned off for Penny in iOS Settings meanwhile, nothing
    /// is scheduled and the Reminder section says why.
    func apply(_ planned: [PlannedRenewal], ruleIDs: Set<String>) async {
        let previous = applying
        let task = Task { @MainActor in
            await previous?.value
            await self.replace(planned, ruleIDs: ruleIDs)
        }
        applying = task
        await task.value
    }

    private func replace(_ planned: [PlannedRenewal], ruleIDs: Set<String>) async {
        guard let center, owner != nil else { return }
        let gone = reminding.union(showingDetails).subtracting(ruleIDs)
        for id in gone {
            update(&reminding, id, false, "remind")
            update(&showingDetails, id, false, "details")
        }
        guard planned != scheduled else { return }
        scheduled = planned
        await removeScheduled()
        guard !planned.isEmpty else { return }
        guard await center.permission() == .allowed else {
            permissionDenied = true
            scheduled = nil
            return
        }
        for item in planned {
            try? await center.schedule(item.reminder, text: item.text)
        }
    }

    private func removeScheduled() async {
        guard let center else { return }
        let pending = await center.pendingIdentifiers().filter { $0.hasPrefix(RenewalReminder.identifierPrefix) }
        if !pending.isEmpty { await center.removePending(pending) }
    }

    private func update(_ set: inout Set<String>, _ id: String, _ on: Bool, _ name: String) {
        guard let owner, set.contains(id) != on else { return }
        if on { set.insert(id) } else { set.remove(id) }
        defaults?.set(set.sorted(), forKey: Self.key(owner, name))
    }

    static func key(_ owner: String, _ name: String) -> String { "\(keyPrefix)\(owner).\(name)" }
}

/// The words of a renewal reminder (`iphone-renewal-notification`) and of the Reminder section
/// (`iphone-schedule-reminder`).
public enum RenewalText {
    public struct Notification: Equatable, Hashable, Sendable {
        public let title: String
        public let body: String
    }

    /// Private by default: "A yearly schedule renews in 3 days" / "Open Penny to see which one.".
    /// With Show name and amount: "Domain name renews in 3 days" / "$24.00 on Wed, Nov 11.".
    static func notification(_ rule: RecurringRule, showsDetails: Bool, currency: String, locale: Locale)
        -> Notification
    {
        let days = "renews in \(Renewal.reminderLeadDays) days"
        guard showsDetails else {
            return Notification(title: "A yearly schedule \(days)", body: "Open Penny to see which one.")
        }
        let amount = MoneyFormat.amount(rule.share, currency: currency, locale: locale)
        let day = DayText.date(rule.nextDate).formatted(
            Date.FormatStyle.dateTime.weekday(.abbreviated).month(.abbreviated).day().locale(locale))
        return Notification(title: "\(rule.title) \(days)", body: "\(amount) on \(day).")
    }

    static let header = "Reminder"
    static let remind = "Remind me before it renews"
    static let details = "Show name and amount"
    static let detailsCaption = "On the Lock Screen and in Notification Center"
    /// The section's footer, naming this device: the switches are kept on it.
    static func footer(onPad: Bool) -> String {
        "This \(onPad ? "iPad" : "iPhone") reminds you 3 days before, at 9 AM. Without the name and amount, the "
            + "reminder says only that a yearly schedule renews soon. Paused schedules don't remind you."
    }

    static var isPad: Bool {
        #if canImport(UIKit)
            UIDevice.current.userInterfaceIdiom == .pad
        #else
            false
        #endif
    }
    static let denied = "Notifications are off for Penny. Turn them on in Settings to get this reminder."

    /// The schedule page's tag: "Renews today", "Renews tomorrow", "Renews in 3 days".
    static func renewsIn(_ days: Int) -> String {
        switch days {
        case 0: "Renews today"
        case 1: "Renews tomorrow"
        default: "Renews in \(days) days"
        }
    }

    static let soon = "Renews soon"
}

/// Keeps the account's renewal reminders in step with its ledger (MAZ-290): whenever what they
/// would say changes, the waiting ones are replaced. Never in the demo.
struct RenewalScheduling: ViewModifier {
    let shell: ShellModel

    func body(content: Content) -> some View {
        content.onChange(of: inputs, initial: true) { _, inputs in
            guard let inputs else { return }
            Task { await shell.renewals.apply(inputs.planned, ruleIDs: inputs.ruleIDs) }
        }
    }

    private struct Inputs: Equatable {
        let planned: [PlannedRenewal]
        let ruleIDs: Set<String>
    }

    /// Nil until the ledger has loaded, so a loading ledger never forgets a schedule's switches.
    private var inputs: Inputs? {
        guard !shell.isDemo, let ledger = shell.workspace.load.ledger else { return nil }
        // Read today so a new day plans again (the reminder for a schedule inside its last 3
        // days drops away; one a year on is planned once its occurrence is recorded).
        _ = shell.today
        return Inputs(
            planned: shell.renewals.plan(ledger, now: shell.now()), ruleIDs: Set(ledger.recurring.map(\.id)))
    }
}
