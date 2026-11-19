import Foundation
import PennyData
import PennyDomain
import Testing

/// Shared schedules on Recurring (MAZ-198): the account's share of each household rule's next
/// occurrence follows the server's `ExpenseSplit.Recurring`, as the web's `shareOfRule` does.
@Suite("Shared schedules on Recurring (MAZ-198)")
struct SharedScheduleTests {
    typealias Fake = FakeHouseholds

    static let household = WireHousehold(
        id: Fake.home, name: "Apartment", currency: "CAD", creatorId: Fake.me, createdAt: 1_788_000_000_000,
        memberCount: 3)
    /// Alex and Bea since September, Cam from October 14.
    static let members = [Fake.member(Fake.me), Fake.member(Fake.bea), Fake.member(Fake.cam, joinedOn: "2026-10-14")]

    static func rule(
        _ id: String = "streaming", total: Int64 = 9000, mode: String = "equal", allocations: [WireAllocation]? = nil,
        next: String = "2026-11-22", active: Bool = true
    ) -> WireSharedRule {
        WireSharedRule(
            id: id, householdId: Fake.home, title: "Streaming", totalCents: total, payerUserId: Fake.me,
            splitMode: mode, allocations: allocations,
            category: WireSharedCategory(name: "Fun", icon: "play-outline", color: "#F97316"), frequency: "monthly",
            nextDate: next, active: active)
    }

    static func share(_ rule: WireSharedRule, email: String = Fake.email) -> Int64? {
        let people = HouseholdPeople(members: members, email: email)
        return SharedSchedule.share(of: rule, household: household, people: people, calendar: utc)
    }

    static var utc: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        return calendar
    }

    @Test("whenTheRuleSplitsEqually_Share_ShouldBeAnEqualPartAmongTheActiveMembers")
    func equal() {
        #expect(Self.share(Self.rule()) == 3000)
        // Before Cam joined, only Alex and Bea share it.
        #expect(Self.share(Self.rule(next: "2026-10-01")) == 4500)
    }

    @Test("whenTheSameMembersRemain_Share_ShouldKeepTheStoredExactOrPercentSplit")
    func stored() {
        let exact = Self.rule(
            mode: "exact", allocations: [.amount(Fake.me, 6000), .amount(Fake.bea, 2000), .amount(Fake.cam, 1000)])
        #expect(Self.share(exact) == 6000)
        let percent = Self.rule(
            total: 10_000, mode: "percent",
            allocations: [.percent(Fake.me, 5000), .percent(Fake.bea, 3000), .percent(Fake.cam, 2000)])
        #expect(Self.share(percent) == 5000)
    }

    @Test("whenTheMembersChangedOrTheSplitNoLongerAddsUp_Share_ShouldFallBackToEqual")
    func fallback() {
        // Cam joined after the split was stored.
        let beforeCam = Self.rule(mode: "exact", allocations: [.amount(Fake.me, 6000), .amount(Fake.bea, 3000)])
        #expect(Self.share(beforeCam) == 3000)
        let short = Self.rule(
            mode: "exact", allocations: [.amount(Fake.me, 6000), .amount(Fake.bea, 2000), .amount(Fake.cam, 500)])
        #expect(Self.share(short) == 3000)
        let missing = Self.rule(
            total: 10_000, mode: "percent",
            allocations: [.percent(Fake.me, 5000), .percent(Fake.bea, 3000), .amount(Fake.cam, 2000)])
        #expect(Self.share(missing) == 3334, "equal, the extra cent to the lexically first member (user-alex)")
    }

    @Test("whenTheAccountIsNotInTheSplit_Share_ShouldBeNil")
    func notInSplit() {
        #expect(Self.share(Self.rule(next: "2026-10-01"), email: "cam@example.test") == nil)
        #expect(Self.share(Self.rule(), email: "dee@example.test") == nil)
        #expect(Self.share(Self.rule(next: "not a date")) == nil)
    }

    @MainActor
    @Test("whenHouseholdsAndRulesLoad_SharedSchedules_ShouldListTheAccountsShareOfEachRule")
    func loads() async {
        let fake = Fake.standard()
        fake.state.withLock { state in
            state.rules["streaming"] = Self.rule()
            state.rules["gym"] = Self.rule("gym", total: 5000, next: "2026-10-01", active: false)
        }
        let directory = HouseholdDirectory(service: fake, email: Fake.email, month: { Fake.november })
        let schedules = await directory.sharedSchedules().sorted { $0.id < $1.id }
        #expect(schedules.map(\.id) == ["gym", "streaming"])
        #expect(schedules.map(\.shareCents) == [2500, 3000])
        #expect(schedules.allSatisfy { $0.household.name == "Apartment" })
    }

    @MainActor
    @Test("whenSharedDataCantBeRead_SharedSchedules_ShouldBeEmptyRatherThanFail")
    func failures() async {
        let fake = Fake.standard()
        fake.state.withLock { $0.rules["streaming"] = Self.rule() }
        let directory = HouseholdDirectory(service: fake, email: Fake.email, month: { Fake.november })

        fake.fail("households", with: .offline)
        #expect(await directory.sharedSchedules().isEmpty)
        fake.fail("sharedRules", with: .server(status: 500, message: nil))
        #expect(await directory.sharedSchedules().isEmpty, "a household without its rules is left out")
        fake.fail("household", with: .notFound(message: "Household not found."))
        #expect(await directory.sharedSchedules().isEmpty, "a household without its members is left out")
        #expect(await directory.sharedSchedules().map(\.id) == ["streaming"])

        let demo = HouseholdDirectory(service: nil, email: Fake.email, month: { Fake.november })
        #expect(await demo.sharedSchedules().isEmpty)
    }
}
