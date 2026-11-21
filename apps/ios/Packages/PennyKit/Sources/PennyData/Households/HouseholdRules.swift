public import Foundation
public import PennyDomain

// Display rules for the shared screens (MAZ-75). The server owns every shared rule (splits,
// balances, suggestions, eligibility, settlement, restrictions); these only label what it
// returned and decide which actions to offer, so a button the server would refuse is not
// shown. The server still has the last word, and its refusal is shown when the two disagree
// (another device acted in between). Mirrors apps/web/src/features/households/model.ts.

/// Who is who in one household, from the viewer's point of view. The session carries only an
/// email, so the viewer's member id is found by email, as on the web.
public struct HouseholdPeople: Equatable, Sendable {
    public let members: [WireHouseholdMember]
    public let me: WireHouseholdMember?

    public init(members: [WireHouseholdMember], email: String) {
        self.members = members
        let lower = email.lowercased()
        me = members.first { $0.email.lowercased() == lower }
    }

    public var meId: String? { me?.userId }

    /// Whether the viewer can still act here (not a former member).
    public var viewerIsCurrent: Bool { me?.isCurrent == true }

    public var current: [WireHouseholdMember] { members.filter(\.isCurrent) }
    public var former: [WireHouseholdMember] { members.filter { !$0.isCurrent } }

    public func member(_ userId: String) -> WireHouseholdMember? { members.first { $0.userId == userId } }

    /// "You", the member's email, or "Former member" for someone the viewer can't see.
    public func name(_ userId: String) -> String {
        if userId == meId { return "You" }
        return member(userId)?.email ?? "Former member"
    }

    /// "your" for the viewer, otherwise "bea@example.test's".
    public func possessive(_ userId: String) -> String {
        userId == meId ? "your" : "\(name(userId))'s"
    }

    /// The person after the start of a sentence: "you" for the viewer, never a capital "You".
    public func object(_ userId: String) -> String {
        userId == meId ? "you" : name(userId)
    }

    /// Up to two letters for a monogram, from the email's local part ("bea.kim@…" is "BK").
    public func initials(_ userId: String) -> String {
        guard let email = member(userId)?.email else { return "?" }
        return Self.initials(email: email)
    }

    /// The monogram letters for an email address (also the iPad sidebar's account, MAZ-182).
    public static func initials(email: String) -> String {
        let local = email.split(separator: "@").first.map(String.init) ?? email
        let parts = local.split(whereSeparator: { ".-_+".contains($0) }).filter { !$0.isEmpty }
        let letters = parts.count >= 2 ? [parts[0], parts[1]].compactMap(\.first) : Array(local.prefix(2))
        return String(letters).uppercased()
    }

    public func isCurrentMember(_ userId: String) -> Bool { member(userId)?.isCurrent == true }

    public func isCreator(_ household: WireHousehold) -> Bool { meId != nil && household.creatorId == meId }

    /// Members active on `date`, the ones an expense that day is split among. Households use
    /// each member's local join day (or the join instant on this device's calendar when the
    /// server has no `joinedOn`) up to, but excluding, the UTC day they left; shared trips use every current
    /// member. The server applies the same rule and rejects a split that doesn't match.
    public func eligible(on date: PennyDomain.CalendarDate, household: WireHousehold, calendar: Calendar = .current)
        -> [WireHouseholdMember]
    {
        if household.trip != nil { return current }
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        return members.filter { member in
            let joined =
                member.joinedOn.flatMap(PennyDomain.CalendarDate.init)
                ?? PennyDomain.CalendarDate(Date(milliseconds: member.joinedAt), in: calendar)
            guard joined <= date else { return false }
            guard let left = member.leftAt else { return true }
            return date < PennyDomain.CalendarDate(Date(milliseconds: left), in: utc)
        }
    }
}

extension Date {
    /// From the API's Unix milliseconds.
    public init(milliseconds: Int64) { self.init(timeIntervalSince1970: TimeInterval(milliseconds) / 1000) }
}

