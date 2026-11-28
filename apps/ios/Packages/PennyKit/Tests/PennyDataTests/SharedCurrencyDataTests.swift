import Foundation
import PennyData
import PennyDomain
import Testing

/// Shared trips and households in any currency on the client side (MAZ-151 phase 2, contract
/// 2.6.0): wire fields older servers omit, the viewer's amounts, the trip's totals in their
/// currency, Settle in, the shared expense form paid in another currency, and trip currencies.
/// Fixture ids and `.test` data only.
@Suite("Shared currencies in the app")
@MainActor
struct SharedCurrencyDataTests {
    static let me = FakeHouseholds.me
    static let bea = FakeHouseholds.bea
    static let travel = WireSharedCategory(name: "Travel", icon: "airplane-outline", color: "#5B7DB1")

    /// €120.00 split two ways, paid by Bea; €60.00 is Alex's, $87.78 at 1.463 CAD per euro.
    static func fado(provisional: Bool = false) -> WireSharedExpense {
        var expense = FakeHouseholds.expense(
            "fado", total: 12_000, payer: bea, splits: [(me, 6_000), (bea, 6_000)], date: "2026-11-27")
        expense.home = WireMemberHomeAmounts(
            currency: "CAD", totalCents: 17_556, shareCents: 8_778, rate: "1.463",
            rateStatus: provisional ? "provisional" : "published", rateDate: "2026-11-26")
        return expense
    }

    /// US$600.00 at 0.94 EUR per dollar is €564.00; Alex's half is $411.90.
    static func flights() -> WireSharedExpense {
        var expense = FakeHouseholds.expense(
            "flights", total: 56_400, payer: bea, splits: [(me, 28_200), (bea, 28_200)], date: "2026-10-02")
        expense.originalAmount = 60_000
        expense.originalCurrency = "USD"
        expense.rate = "0.94"
        expense.rateStatus = "published"
        expense.rateDate = "2026-10-02"
        expense.home = WireMemberHomeAmounts(
            currency: "CAD", totalCents: 82_380, shareCents: 41_190, rate: "1.373", rateStatus: "published",
            rateDate: "2026-10-02")
        return expense
    }

    /// Paid in CAD (Alex's currency) in a euro trip: exact, no rate.
    static func insurance() -> WireSharedExpense {
        var expense = FakeHouseholds.expense(
            "insurance", total: 1_526, payer: me, splits: [(me, 763), (bea, 763)], date: "2026-11-03")
        expense.originalAmount = 2_230
        expense.originalCurrency = "CAD"
        expense.rate = "0.6843"
        expense.rateStatus = "published"
        expense.rateDate = "2026-11-03"
        expense.home = WireMemberHomeAmounts(currency: "CAD", totalCents: 2_230, shareCents: 1_115)
        return expense
    }

