import CoreGraphics
import Foundation
import PennyData
import PennyDomain
import Testing

@Suite("Household API client (MAZ-75)")
struct HouseholdClientTests {
    static let householdJSON =
        #"{"id":"h 1/x","name":"Apartment","currency":"CAD","creatorId":"user-alex","createdAt":1788000000000,"memberCount":3}"#

    static func client(_ transport: StubTransport) throws -> APIClient { try APIFixtures.client(transport: transport) }

    @Test("whenReadingAHousehold_APIClient_ShouldEncodeTheIdAsOneSegmentAndDecodeFormerMembers")
    func detail() async throws {
        let json =
            #"{"household":\#(Self.householdJSON),"members":[{"userId":"user-alex","email":"alex@example.test","joinedAt":1788000000000,"joinedOn":"2026-09-01","leftAt":null},{"userId":"user-bea","email":"bea@example.test","joinedAt":1788000000000,"leftAt":1793000000000}]}"#
        let transport = StubTransport(json: json)
        let detail = try await Self.client(transport).household(id: "h 1/x")
        #expect(detail.members.map(\.isCurrent) == [true, false], "null and absent leftAt both mean current")
        #expect(detail.members[1].joinedOn == nil)
        let sent = try #require(transport.sent.first)
        #expect(sent.url?.absoluteString == "https://penny.example.test/api/households/h%201%2Fx")
        #expect(sent.value(forHTTPHeaderField: "Authorization") == "Bearer \(APIFixtures.token)")
    }

