import Foundation
import PennyContracts
import PennyDomain
import Testing

/// Every case of contracts/fixtures/shared-currency.json (MAZ-151 phase 2) against the Swift
/// rules, which port apps/web/src/domain/households.ts (`memberAmounts`, `settleIn`,
/// `sharedExpenseCurrencyProblem`) and householdProjection.ts (`sharedAmounts` in the
/// `ledgerWithHouseholds` join, here `LedgerReport`).
@Suite("Shared currencies")
struct SharedCurrencyTests {
    static let fixture = Result { try Fixtures.decode(SharedCurrencyFixture.self, from: "shared-currency.json") }

    private func load() throws -> SharedCurrencyFixture { try Self.fixture.get() }

    @Test("whenGoldenMemberAmountsCase_MemberAmounts_ShouldConvertWhatWasPaidAndKeepTheShareProportion")
    func memberAmounts() throws {
        for item in try load().memberAmounts {
            let compute = { () throws(SharedAmountError) -> MemberAmounts? in
                try SharedCurrency.memberAmounts(
                    totalCents: item.expense.totalCents, originalAmount: item.expense.originalAmount,
                    originalCurrency: item.expense.originalCurrency, shareCents: item.shareCents,
                    householdCurrency: item.householdCurrency, home: item.home, rate: item.rate)
            }
            if item.error != nil {
                do {
                    _ = try compute()
                    Issue.record("\(item.name) should fail")
                } catch {
                    #expect(error.message == item.error, "\(item.name)")
                }
            } else {
                let expected = item.expected.map { MemberAmounts(totalCents: $0.totalCents, shareCents: $0.shareCents) }
                #expect(try compute() == expected, "\(item.name)")
            }
        }
    }