/// Where one member's share of an expense stands.
public enum ShareStatus: String, Equatable, Sendable {
    /// They paid the expense.
    case payer
    /// A zero share: nothing to repay.
    case none
    /// Recorded as repaid (an individual payment).
    case paid
    /// The month was settled monthly, so it's part of that payment.
    case monthly
    case unpaid

    public var label: String {
        switch self {
        case .payer: "Paid the expense"
        case .none: "Nothing to repay"
        case .paid: "Repaid"
        case .monthly: "Settles with the month"
        case .unpaid: "Not repaid yet"
        }
    }
}

extension WireSharedExpense {
    public func share(of userId: String?) -> Int64 {
        guard let userId else { return 0 }
        return splits.first { $0.userId == userId }?.amountCents ?? 0
    }

    public func isSharePaid(by userId: String) -> Bool { payments.contains { $0.fromUserId == userId } }

    /// At least one share was repaid: payer, total, month, household and shares are fixed and
    /// the expense can't be deleted (server: `Paid expenses cannot …`).
    public var isPaid: Bool { !payments.isEmpty }

    public func status(of userId: String) -> ShareStatus {
        if userId == payerUserId { return .payer }
        if share(of: userId) <= 0 { return .none }
        if isSharePaid(by: userId) { return .paid }
        if paymentsClosed { return .monthly }
        return .unpaid
    }

    public var mode: SharedSplitMode { SharedSplitMode(rawValue: splitMode) ?? .equal }

    public var calendarDate: PennyDomain.CalendarDate? { PennyDomain.CalendarDate(date) }

    /// Whether the viewer may record `fromUserId`'s share as paid: the debtor or the payer,
    /// both current members, a positive unpaid share, the month not settled monthly, and the
    /// household not archived.
    public func canRecordShare(from fromUserId: String, people: HouseholdPeople, archived: Bool) -> Bool {
        guard !archived, let meId = people.meId, people.viewerIsCurrent else { return false }
        guard fromUserId != payerUserId, !paymentsClosed, !isSharePaid(by: fromUserId) else { return false }
        guard people.isCurrentMember(fromUserId), people.isCurrentMember(payerUserId) else { return false }
        guard meId == fromUserId || meId == payerUserId else { return false }
        return share(of: fromUserId) > 0
    }
}

extension SharedSplitMode {
    /// "Equally", "By amount", "By percent".
    public var label: String {
        switch self {
        case .equal: "Equally"
        case .exact: "By amount"
        case .percent: "By percent"
        }
    }
}

extension WireMonthRecap {
    /// The viewer's balance this month: positive gets money back, negative owes.
    public func balance(of userId: String?) -> Int64 {
        guard let userId else { return 0 }
        return balances.first { $0.userId == userId }?.balanceCents ?? 0
    }

    public var monthKey: MonthKey? { MonthKey(month) }
}

/// Which history entries a filter chip keeps.
public enum AuditFilter: String, CaseIterable, Sendable {
    case all, expenses, payments, members

    public var title: String {
        switch self {
        case .all: "All"
        case .expenses: "Expenses"
        case .payments: "Payments"
        case .members: "Members"
        }
    }

    public func includes(_ action: String) -> Bool {
        switch self {
        case .all: true
        case .expenses: action.hasPrefix("expense.") || action.hasPrefix("recurring.")
        case .payments: action.hasPrefix("reimbursement.")
        case .members: action.hasPrefix("member.") || action.hasPrefix("invite.")
        }
    }
}

/// One readable sentence per audit event and the fields an edit changed. Snapshots arrive
/// redacted (no payer account, no receipt name), and nothing here ever reads an account.
public struct AuditDescription: Equatable, Sendable {
    public var summary: String
    public var changes: [String]
    /// The names in `summary` drawn in bold, as on the card ("**Mira** added **Hydro**"): the
    /// actor, or the person who joined or left, and the expense.
    public var emphasis: [String]
    /// Each edited field with its old and new value, so the old one can be struck through
    /// ("Category ~~Shopping~~ → Groceries"). The same edits are in `changes` as words.
    public var edits: [Edit]

    public struct Edit: Equatable, Sendable {
        public var label: String
        public var before: String
        public var after: String
    }