    @Test("whenCreatingAndJoining_APIClient_ShouldSendTheLegacyBodies")
    func createAndJoin() async throws {
        let transport = StubTransport(status: 201, json: #"{"household":\#(Self.householdJSON)}"#)
        let client = try Self.client(transport)
        _ = try await client.createHousehold(name: "  Apartment  ", currency: .cad, timezoneOffsetMinutes: 300)
        _ = try await client.joinHousehold(
            code: try #require(InviteCode(typed: "a1b2c 3d4e5")), timezoneOffsetMinutes: -60)
        let create = try APIFixtures.object(transport.sent[0].httpBody)
        #expect(transport.sent[0].httpMethod == "POST")
        #expect(create["name"] as? String == "Apartment")
        #expect(create["currency"] as? String == "CAD")
        #expect(create["timezoneOffsetMinutes"] as? Int == 300)
        let join = try APIFixtures.object(transport.sent[1].httpBody)
        #expect(transport.sent[1].url?.path == "/api/households/join")
        #expect(join["code"] as? String == "A1B2C3D4E5")
        #expect(join["timezoneOffsetMinutes"] as? Int == -60)
        await #expect(throws: APIError.invalidRequest(.invalidField("name"))) {
            _ = try await client.createHousehold(name: "   ", currency: .cad, timezoneOffsetMinutes: 0)
        }
    }

    @Test("whenWritingExpensesAndPayments_APIClient_ShouldUseTheContractRoutes")
    func routes() async throws {
        let expense =
            ##"{"expense":{"id":"e1","householdId":"h1","title":"Hydro","totalCents":9630,"date":"2026-11-04","payerUserId":"user-alex","splitMode":"equal","splits":[{"userId":"user-alex","amountCents":3210}],"payments":[],"paymentsClosed":false,"category":{"name":"Home","icon":"home","color":"#3B82F6"},"note":"","revision":1,"createdBy":"user-alex","createdAt":1,"updatedBy":"user-alex","updatedAt":1}}"##
        let transport = StubTransport { request in
            switch (request.httpMethod, request.url?.path) {
            case ("DELETE", _), ("POST", "/api/households/h1/leave"):
                HTTPResult(status: 200, body: Data(#"{"ok":true}"#.utf8))
            case ("POST", "/api/households/h1/months/2026-11/reimbursements"):
                HTTPResult(
                    status: 201,
                    body: Data(
                        #"{"reimbursement":{"id":"r1","householdId":"h1","month":"2026-11","fromUserId":"user-bea","toUserId":"user-alex","amountCents":3000,"createdBy":"user-bea","createdAt":1}}"#
                            .utf8))
            default: HTTPResult(status: 200, body: Data(expense.utf8))
            }
        }
        let client = try Self.client(transport)
        let input = WireExpenseInput(
            title: "Hydro", totalCents: 9630, date: "2026-11-04", payerUserId: "user-alex", splitMode: "exact",
            allocations: [.amount("user-alex", 9630)],
            category: WireSharedCategory(name: "Home", icon: "home", color: "#3B82F6"), revision: 0)
        _ = try await client.createSharedExpense(householdId: "h1", input)
        _ = try await client.updateSharedExpense(householdId: "h1", id: "e1", input)
        try await client.deleteSharedExpense(householdId: "h1", id: "e1", revision: 1)
        _ = try await client.recordSharePayment(householdId: "h1", expenseId: "e1", fromUserId: "user-bea", revision: 1)
        _ = try await client.recordMonthlyPayment(
            householdId: "h1", month: try #require(MonthKey("2026-11")),
            transfer: WireTransfer(fromUserId: "user-bea", toUserId: "user-alex", amountCents: 3000))
        try await client.leaveHousehold(id: "h1")
        try await client.removeMember(householdId: "h1", userId: "user-cam")

        let sent = transport.sent.map { "\($0.httpMethod ?? "") \($0.url?.path ?? "")" }
        #expect(
            sent == [
                "POST /api/households/h1/expenses", "PUT /api/households/h1/expenses/e1",
                "DELETE /api/households/h1/expenses/e1", "POST /api/households/h1/expenses/e1/payments",
                "POST /api/households/h1/months/2026-11/reimbursements", "POST /api/households/h1/leave",
                "DELETE /api/households/h1/members/user-cam",
            ])
        let create = try APIFixtures.object(transport.sent[0].httpBody)
        #expect(create["revision"] == nil, "a create never sends a revision")
        #expect(create["accountId"] == nil, "absent optionals are omitted, never null")
        #expect((create["allocations"] as? [[String: Any]])?.first?["amountCents"] as? Int == 9630)
        #expect(try APIFixtures.object(transport.sent[1].httpBody)["revision"] as? Int == 0)
        #expect(try APIFixtures.object(transport.sent[2].httpBody)["revision"] as? Int == 1)
        let payment = try APIFixtures.object(transport.sent[3].httpBody)
        #expect(payment["fromUserId"] as? String == "user-bea")
        #expect(payment["revision"] as? Int == 1)
        await #expect(throws: APIError.invalidRequest(.invalidField("revision"))) {
            var stale = input
            stale.revision = nil
            _ = try await client.updateSharedExpense(householdId: "h1", id: "e1", stale)
        }
    }

    @Test("whenReadingRecapAndAudit_APIClient_ShouldKeepEveryFieldAndAnySnapshot")
    func recapAndAudit() async throws {
        let recap =
            #"{"month":"2026-10","expenses":[],"reimbursements":[{"id":"r1","householdId":"h1","month":"2026-10","fromUserId":"b","toUserId":"a","amountCents":1800,"createdBy":"b","createdAt":1,"expenseId":"e1"}],"balances":[{"userId":"a","balanceCents":-1800},{"userId":"b","balanceCents":1800}],"suggestions":[{"fromUserId":"a","toUserId":"b","amountCents":1800}],"overdue":true,"overdueMonths":["2026-09","2026-10"]}"#
        let audit =
            ##"{"events":[{"id":"ev1","householdId":"h1","expenseId":"e1","actorId":"a","action":"expense.updated","before":{"title":"Hydro","totalCents":9630,"splits":[{"userId":"a","amountCents":4815}],"category":{"name":"Home"}},"after":{"title":"Hydro","totalCents":10410,"active":false},"createdAt":1793000000000},{"id":"ev2","householdId":"h1","actorId":"a","action":"household.archived","before":null,"after":{"householdId":"h1"},"createdAt":1}]}"##
        let transport = StubTransport { request in
            HTTPResult(status: 200, body: Data((request.url?.path.hasSuffix("audit") == true ? audit : recap).utf8))
        }
        let client = try Self.client(transport)
        let month = try await client.monthRecap(householdId: "h1", month: try #require(MonthKey("2026-10")))
        #expect(month.overdue)
        #expect(month.overdueMonths == ["2026-09", "2026-10"])
        #expect(month.reimbursements.first?.expenseId == "e1")
        let events = try await client.householdAudit(householdId: "h1", expenseId: "e 1")
        #expect(transport.sent.last?.url?.query == "expenseId=e%201")
        #expect(events.first?.before?["totalCents"]?.int64 == 9630)
        #expect(events.first?.after?["active"]?.bool == false)
        #expect(events.last?.before == nil, "a null snapshot reads as none")
    }

    @Test(
        "whenTheServerRefuses_HouseholdFailure_ShouldSayWhatChangedAndWhatToDo",
        arguments: [
            (APIError.offline, HouseholdFailure.Kind.offline),
            (.timeout, .unreachable),
            (.conflict(message: "Expense changed. Refresh and try again."), .stale),
            (.conflict(message: "Recurring rule changed. Refresh and try again."), .stale),
            (.conflict(message: "This is no longer the full suggested reimbursement."), .stale),
            (.conflict(message: "This share is already paid."), .restricted),
            (.conflict(message: "Settle every monthly balance before leaving."), .restricted),
            (.forbidden(message: "Only the household creator can manage members."), .restricted),
            (.notFound(message: "Household not found."), .membership),
            (.notFound(message: "Expense not found."), .gone),
            (.badRequest(message: "Invite code is invalid or expired."), .invalidInvite),
            (.badRequest(message: "Household currency must match your ledger currency."), .invalid),
            (.rateLimited(retryAfter: 60), .rateLimited),
            (.unauthorized(message: nil), .signIn),
            (.server(status: 500, message: nil), .server),
        ])
    func failures(error: APIError, kind: HouseholdFailure.Kind) {
        let failure = HouseholdFailure(error)
        #expect(failure.kind == kind)
        #expect(!failure.message.isEmpty)
        if case .conflict(let message?) = error, kind == .restricted {
            #expect(failure.message == message, "a restriction shows the server's own words")
        }
    }
}

@Suite("Household rules (MAZ-75)")
struct HouseholdRulesTests {
    static let household = WireHousehold(
        id: "h1", name: "Apartment", currency: "CAD", creatorId: "a", createdAt: 0, memberCount: 2)

    @Test("whenNamingPeople_HouseholdPeople_ShouldFindTheViewerByEmailAndHideStrangers")
    func names() {
        let people = HouseholdPeople(
            members: [
                WireHouseholdMember(userId: "a", email: "Alex.Kim@Example.test", joinedAt: 0),
                WireHouseholdMember(userId: "b", email: "bea@example.test", joinedAt: 0),
            ], email: "alex.kim@example.test")
        #expect(people.meId == "a")
        #expect(people.name("a") == "You")
        #expect(people.name("b") == "bea@example.test")
        #expect(people.name("zz") == "Former member")
        #expect(people.possessive("a") == "your")
        #expect(people.initials("a") == "AK")
        #expect(people.initials("b") == "BE")
        #expect(people.isCreator(Self.household))
    }

    @Test("whenAnExpenseIsDated_HouseholdPeople_ShouldSplitItAmongMembersActiveThatDay")
    func eligibility() throws {
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        let leftOct20 = Int64(
            (utc.date(from: DateComponents(year: 2026, month: 10, day: 20, hour: 15)) ?? .distantPast)
                .timeIntervalSince1970 * 1000)
        let people = HouseholdPeople(
            members: [
                WireHouseholdMember(userId: "a", email: "a@example.test", joinedAt: 0, joinedOn: "2026-09-01"),
                WireHouseholdMember(userId: "b", email: "b@example.test", joinedAt: 0, joinedOn: "2026-10-14"),
                WireHouseholdMember(
                    userId: "c", email: "c@example.test", joinedAt: 0, joinedOn: "2026-09-01", leftAt: leftOct20),
            ], email: "a@example.test")
        func ids(_ day: String) throws -> [String] {
            people.eligible(on: try #require(CalendarDate(day)), household: Self.household, calendar: utc).map(\.userId)
        }
        #expect(try ids("2026-10-13") == ["a", "c"], "b joined later and owes nothing for earlier expenses")
        #expect(try ids("2026-10-14") == ["a", "b", "c"])
        #expect(try ids("2026-10-20") == ["a", "b"], "c left that day")
        var trip = Self.household
        trip.trip = WireHouseholdTrip(startDate: "2026-12-01", endDate: "2026-12-08")
        #expect(
            people.eligible(on: try #require(CalendarDate("2026-01-01")), household: trip).map(\.userId) == ["a", "b"],
            "shared trips use every current member, whatever the date")
    }

    @Test("whenSharesArePaidOrClosed_SharedExpense_ShouldOfferMarkAsPaidOnlyWhereTheServerAllowsIt")
    func shareStatus() {
        let people = HouseholdPeople(
            members: [
                WireHouseholdMember(userId: "a", email: "a@example.test", joinedAt: 0),
                WireHouseholdMember(userId: "b", email: "b@example.test", joinedAt: 0),
                WireHouseholdMember(userId: "c", email: "c@example.test", joinedAt: 0),
                WireHouseholdMember(userId: "d", email: "d@example.test", joinedAt: 0, leftAt: 5),
            ], email: "b@example.test")
        var expense = WireSharedExpense(
            id: "e", householdId: "h1", title: "Rent", totalCents: 300, date: "2026-11-01", payerUserId: "a",
            splitMode: "equal",
            splits: [
                WireSplit(userId: "a", amountCents: 100), WireSplit(userId: "b", amountCents: 100),
                WireSplit(userId: "c", amountCents: 100), WireSplit(userId: "d", amountCents: 0),
            ],
            category: WireSharedCategory(name: "Home", icon: "home", color: "#3B82F6"), createdBy: "a", createdAt: 0,
            updatedBy: "a", updatedAt: 0)
        #expect(expense.status(of: "a") == .payer)
        #expect(expense.status(of: "d") == .none)
        #expect(expense.canRecordShare(from: "b", people: people, archived: false), "the debtor records their own")
        #expect(!expense.canRecordShare(from: "c", people: people, archived: false), "only the debtor or the payer")
        #expect(!expense.canRecordShare(from: "a", people: people, archived: false), "the payer can't repay themselves")
        #expect(!expense.canRecordShare(from: "b", people: people, archived: true), "archived households are read only")
        expense.payments = [WireExpensePayment(fromUserId: "b", amountCents: 100, createdAt: 0, createdBy: "b")]
        #expect(expense.status(of: "b") == .paid)
        #expect(expense.isPaid)
        #expect(!expense.canRecordShare(from: "b", people: people, archived: false), "already paid")
        expense.payments = []
        expense.paymentsClosed = true
        #expect(expense.status(of: "b") == .monthly)
        #expect(!expense.canRecordShare(from: "b", people: people, archived: false), "the month settles monthly")
    }

    @Test("whenDescribingHistory_AuditDescription_ShouldNameChangesWithoutPrivateData")
    func audit() {
        let people = HouseholdPeople(
            members: [
                WireHouseholdMember(userId: "a", email: "a@example.test", joinedAt: 0),
                WireHouseholdMember(userId: "b", email: "bea@example.test", joinedAt: 0),
            ], email: "a@example.test")
        let money: (Int64) -> String = { "$\($0 / 100).\(String(format: "%02d", $0 % 100))" }
        let edit = AuditDescription(
            WireAuditEvent(
                id: "1", householdId: "h1", expenseId: "e", actorId: "b", action: "expense.updated",
                before: .object([
                    "title": .string("Costco run"), "totalCents": .number(18420),
                    "category": .object(["name": .string("Shopping")]), "accountId": .string("secret-account"),
                ]),
                after: .object([
                    "title": .string("Costco run"), "totalCents": .number(18420),
                    "category": .object(["name": .string("Groceries")]),
                ]), createdAt: 0), people: people, money: money)
        #expect(edit.summary == "bea@example.test edited Costco run")
        #expect(edit.changes == ["Category: Shopping → Groceries"])
        #expect(!(edit.summary + edit.changes.joined()).contains("secret"))
        let payment = AuditDescription(
            WireAuditEvent(
                id: "2", householdId: "h1", actorId: "a", action: "reimbursement.created",
                after: .object([
                    "fromUserId": .string("b"), "toUserId": .string("a"), "amountCents": .number(6140),
                    "expenseId": .string("e"),
                ]), createdAt: 0), people: people, money: money)
        #expect(payment.summary == "You recorded bea@example.test's $61.40 share payment to You")
        let automatic = AuditDescription(
            WireAuditEvent(
                id: "3", householdId: "h1", actorId: "a", action: "expense.created",
                after: .object([
                    "title": .string("Rent"), "recurringId": .string("r"), "totalCents": .number(290_000),
                    "splitMode": .string("percent"),
                ]), createdAt: 0), people: people, money: money)
        #expect(automatic.summary == "Rent was added automatically")
        #expect(automatic.changes == ["$2900.00 · split by percent"])
        #expect(AuditFilter.payments.includes("reimbursement.created"))
        #expect(!AuditFilter.members.includes("expense.created"))
        #expect(AuditFilter.expenses.includes("recurring.updated"))
    }
}

@Suite("Household screens' models (MAZ-75)")
@MainActor
struct HouseholdModelTests {
    static func directory(_ fake: FakeHouseholds) -> HouseholdDirectory {
        HouseholdDirectory(
            service: fake, email: FakeHouseholds.email, month: { FakeHouseholds.november }, timezoneOffset: { 300 })
    }

    @Test("whenTheListLoads_HouseholdDirectory_ShouldShowEachHouseholdWithTheViewersBalance")
    func list() async {
        let fake = FakeHouseholds.standard()
        let directory = Self.directory(fake)
        await directory.refresh()
        #expect(directory.load == .loaded)
        #expect(directory.households.map(\.name) == ["Apartment"])
        #expect(directory.balances[FakeHouseholds.home] == 6000)
        #expect(directory.memberInitials[FakeHouseholds.home]?.count == 3)
        #expect(directory.overallBalance == 6000)
    }

    @Test("whenOffline_HouseholdDirectory_ShouldKeepTheLastListAndSaySo")
    func offline() async {
        let fake = FakeHouseholds.standard()
        let directory = Self.directory(fake)
        await directory.refresh()
        fake.fail("households", with: .offline)
        await directory.refresh()
        #expect(directory.load.failure?.kind == .offline)
        #expect(directory.households.count == 1, "the last list stays")
    }

    @Test("whenJoiningWithACode_HouseholdDirectory_ShouldJoinOrExplainAnExpiredCode")
    func join() async throws {
        let fake = FakeHouseholds.standard()
        let directory = Self.directory(fake)
        let expired = await directory.join(try #require(InviteCode(typed: "FFFFFFFFFF")))
        guard case .failure(let failure) = expired else {
            Issue.record("an expired code joined")
            return
        }
        #expect(failure.kind == .invalidInvite)
        #expect(failure.message == "Invite code is invalid or expired.")
        let joined = await directory.join(try #require(InviteCode(typed: "a1b2c3d4e5")))
        #expect((try? joined.get())?.id == FakeHouseholds.home)
        #expect(directory.households.first?.id == FakeHouseholds.home)
    }

    @Test("whenCreating_HouseholdDirectory_ShouldRefuseAnEmptyNameAndAddTheNewHousehold")
    func create() async {
        let directory = Self.directory(FakeHouseholds())
        guard case .failure(let refused) = await directory.create(name: "  ", currency: .cad) else {
            Issue.record("an empty name was sent")
            return
        }
        #expect(refused.kind == .invalid)
        let created = await directory.create(name: "Cottage", currency: .eur)
        #expect((try? created.get())?.currency == "EUR")
        #expect(directory.households.map(\.name) == ["Cottage"])
    }

    @Test("whenAShareIsRecordedOnAStaleCopy_HouseholdModel_ShouldRecordNothingAndShowOldAndNew")
    func staleShare() async throws {
        let fake = FakeHouseholds.standard()
        let directory = Self.directory(fake)
        let model = try #require(directory.model(for: FakeHouseholds.home))
        await model.refresh()
        let opened = try #require(model.expense("hydro"))
        // Another member edits the expense after the sheet opened.
        fake.state.withLock { state in
            state.expenses["hydro"]?.totalCents = 10410
            state.expenses["hydro"]?.revision = 1
        }
        let outcome = await model.recordShare(opened, from: FakeHouseholds.bea)
        guard case .stale(let old, let latest) = outcome else {
            Issue.record("expected stale, got \(outcome)")
            return
        }
        #expect(old.totalCents == 9000)
        #expect(latest?.totalCents == 10410)
        #expect(fake.state.withLock { $0.expenses["hydro"]?.payments.isEmpty == true }, "nothing was recorded")
        // With the current revision it records once, and a second attempt is refused.
        let current = try #require(latest)
        let recorded = await model.recordShare(current, from: FakeHouseholds.bea)
        guard case .recorded = recorded else {
            Issue.record("the current revision should record, got \(recorded)")
            return
        }
        // A double tap sends the same (now old) revision: refused, recorded once.
        guard case .stale = await model.recordShare(current, from: FakeHouseholds.bea) else {
            Issue.record("a repeated payment should be refused")
            return
        }
        #expect(fake.state.withLock { $0.expenses["hydro"]?.payments.count } == 1)
        let fresh = try #require(model.expense("hydro"))
        guard case .failed(let already) = await model.recordShare(fresh, from: FakeHouseholds.bea) else {
            Issue.record("an already-paid share should be refused")
            return
        }
        #expect(already.kind == .restricted)
        #expect(already.message == "This share is already paid.")
    }

    @Test("whenAMonthlySuggestionChanged_HouseholdModel_ShouldShowTheCurrentSuggestions")
    func staleMonthly() async throws {
        let fake = FakeHouseholds.standard()
        let model = try #require(Self.directory(fake).model(for: FakeHouseholds.home))
        await model.refresh()
        let outdated = WireTransfer(fromUserId: FakeHouseholds.bea, toUserId: FakeHouseholds.me, amountCents: 2500)
        guard case .stale(let current) = await model.recordMonthly(outdated, month: FakeHouseholds.november) else {
            Issue.record("expected stale")
            return
        }
        #expect(current.count == 2)
        guard case .recorded = await model.recordMonthly(current[0], month: FakeHouseholds.november) else {
            Issue.record("the current suggestion should record")
            return
        }
        #expect(model.recap?.suggestions.count == 1)
    }

    @Test("whenLeavingWithABalance_HouseholdModel_ShouldShowTheRestrictionAndStay")
    func leaveRestricted() async throws {
        let fake = FakeHouseholds.standard()
        let directory = Self.directory(fake)
        await directory.refresh()
        let model = try #require(directory.model(for: FakeHouseholds.home))
        await model.refresh()
        fake.fail("leaveHousehold", with: .conflict(message: "Settle every monthly balance before leaving."))
        let refused = await model.leave()
        #expect(refused?.kind == .restricted)
        #expect(model.notice?.message == "Settle every monthly balance before leaving.")
        #expect(directory.isListed(FakeHouseholds.home))
        #expect(await model.leave() == nil)
        #expect(!directory.isListed(FakeHouseholds.home), "a household the viewer left leaves the list")
    }

    @Test("whenArchivedElsewhere_HouseholdModel_ShouldBecomeReadOnlyAndRefuseWrites")
    func archivedElsewhere() async throws {
        let fake = FakeHouseholds.standard()
        let model = try #require(Self.directory(fake).model(for: FakeHouseholds.home))
        await model.refresh()
        #expect(!model.isReadOnly)
        fake.state.withLock { _ = $0.archived.insert(FakeHouseholds.home) }
        await model.refresh()
        #expect(model.isArchived)
        #expect(model.readOnlyReason != nil)
        let refused = await model.rename("New name")
        #expect(refused?.kind == .membership)
        #expect(!fake.calls.contains("renameHousehold"), "a read-only page sends nothing")
    }

    @Test("whenRemovedElsewhere_HouseholdModel_ShouldExplainTheMembershipChange")
    func removedElsewhere() async throws {
        let fake = FakeHouseholds.standard()
        let model = try #require(Self.directory(fake).model(for: FakeHouseholds.home))
        await model.refresh()
        fake.fail("deleteSharedExpense", with: .notFound(message: "Household not found."))
        let expense = try #require(model.expense("hydro"))
        let refused = await model.deleteExpense(expense)
        #expect(refused?.kind == .membership)
        #expect(refused?.message.contains("no longer a member") == true)
    }

    @Test("whenAFormerMemberOpensALaterMonth_HouseholdModel_ShouldShowAnEmptyMonthNotAnError")
    func formerMemberMonth() async throws {
        let fake = FakeHouseholds.standard()
        fake.state.withLock { state in
            state.members[FakeHouseholds.home] = [
                FakeHouseholds.member(FakeHouseholds.me, leftAt: 1_793_000_000_000),
                FakeHouseholds.member(FakeHouseholds.bea),
            ]
        }
        let model = try #require(Self.directory(fake).model(for: FakeHouseholds.home))
        fake.fail("monthRecap", with: .notFound(message: "Month not found."))
        await model.refresh()
        #expect(model.load == .loaded)
        #expect(model.isReadOnly)
        #expect(model.expenses.isEmpty)
    }

    @Test("whenARuleIsPaused_HouseholdModel_ShouldSendTheRuleWithItsRevision")
    func pauseRule() async throws {
        let fake = FakeHouseholds.standard()
        let rule = WireSharedRule(
            id: "rule-1", householdId: FakeHouseholds.home, title: "Rent", totalCents: 290_000,
            payerUserId: FakeHouseholds.me, splitMode: "equal",
            category: WireSharedCategory(name: "Home", icon: "home", color: "#3B82F6"), frequency: "monthly",
            nextDate: "2026-12-01", revision: 4)
        fake.state.withLock { $0.rules["rule-1"] = rule }
        let model = try #require(Self.directory(fake).model(for: FakeHouseholds.home))
        await model.refresh()
        #expect(await model.setActive(rule, false) == nil)
        let sent = try #require(fake.state.withLock { $0.ruleBodies.last })
        #expect(sent.active == false)
        #expect(sent.revision == 4)
        #expect(sent.nextDate == "2026-12-01", "pausing keeps the next date")
    }
}

@Suite("Shared expense form (MAZ-75)")
@MainActor
struct SharedExpenseFormTests {
    static let category = WireSharedCategory(name: "Home", icon: "home-outline", color: "#3B82F6")
    static let today = CalendarDate("2026-11-04") ?? .earliest

    static func open(_ fake: FakeHouseholds, draft: SharedExpenseDraft? = nil) async throws -> SharedExpenseFormModel {
        let directory = HouseholdModelTests.directory(fake)
        let model = try #require(directory.model(for: FakeHouseholds.home))
        await model.refresh()
        let start =
            draft
            ?? SharedExpenseDraft(
                householdId: FakeHouseholds.home, payerId: FakeHouseholds.me, today: today, category: category)
        return SharedExpenseFormModel(draft: start, household: model, timezoneOffset: { 300 })
    }

    @Test("whenSplitEqually_SharedExpenseForm_ShouldPreviewTheServersRoundingAndYourShare")
    func equal() async throws {
        let form = try await Self.open(FakeHouseholds.standard())
        form.draft.amountText = "100"
        form.draft.title = "Groceries"
        #expect(form.participants.map(\.userId) == [FakeHouseholds.me, FakeHouseholds.bea, FakeHouseholds.cam])
        #expect(form.viewerShare == 3334, "the lexically first member gets the leftover cent")
        let saved = await form.save()
        guard case .expense(let expense) = saved else {
            Issue.record("expected a saved expense")
            return
        }
        let body = try #require(FakeHouseholdsBody.body(for: expense.id, in: form))
        #expect(body.splitMode == "equal")
        #expect(body.allocations == nil, "equal splits send no allocations")
        #expect(body.timezoneOffsetMinutes == 300)
        #expect(body.date == "2026-11-04")
    }

    @Test("whenTheDateIsBeforeAMemberJoined_SharedExpenseForm_ShouldLeaveThemOut")
    func membersOnTheDate() async throws {
        let form = try await Self.open(FakeHouseholds.standard())
        form.draft.date = try #require(CalendarDate("2026-10-01"))
        #expect(form.participants.map(\.userId) == [FakeHouseholds.me, FakeHouseholds.bea])
    }

    @Test("whenExactAmountsDontAddUp_SharedExpenseForm_ShouldKeepTheDraftAndSayHowMuchIsLeft")
    func exact() async throws {
        let fake = FakeHouseholds.standard()
        let form = try await Self.open(fake)
        form.draft.amountText = "96.30"
        form.draft.title = "Hydro"
        form.draft.switchMode(.exact, participants: form.participants)
        #expect(form.draft.exactTexts[FakeHouseholds.me] == "32.10", "switching starts from an even split")
        form.draft.exactTexts[FakeHouseholds.me] = "50.00"
        #expect(await form.save() == nil)
        #expect(form.problem == .exactRemaining(-1790))
        #expect(form.problem?.message(money: { "\($0)" }).contains("too much") == true)
        #expect(form.draft.exactTexts[FakeHouseholds.me] == "50.00", "the draft is kept as typed")
        #expect(!fake.calls.contains("createSharedExpense"))
        form.draft.exactTexts[FakeHouseholds.bea] = "14.20"
        let saved = await form.save()
        #expect(saved != nil)
    }

    @Test("whenPercentagesAddUp_SharedExpenseForm_ShouldSendBasisPoints")
    func percent() async throws {
        let fake = FakeHouseholds.standard()
        let form = try await Self.open(fake)
        form.draft.amountText = "100"
        form.draft.title = "Internet"
        form.draft.switchMode(.percent, participants: form.participants)
        form.draft.percentTexts = [FakeHouseholds.me: "50", FakeHouseholds.bea: "25", FakeHouseholds.cam: "24.5"]
        #expect(await form.save() == nil)
        #expect(form.problem == .percentRemaining(50))
        form.draft.percentTexts[FakeHouseholds.cam] = "25"
        #expect(form.viewerShare == 5000)
        guard case .expense(let expense) = await form.save() else {
            Issue.record("expected a saved expense")
            return
        }
        let body = try #require(FakeHouseholdsBody.body(for: expense.id, in: form))
        #expect(body.allocations?.compactMap(\.percentBasisPoints) == [5000, 2500, 2500])
    }

    @Test("whenSomeoneElsePays_SharedExpenseForm_ShouldNeverSendTheViewersAccount")
    func payerPrivacy() async throws {
        let fake = FakeHouseholds.standard()
        let form = try await Self.open(fake)
        form.draft.amountText = "30"
        form.draft.title = "Pizza"
        form.draft.accountId = "my-visa"
        form.draft.choosePayer(FakeHouseholds.bea, viewerId: form.viewerId)
        #expect(form.draft.accountId == nil, "an account belongs to the payer")
        guard case .expense(let expense) = await form.save() else {
            Issue.record("expected a saved expense")
            return
        }
        #expect(try #require(FakeHouseholdsBody.body(for: expense.id, in: form)).accountId == nil)
        // Editing another member's expense never sends an account either (the server keeps theirs).
        let theirs = FakeHouseholds.expense("theirs", payer: FakeHouseholds.bea)
        var withAccount = theirs
        withAccount.accountId = "bea-card"
        let draft = SharedExpenseDraft(editing: withAccount, viewerId: FakeHouseholds.me)
        #expect(draft.accountId == nil)
    }

    @Test("whenTheExpenseChangedElsewhere_SharedExpenseForm_ShouldOfferReviewLatestAndOverwriteNothing")
    func staleEdit() async throws {
        let fake = FakeHouseholds.standard()
        let original = FakeHouseholds.expense("hydro")
        let form = try await Self.open(fake, draft: SharedExpenseDraft(editing: original, viewerId: FakeHouseholds.me))
        form.draft.title = "Hydro (October)"
        fake.state.withLock { state in
            state.expenses["hydro"]?.title = "Hydro bill"
            state.expenses["hydro"]?.revision = 3
        }
        #expect(await form.save() == nil)
        #expect(form.isStale)
        #expect(form.failure?.kind == .stale)
        #expect(fake.state.withLock { $0.expenses["hydro"]?.title } == "Hydro bill", "nothing was overwritten")
        #expect(form.reviewLatest())
        #expect(form.draft.title == "Hydro bill")
        #expect(form.draft.original?.revision == 3)
        #expect(!form.hasChanges)
    }

    @Test("whenTheSaveFailsOffline_SharedExpenseForm_ShouldKeepTheDraftAndOfferItLater")
    func offlineDraft() async throws {
        let fake = FakeHouseholds.standard()
        let form = try await Self.open(fake)
        form.draft.amountText = "12.50"
        form.draft.title = "Coffee"
        form.draft.focus = .title
        fake.fail("createSharedExpense", with: .offline)
        #expect(await form.save() == nil)
        #expect(form.failure?.kind == .offline)
        #expect(form.failure?.canRetry == true)
        #expect(form.draft.title == "Coffee")
        #expect(form.hasChanges)
        form.keepDraft()
        let directory = try #require(form.household.directory)
        let kept = try #require(directory.drafts[form.draft.key])
        #expect(kept.title == "Coffee")
        #expect(kept.focus == .title, "the restored draft returns to the field that was being edited")
        // A successful save clears the kept draft.
        #expect(await form.save() != nil)
        #expect(directory.drafts[form.draft.key] == nil)
    }

    @Test("whenRepeating_SharedExpenseForm_ShouldCreateASharedRuleFromTheDate")
    func repeating() async throws {
        let fake = FakeHouseholds.standard()
        let form = try await Self.open(fake)
        form.draft.amountText = "2900"
        form.draft.title = "Rent"
        form.draft.repeats = .monthly
        guard case .rule(let rule) = await form.save() else {
            Issue.record("expected a rule")
            return
        }
        #expect(rule.frequency == "monthly")
        let body = try #require(fake.state.withLock { $0.ruleBodies.last })
        #expect(body.nextDate == "2026-11-04")
        #expect(body.revision == nil, "a create never sends a revision")
        #expect(!fake.calls.contains("createSharedExpense"))
    }

    @Test("whenAShareWasRepaid_SharedExpenseDraft_ShouldKeepThePaidParticipants")
    func paidExpense() async throws {
        let paid = FakeHouseholds.expense(
            "paid", splits: [(FakeHouseholds.me, 4500), (FakeHouseholds.bea, 4500)],
            payments: [
                WireExpensePayment(fromUserId: FakeHouseholds.bea, amountCents: 4500, createdAt: 0, createdBy: "x")
            ]
        )
        let form = try await Self.open(
            FakeHouseholds.standard(), draft: SharedExpenseDraft(editing: paid, viewerId: FakeHouseholds.me))
        #expect(form.draft.isPaidExpense)
        #expect(
            form.participants.map(\.userId) == [FakeHouseholds.me, FakeHouseholds.bea], "cam joined but isn't in it")
    }

    @Test("whenTheTitleIsMissing_SharedExpenseForm_ShouldRefuseBeforeSending")
    func validation() async throws {
        let fake = FakeHouseholds.standard()
        let form = try await Self.open(fake)
        form.draft.amountText = "12.345"
        #expect(await form.save() == nil)
        #expect(form.problem == .title)
        form.draft.title = "Lunch"
        #expect(await form.save() == nil)
        #expect(form.problem == .amount)
        #expect(form.refusedCount == 2)
        #expect(fake.calls.filter { $0 == "createSharedExpense" }.isEmpty)
    }
}

/// Reads what the fake server received for an expense.
@MainActor
enum FakeHouseholdsBody {
    static func body(for id: String, in form: SharedExpenseFormModel) -> WireExpenseInput? {
        (form.household.service as? FakeHouseholds)?.state.withLock { $0.bodies[id] }
    }
}

@Suite("Invite QR code (MAZ-75)")
struct InviteQRCodeTests {
    @Test("whenGenerated_InviteQRCode_ShouldDecodeToTheSameLink")
    func roundTrip() async throws {
        let link = InviteLink(
            code: try #require(InviteCode(typed: "4F2A9C01BE")), server: try ServerURL("https://penny.example.test"))
        let image = try #require(InviteQRCode.image(for: link.url))
        #expect(image.width > 200)
        let payloads = await InviteQRCode.decode(image)
        #expect(payloads == [link.url.absoluteString])
        let decoded = try InviteLink(scanned: try #require(payloads.first), allowsLoopbackHTTP: false)
        #expect(decoded == link)
        #expect(InviteQRCode.png(for: link.url)?.isEmpty == false)
    }
}