    @Test("whenGoldenSettleInCase_SettleIn_ShouldSuggestInTheHouseholdCurrencyThenConvertEachFigure")
    func settleIn() throws {
        for item in try load().settleIn {
            let balances = item.balances.map { SharedBalance(userId: $0.userId, balanceCents: $0.balanceCents) }
            if let expected = item.expected {
                let result = try SharedCurrency.settleIn(balances, from: item.from, to: item.to, rate: item.rate)
                #expect(
                    result.balances
                        == expected.balances.map { SharedBalance(userId: $0.userId, balanceCents: $0.balanceCents) },
                    "\(item.name)")
                #expect(
                    result.suggestions
                        == expected.suggestions.map {
                            SharedTransfer(
                                fromUserId: $0.fromUserId, toUserId: $0.toUserId, amountCents: $0.amountCents)
                        }, "\(item.name)")
            } else {
                do {
                    _ = try SharedCurrency.settleIn(balances, from: item.from, to: item.to, rate: item.rate)
                    Issue.record("\(item.name) should fail")
                } catch {
                    #expect(error.message == item.error, "\(item.name)")
                }
            }
        }
    }

    @Test("whenGoldenExpenseCase_ExpenseCurrencyProblem_ShouldNameTheSameReason")
    func expenses() throws {
        for item in try load().expenses {
            let expense = item.expense
            let status = try expense.rateStatus.map { try #require(RateStatus(rawValue: $0)) }
            let date = try expense.rateDate.map(ContractLedger.date)
            #expect(
                SharedCurrency.expenseCurrencyProblem(
                    totalCents: expense.totalCents, originalAmount: expense.originalAmount,
                    originalCurrency: expense.originalCurrency, rate: expense.rate, rateStatus: status, rateDate: date,
                    householdCurrency: item.householdCurrency) == item.problem, "\(item.name)")
        }
    }

    @Test("whenGoldenProjection_LedgerReport_ShouldCountEachRowAtItsHomeAmountsWithWhatWasPaid")
    func projection() throws {
        let fixture = try load().projection
        let ledger = try ContractLedger.ledger(fixture.ledger)
        let shares = try fixture.rows.map(Self.share)
        let report = LedgerReport(ledger: ledger, shared: shares)
        let rows = report.recorded.filter { $0.source != .personal }
        #expect(rows.map(\.id) == fixture.expected.map(\.id))
        for (row, expected) in zip(rows, fixture.expected) {
            #expect(row.total == expected.total, "\(expected.id)")
            #expect(row.share == expected.share, "\(expected.id)")
            #expect(row.originalAmount == expected.originalAmount, "\(expected.id)")
            #expect(row.originalCurrency == expected.originalCurrency, "\(expected.id)")
            #expect(row.rate == expected.rate, "\(expected.id)")
            #expect(row.rateStatus?.rawValue == expected.rateStatus, "\(expected.id)")
            #expect(row.rateDate?.description == expected.rateDate, "\(expected.id)")
        }
        // The month counts the home shares only (no row in another currency without them).
        let november = report.month(try #require(MonthKey("2026-11")))
        #expect(november.recorded.expense == 4389 + 1115 + 6210 + 4500)
    }

    @Test("whenShareExceedsTotal_ProportionHalfUp_ShouldRefuse")
    func proportion() throws {
        #expect(try Currencies.proportionHalfUp(6400, of: 25600, applied: 37325) == 9331)
        #expect(try Currencies.proportionHalfUp(5, of: 5, applied: 7) == 7)
        #expect(throws: SharedAmountError.shareExceedsTotal) { try Currencies.proportionHalfUp(6, of: 5, applied: 7) }
        #expect(throws: SharedAmountError.shareExceedsTotal) { try Currencies.proportionHalfUp(0, of: 0, applied: 7) }
        #expect(throws: SharedAmountError.notWholeMinorUnits) {
            try Currencies.proportionHalfUp(-1, of: 5, applied: 7)
        }
    }

    @Test("whenBalancesListAMemberTwice_SuggestReimbursements_ShouldRefuse")
    func duplicateMember() {
        let balances = [SharedBalance(userId: "a", balanceCents: 5), SharedBalance(userId: "a", balanceCents: -5)]
        #expect(throws: SharedAmountError.duplicateMember) { try SharedCurrency.suggestReimbursements(balances) }
    }

    @Test("whenHomeAmountsAreForAnotherCurrency_Amounts_ShouldLeaveTheRowOut")
    func otherHome() throws {
        let share = SharedExpenseShare(
            id: "x", householdId: "h", currency: "EUR", title: "Fado", date: try ContractLedger.date("2026-11-27"),
            total: 12_000, share: 3_000, category: .init(name: "Travel", icon: "airplane-outline", color: "#5B7DB1"))
        #expect(share.amounts(home: "CAD") == nil)
        #expect(share.amounts(home: "EUR")?.share == 3_000)
    }

    /// A fixture row as the projection model reads it.
    static func share(_ row: SharedCurrencyFixture.Row) throws -> SharedExpenseShare {
        var share = SharedExpenseShare(
            id: row.id, householdId: row.householdId, currency: row.householdCurrency, title: row.title,
            date: try ContractLedger.date(row.date), total: row.totalCents, share: row.shareCents,
            category: .init(name: row.category.name, icon: row.category.icon, color: row.category.color),
            note: row.note, householdName: row.householdName)
        share.originalAmount = row.originalAmount
        share.originalCurrency = row.originalCurrency
        share.rate = row.rate
        share.rateStatus = try row.rateStatus.map { try #require(RateStatus(rawValue: $0)) }
        share.rateDate = try row.rateDate.map(ContractLedger.date)
        share.home = try row.home.map {
            SharedHomeAmounts(
                currency: $0.currency, totalCents: $0.totalCents, shareCents: $0.shareCents, rate: $0.rate,
                rateStatus: try $0.rateStatus.map { try #require(RateStatus(rawValue: $0)) },
                rateDate: try $0.rateDate.map(ContractLedger.date))
        }
        return share
    }
}