    /// `expenseTitle` names a payment's expense when the page knows it ("$61.40 for Costco run" on
    /// `iphone-history`); `day` formats the day someone joined ("Included in new expenses from
    /// Oct 14"). `group` is "household" or "trip".
    public init(
        _ event: WireAuditEvent, people: HouseholdPeople, money: (Int64) -> String,
        expenseTitle: (String) -> String? = { _ in nil }, day: (Int64) -> String? = { _ in nil },
        group: String = "household"
    ) {
        let before = event.before ?? .null
        let after = event.after ?? .null
        let actor = people.name(event.actorId)
        let subject = after["title"]?.string ?? before["title"]?.string ?? "an expense"
        func person(_ value: WireJSON?) -> String { value?.string.map(people.name) ?? "Someone" }

        switch event.action {
        case "household.created", "trip.created":
            summary = "\(actor) created \(after["name"]?.string ?? "the \(group)")"
        case "household.renamed", "trip.edited":
            summary = "\(actor) renamed the \(group)"
        case "invite.created":
            summary = "\(actor) created an invite code"
        case "member.joined":
            summary = "\(after["userId"]?.string.map(people.name) ?? actor) joined the \(group)"
        case "member.left":
            summary = "\(before["userId"]?.string.map(people.name) ?? actor) left the \(group)"
        case "member.removed":
            summary = "\(actor) removed \(before["userId"]?.string.map(people.object) ?? "someone")"
        case "household.archived":
            summary = "\(actor) archived the household"
        case "expense.created":
            summary =
                after["recurringId"]?.string != nil ? "\(subject) was added automatically" : "\(actor) added \(subject)"
        case "expense.updated":
            summary = "\(actor) edited \(subject)"
        case "expense.deleted":
            summary = "\(actor) deleted \(subject)"
        case "expense.moved":
            summary = "\(actor) moved \(subject) to another household"
        case "reimbursement.created":
            // "You recorded Jo's payment", then what it paid on the next line.
            let from = after["fromUserId"]?.string ?? ""
            summary =
                from == event.actorId
                ? "\(actor) recorded a payment"
                : "\(actor) recorded \(from == people.meId ? "your" : "\(people.name(from))'s") payment"
        case "recurring.created":
            summary = "\(actor) set up \(subject) to repeat"
        case "recurring.updated":
            summary = "\(actor) changed repeating \(subject)"
        case "recurring.deleted":
            summary = "\(actor) stopped repeating \(subject)"
        default:
            summary = "\(actor): \(event.action)"
        }
        let memberId = after["userId"]?.string ?? before["userId"]?.string
        switch event.action {
        case "member.joined", "member.left":
            emphasis = [memberId.map(people.name) ?? actor]
        case "member.removed":
            emphasis = [actor] + (memberId.map { [people.object($0)] } ?? [])
        case "expense.created" where after["recurringId"]?.string != nil:
            emphasis = [subject]
        case let action where action.hasPrefix("expense.") || action.hasPrefix("recurring."):
            emphasis = [actor, subject]
        default:
            emphasis = [actor]
        }

        func format(_ key: String, _ value: WireJSON?) -> String {
            guard let value, value != .null, value != .string("") else { return "none" }
            switch key {
            case "totalCents": return value.int64.map(money) ?? "none"
            case "payerUserId": return value.string.map(people.name) ?? "none"
            case "category": return value["name"]?.string ?? "Other"
            case "splitMode": return (value.string.flatMap(SharedSplitMode.init(rawValue:))?.label ?? "").lowercased()
            case "splits":
                guard case .array(let parts) = value else { return "changed" }
                return parts.map { "\(person($0["userId"])) \($0["amountCents"]?.int64.map(money) ?? "")" }
                    .joined(separator: ", ")
            case "receiptId": return "attached"
            case "active": return value.bool == false ? "paused" : "active"
            default:
                if let text = value.string { return text }
                if let number = value.int64 { return String(number) }
                return "changed"
            }
        }

        edits = []
        let labels: [(String, String)] = [
            ("name", "Name"), ("title", "Title"), ("totalCents", "Total"), ("date", "Date"),
            ("payerUserId", "Paid by"), ("splitMode", "Split"), ("category", "Category"), ("note", "Note"),
            ("splits", "Shares"), ("receiptId", "Receipt"), ("frequency", "Repeats"), ("nextDate", "Next date"),
            ("active", "Status"),
        ]
        switch event.action {
        case "expense.updated", "recurring.updated", "household.renamed", "trip.edited":
            edits = labels.compactMap { key, label in
                guard let old = before[key], let new = after[key], old != new else { return nil }
                return Edit(label: label, before: format(key, old), after: format(key, new))
            }
            changes = edits.map { "\($0.label): \($0.before) → \($0.after)" }
        case "expense.created":
            if let total = after["totalCents"]?.int64 {
                changes = ["\(money(total)) · split \(format("splitMode", after["splitMode"]))"]
            } else {
                changes = []
            }
        case "member.joined":
            changes = [
                day(event.createdAt).map { "Included in new expenses from \($0)" }
                    ?? "Included in new expenses from the day they joined"
            ]
        case "reimbursement.created":
            let amount = after["amountCents"]?.int64.map(money) ?? "A payment"
            let to = after["toUserId"]?.string.map(people.object) ?? "someone"
            if let expense = after["expenseId"]?.string {
                changes = [expenseTitle(expense).map { "\(amount) for \($0)" } ?? "\(amount) share to \(to)"]
            } else {
                changes = ["\(amount) to \(to) for the month"]
            }
        default:
            changes = []
        }
    }
}