    @Test("whenAnOlderServerOmitsTheNewFields_WireModels_ShouldDecodeWithoutThem")
    func olderServer() throws {
        let member = try JSONDecoder().decode(
            WireHouseholdMember.self, from: Data(#"{"userId":"u","email":"a@example.test","joinedAt":1}"#.utf8))
        #expect(member.currency == nil)
        let trip = try JSONDecoder().decode(
            WireTrip.self,
            from: Data(#"{"id":"t","name":"Lisbon","startDate":"2026-11-12","endDate":"2026-11-19"}"#.utf8))
        #expect(trip.currency == nil)
        let encoded = String(decoding: try JSONEncoder().encode(trip), as: UTF8.self)
        #expect(!encoded.contains("currency"), "a trip without a currency round-trips without one")
        let row = try JSONDecoder().decode(
            WireProjectedExpense.self,
            from: Data(
                ##"{"id":"e","householdId":"h","householdCurrency":"EUR","title":"Fado","date":"2026-11-27","totalCents":12000,"shareCents":3000,"payerUserId":"u","category":{"name":"Fun","icon":"happy","color":"#E47850"},"note":"","home":{"currency":"CAD","totalCents":17556,"shareCents":4389,"rate":"1.463","rateStatus":"provisional","rateDate":"2026-11-26"}}"##
                    .utf8))
        #expect(row.home?.shareCents == 4_389)
        #expect(row.originalCurrency == nil)
    }

    @Test("whenTheTripIsInAnotherCurrency_Amounts_ShouldLeadWithWhatWasPaidAndGiveTheHomeAmounts")
    func amounts() {
        let fado = Self.fado(provisional: true).amounts(householdCurrency: "EUR", home: "CAD", meId: Self.me)
        #expect(fado.paid == 12_000 && fado.paidCurrency == "EUR")
        #expect(fado.homeTotal == 17_556 && fado.homeShare == 8_778)
        #expect(fado.provisional && fado.showsHome)
        let insurance = Self.insurance().amounts(householdCurrency: "EUR", home: "CAD", meId: Self.me)
        #expect(insurance.paidCurrency == "CAD" && !insurance.showsHome, "paid in your currency: nothing under it")
        var noRate = Self.fado()
        noRate.home = nil
        #expect(noRate.amounts(householdCurrency: "EUR", home: "CAD", meId: Self.me).homeTotal == nil)
        // A household in your currency: its own amounts, with what was paid.
        var tapas = FakeHouseholds.expense("tapas", total: 12_420, splits: [(Self.me, 6_210), (Self.bea, 6_210)])
        tapas.originalAmount = 8_500
        tapas.originalCurrency = "EUR"
        tapas.rate = "1.4612"
        tapas.rateStatus = "provisional"
        let home = tapas.amounts(householdCurrency: "CAD", home: "CAD", meId: Self.me)
        #expect(home.paid == 8_500 && home.homeTotal == 12_420 && home.homeShare == 6_210 && home.provisional)
    }

    @Test("whenTheTripIsInAnotherCurrency_SharedTripTotals_ShouldAddHomeAmountsAndPrivateEntries")
    func totals() {
        let range = TripRange(start: TripFixtures.day("2026-11-12"), end: TripFixtures.day("2026-11-19"))
        var noRate = Self.fado()
        noRate.id = "no-rate"
        noRate.home = nil
        let expenses = [Self.fado(), Self.flights(), Self.insurance(), noRate]
        let mine = [TripFixtures.expense("train", date: "2026-11-13", share: 2_400)]
        let totals = SharedTripTotals(
            expenses: expenses, meId: Self.me, personal: mine, range: range, householdCurrency: "EUR", home: "CAD")
        #expect(totals.tripTotal == 17_556 + 82_380 + 2_230)
        #expect(totals.sharedShare == 8_778 + 41_190 + 1_115)
        #expect(totals.yourSpending == totals.sharedShare + 2_400)
        #expect(totals.unconverted == 1)
        let own = SharedTripTotals(
            expenses: expenses, meId: Self.me, personal: [], range: range, householdCurrency: "EUR", home: "EUR")
        #expect(own.tripTotal == 12_000 + 56_400 + 1_526 + 12_000, "in the trip's currency, its own amounts")
        #expect(
            SharedTripCurrencies.list(expenses, householdCurrency: "EUR", home: "CAD") == ["EUR", "USD", "CAD"],
            "the trip's currency first, yours last")
    }

    @Test("whenSettlingInAnotherCurrency_SettleView_ShouldConvertEachFigureAndKeepTheTransfer")
    func settle() throws {
        let recap = WireMonthRecap(
            month: "2026-11",
            balances: [
                WireBalance(userId: "jo", balanceCents: -11_500), WireBalance(userId: "mira", balanceCents: -22_737),
                WireBalance(userId: "sam", balanceCents: 32_900), WireBalance(userId: "you", balanceCents: 1_337),
            ],
            suggestions: [
                WireTransfer(fromUserId: "mira", toUserId: "sam", amountCents: 22_737),
                WireTransfer(fromUserId: "jo", toUserId: "sam", amountCents: 10_163),
                WireTransfer(fromUserId: "jo", toUserId: "you", amountCents: 1_337),
            ])
        let view = try #require(SettleView(recap: recap, from: "EUR", to: "CAD", rate: "1.463"))
        #expect(view.balances["sam"] == 48_133 && view.balances["jo"] == -16_825)
        #expect(view.payments.map(\.shownCents) == [33_264, 14_868, 1_956])
        #expect(view.payments.map(\.transfer) == recap.suggestions, "Record paid records the trip's amounts")
        let same = SettleView(recap: recap, currency: "EUR")
        #expect(same.payments.map(\.shownCents) == [22_737, 10_163, 1_337])
        var broken = recap
        broken.balances[0].balanceCents += 1
        #expect(SettleView(recap: broken, from: "EUR", to: "CAD", rate: "1.463") == nil)
        let members = [
            FakeHouseholds.member(Self.me), FakeHouseholds.member(Self.bea), FakeHouseholds.member("left", leftAt: 1),
        ]
        var withCurrencies = members
        withCurrencies[0].currency = "CAD"
        withCurrencies[1].currency = "USD"
        withCurrencies[2].currency = "JPY"
        #expect(SettleView.options(householdCurrency: "EUR", members: withCurrencies) == ["EUR", "CAD", "USD"])
        #expect(!SettleView.isMultiCurrency(householdCurrency: "CAD", home: "CAD", members: members, expenses: []))
        #expect(
            SettleView.isMultiCurrency(householdCurrency: "CAD", home: "CAD", members: withCurrencies, expenses: []))
        #expect(SettleView.isMultiCurrency(householdCurrency: "EUR", home: "CAD", members: members, expenses: []))
    }

    @Test("whenPaidInAnotherCurrency_SharedExpenseDraft_ShouldSendTheConvertedTotalAndWhatWasPaid")
    func foreignDraft() throws {
        var draft = SharedExpenseDraft(
            householdId: "trip", payerId: Self.me, today: TripFixtures.day("2026-10-02"), category: Self.travel)
        draft.currency = "EUR"
        draft.title = "Flights"
        draft.amountText = "600"
        draft.repeats = .monthly
        draft.setPaidCurrency("USD")
        #expect(draft.repeats == nil, "an expense in another currency can't repeat")
        let members = [FakeHouseholds.member(Self.me), FakeHouseholds.member(Self.bea)]
        #expect(draft.validate(participants: members) == .failure(.rate))
        draft.applyRate(RateChoice(rate: "0.94", status: .published, date: TripFixtures.day("2026-10-02")))
        #expect(draft.totalCents == 56_400)
        let valid = try draft.validate(participants: members).get()
        #expect(valid.shares.map(\.amountCents) == [28_200, 28_200], "splits stay in the trip's currency")
        let input = draft.expenseInput(valid, viewerId: Self.me, timezoneOffset: 300)
        #expect(input.totalCents == 56_400 && input.originalAmount == 60_000 && input.originalCurrency == "USD")
        #expect(input.rate == "0.94" && input.rateStatus == "published" && input.rateDate == "2026-10-02")
        #expect(
            SharedCurrency.expenseCurrencyProblem(
                totalCents: input.totalCents, originalAmount: input.originalAmount,
                originalCurrency: input.originalCurrency, rate: input.rate, rateStatus: .published,
                rateDate: TripFixtures.day("2026-10-02"), householdCurrency: "EUR") == nil,
            "the server's rule accepts what the form sends")
        // An edited rate never takes a looked-up one, and has no date.
        draft.applyRate(RateChoice(rate: "0.95", status: .edited))
        draft.applyRate(RateChoice(rate: "0.94", status: .published, date: TripFixtures.day("2026-10-02")))
        #expect(draft.rate == "0.95" && draft.rateDate == nil)
        #expect(draft.expenseInput(valid, viewerId: Self.me, timezoneOffset: 300).rateDate == nil)
        // Back to the trip's currency: no foreign fields.
        draft.setPaidCurrency("EUR")
        #expect(!draft.isForeign && draft.rate == nil && draft.totalCents == 60_000)
        let home = try draft.validate(participants: members).get()
        #expect(draft.expenseInput(home, viewerId: Self.me, timezoneOffset: 300).originalCurrency == nil)
    }

    @Test("whenTheHouseholdIsInYen_SharedExpenseDraft_ShouldReadWholeAmounts")
    func yen() {
        var draft = SharedExpenseDraft(
            householdId: "tokyo", payerId: Self.me, today: TripFixtures.day("2026-11-03"), category: Self.travel)
        draft.currency = "JPY"
        draft.amountText = "12000"
        #expect(draft.totalCents == 12_000)
        draft.amountText = "12000.5"
        #expect(draft.totalCents == nil)
        #expect(SharedExpenseDraft.amountText(1_200, currency: "JPY") == "1200")
        #expect(SharedExpenseDraft.amountText(12_345, currency: "KWD") == "12.345")
        #expect(SharedExpenseDraft.amountText(1_205, currency: "EUR") == "12.05")
        let edited = SharedExpenseDraft(editing: Self.flights(), viewerId: Self.me, currency: "EUR")
        #expect(edited.paidCurrency == "USD" && edited.amountText == "600.00" && edited.totalCents == 56_400)
    }

    @Test("whenATripHasACurrency_TripFormModel_ShouldStoreItOrCreateTheSharedTripInIt")
    func tripForm() async {
        let box = LedgerBox(Ledger())
        let form = TripFormModel(target: .new, today: TripFixtures.day("2026-11-12"), makeID: { "lisbon" })
        form.draft.name = "Lisbon"
        #expect(form.currency(home: .cad) == "CAD")
        form.currency = "EUR"
        guard case .personal(let trip) = await form.save(commit: box.commit, trips: nil, currency: .cad) else {
            Issue.record("expected a personal trip")
            return
        }
        #expect(trip.currency == "EUR" && box.ledger.trips.first?.currency == "EUR")
        let home = TripFormModel(target: .personal(trip), today: TripFixtures.day("2026-11-12"))
        #expect(home.currency == "EUR" && !home.currencyIsLocked)
        home.currency = "CAD"
        guard case .personal(let back) = await home.save(commit: box.commit, trips: nil, currency: .cad) else {
            Issue.record("expected a personal trip")
            return
        }
        #expect(back.currency == nil, "the home currency is stored as none")

        let fake = FakeHouseholds()
        let shared = TripFormModel(target: .new, today: TripFixtures.day("2026-11-12"))
        shared.draft.name = "Kyoto"
        shared.share = true
        shared.currency = "JPY"
        guard
            case .shared(let household) = await shared.save(
                commit: box.commit, trips: TripFixtures.trips(fake), currency: .cad)
        else {
            Issue.record("expected a shared trip")
            return
        }
        #expect(household.currency == "JPY")
        let editing = TripFormModel(target: .shared(household), today: TripFixtures.day("2026-11-12"))
        #expect(editing.currencyIsLocked && editing.currency == "JPY")
    }

    @Test("whenATripHasACurrency_ShareTrip_ShouldCreateTheSharedTripInIt")
    func shareTrip() async {
        var trip = TripFixtures.personal
        trip.currency = "EUR"
        let box = LedgerBox(Ledger(trips: [trip]))
        let fake = FakeHouseholds()
        guard
            case .shared(let household) = await TripFixtures.trips(fake).share(trip, currency: .cad, commit: box.commit)
        else {
            Issue.record("expected a shared trip")
            return
        }
        #expect(household.currency == "EUR")
    }

    @Test("whenALedgerTripHasACurrency_LedgerWireMapping_ShouldKeepIt")
    func wireMapping() throws {
        var trip = TripFixtures.personal
        trip.currency = "JPY"
        let ledger = Ledger(trips: [trip])
        let wire = WireLedger(ledger)
        #expect(wire.trips?.first?.currency == "JPY")
        #expect(try Ledger(wire: wire).trips.first?.currency == "JPY")
    }
}
