public import Foundation
public import PennyDomain

/// A shared schedule on Recurring (MAZ-198, as the web's MAZ-177): a repeating expense of a
/// household or shared trip the account belongs to, where the account is part of the split,
/// with the account's share of the next occurrence. Shared data is online-only and optional
/// context there: a household that can't be read leaves the personal list alone.
public struct SharedSchedule: Equatable, Sendable, Identifiable {
    public let rule: WireSharedRule
    public let household: WireHousehold
    /// The account's share of the next occurrence, in the household's currency.
    public let shareCents: Int64

    public init(rule: WireSharedRule, household: WireHousehold, shareCents: Int64) {
        self.rule = rule
        self.household = household
        self.shareCents = shareCents
    }

    public var id: String { rule.id }
    public var nextDate: PennyDomain.CalendarDate? { PennyDomain.CalendarDate(rule.nextDate) }

    /// The account's share of `rule`'s next occurrence, or nil when the account isn't in its
    /// split. Follows the server's recurring split (`ExpenseSplit.Recurring`, the web's
    /// `shareOfRule`): the stored exact or percentage split while exactly the same members are
    /// active on that date, otherwise an equal split among them; equal too when the stored split
    /// no longer adds up.
    public static func share(
        of rule: WireSharedRule, household: WireHousehold, people: HouseholdPeople, calendar: Calendar = .current
    ) -> Int64? {
        guard let meId = people.meId, let date = PennyDomain.CalendarDate(rule.nextDate) else { return nil }
        var seen = Set<String>()
        let active = people.eligible(on: date, household: household, calendar: calendar).map(\.userId)
            .filter { seen.insert($0).inserted }
        guard active.contains(meId) else { return nil }
        let shares =
            stored(rule, active: active) ?? (try? HouseholdSplit.equal(total: rule.totalCents, memberIds: active))
        return shares?.first { $0.userId == meId }?.amountCents
    }

    /// The rule's own exact or percentage split, when it still applies to `active`.
    private static func stored(_ rule: WireSharedRule, active: [String]) -> [SharedShare]? {
        let mode = SharedSplitMode(rawValue: rule.splitMode) ?? .equal
        guard mode != .equal else { return nil }
        let allocations = rule.allocations ?? []
        let ids = Set(allocations.map(\.userId))
        guard ids.count == allocations.count, ids == Set(active) else { return nil }
        switch mode {
        case .equal:
            return nil
        case .exact:
            var amounts: [String: Int64] = [:]
            for item in allocations {
                guard let cents = item.amountCents else { return nil }
                amounts[item.userId] = cents
            }
            return try? HouseholdSplit.exact(total: rule.totalCents, amounts: amounts)
        case .percent:
            var points: [String: Int64] = [:]
            for item in allocations {
                guard let value = item.percentBasisPoints else { return nil }
                points[item.userId] = value
            }
            return try? HouseholdSplit.percent(total: rule.totalCents, basisPoints: points)
        }
    }

    /// The shared schedules the account is part of, from what could be read. A household
    /// without its members or rules is skipped.
    public static func list(
        households: [WireHousehold], details: [String: WireHouseholdDetail], rules: [String: [WireSharedRule]],
        email: String, calendar: Calendar = .current
    ) -> [SharedSchedule] {
        households.flatMap { household -> [SharedSchedule] in
            guard let detail = details[household.id], let rules = rules[household.id] else { return [] }
            let people = HouseholdPeople(members: detail.members, email: email)
            return rules.compactMap { rule in
                share(of: rule, household: household, people: people, calendar: calendar).map {
                    SharedSchedule(rule: rule, household: household, shareCents: $0)
                }
            }
        }
    }
}

extension HouseholdDirectory {
    /// Reads every household's members and rules and returns the shared schedules the account
    /// is part of (Recurring, MAZ-198). Empty in the demo and when the list can't be read; a
    /// household whose members or rules can't be read is left out.
    public func sharedSchedules() async -> [SharedSchedule] {
        guard let service, let list = try? await service.households() else { return [] }
        var details: [String: WireHouseholdDetail] = [:]
        var rules: [String: [WireSharedRule]] = [:]
        await withTaskGroup(of: (String, WireHouseholdDetail?, [WireSharedRule]?).self) { group in
            for household in list {
                group.addTask {
                    async let detail = try? service.household(id: household.id)
                    async let shared = try? service.sharedRules(householdId: household.id)
                    return (household.id, await detail, await shared)
                }
            }
            for await (id, detail, shared) in group {
                details[id] = detail
                rules[id] = shared
            }
        }
        return SharedSchedule.list(households: list, details: details, rules: rules, email: email)
    }
}