/// Why a share payment was refused as stale, and what changed (`iphone-payment-stale`, as on the
/// web since MAZ-176): another payment, a monthly settlement or an edit, with only the values that
/// differ between the copy the sheet opened and the latest one.
public struct StaleShareChange: Equatable, Sendable {
    public enum Cause: Equatable, Sendable {
        /// Someone recorded a payment; `fromUserId` is the share it settled.
        case payment(recordedBy: String, fromUserId: String, at: Int64)
        /// The month was settled with a monthly payment.
        case monthly
        case edit(editedBy: String, at: Int64)
    }

    public enum Value: Equatable, Sendable {
        case total, share, status
    }

    public struct Row: Equatable, Sendable {
        public var value: Value
        public var before: String
        public var now: String

        public init(value: Value, before: String, now: String) {
            self.value = value
            self.before = before
            self.now = now
        }
    }

    public var cause: Cause
    public var rows: [Row]

    /// `fromUserId` is the share the sheet was recording; `money` formats cents.
    public init(
        before: WireSharedExpense, now: WireSharedExpense, fromUserId: String, money: (Int64) -> String
    ) {
        let added = now.payments.filter { !before.payments.contains($0) }
        let latest = added.max { $0.createdAt < $1.createdAt }
        let sameContent =
            before.title == now.title && before.date == now.date && before.totalCents == now.totalCents
            && before.payerUserId == now.payerUserId && before.splitMode == now.splitMode
            && before.splits.sorted { $0.userId < $1.userId } == now.splits.sorted { $0.userId < $1.userId }
        if sameContent, let latest {
            let settled = added.first { $0.fromUserId == fromUserId } ?? latest
            cause = .payment(recordedBy: latest.createdBy, fromUserId: settled.fromUserId, at: latest.createdAt)
        } else if sameContent, now.paymentsClosed, !before.paymentsClosed {
            cause = .monthly
        } else {
            cause = .edit(editedBy: now.updatedBy, at: now.updatedAt)
        }
        var rows: [Row] = []
        if before.totalCents != now.totalCents {
            rows.append(Row(value: .total, before: money(before.totalCents), now: money(now.totalCents)))
        }
        let oldShare = before.share(of: fromUserId)
        let newShare = now.share(of: fromUserId)
        if oldShare != newShare { rows.append(Row(value: .share, before: money(oldShare), now: money(newShare))) }
        let oldStatus = before.status(of: fromUserId)
        let newStatus = now.status(of: fromUserId)
        if oldStatus != newStatus {
            rows.append(Row(value: .status, before: oldStatus.label, now: newStatus.label))
        }
        self.rows = rows
    }
}
