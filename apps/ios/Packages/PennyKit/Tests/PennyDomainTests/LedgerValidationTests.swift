import PennyContracts
import PennyDomain
import Testing

@Suite("Ledger validation and upgrades")
struct LedgerValidationTests {
    @Test("whenGoldenUpgradeCase_UpgradedCategories_ShouldMatchLedgerUpgradesFixture")
    func goldenUpgrades() throws {
        let cases = try Fixtures.decode([LedgerUpgradeCase].self, from: "ledger-upgrades.json")
        #expect(cases.count == 4)
        for item in cases {
            let input = try ContractLedger.ledger(item.input)
            let expected = try ContractLedger.ledger(item.expected)
            let categories = try #require(
                PennyDomain.Ledger.upgradedCategories(input.categories, fromVersion: item.input.version))
            var upgraded = input
            upgraded.categories = categories
            #expect(upgraded == expected, "\(item.name)")
            #expect(expected.violations.isEmpty, "\(item.name)")
        }
    }

    @Test("whenVersion1Upgrade_UpgradedCategories_ShouldSuffixOnCollisionAndRespectLimits")
    func upgradeEdges() throws {
        let food = LedgerCategory(id: "food", name: "Food", icon: "i", color: "#E47850", kind: .expense)
        let taken = [
            food, LedgerCategory(id: "investments", name: "Inv", icon: "i", color: "#E47850", kind: .expense),
            LedgerCategory(id: "investments-1", name: "Inv1", icon: "i", color: "#E47850", kind: .expense),
        ]
        #expect(PennyDomain.Ledger.upgradedCategories(taken, fromVersion: 1)?.last?.id == "investments-2")
        let hasInvestment = [
            food, LedgerCategory(id: "etf", name: "ETF", icon: "i", color: "#E47850", kind: .investment),
        ]
        #expect(PennyDomain.Ledger.upgradedCategories(hasInvestment, fromVersion: 1) == hasInvestment)
        let full = (0..<300).map {
            LedgerCategory(id: "c\($0)", name: "C", icon: "i", color: "#E47850", kind: .expense)
        }
        #expect(PennyDomain.Ledger.upgradedCategories(full, fromVersion: 1) == full)
        #expect(PennyDomain.Ledger.upgradedCategories([food], fromVersion: 2) == [food])
        for version in [0, 5, -1] {
            #expect(PennyDomain.Ledger.upgradedCategories([food], fromVersion: version) == nil)
        }
    }

    @Test("whenSeedAndSearchLedgers_Violations_ShouldBeEmpty")
    func fixtureLedgersAreValid() throws {
        #expect(try ContractLedger.alexSeed().ledger.violations.isEmpty)
        #expect(try ContractLedger.ledger(LocalSearchCases.load().ledger).violations.isEmpty)
    }

    @Test("whenEachRuleIsBroken_Violations_ShouldNameIt")
    func brokenRules() {
        func violations(_ change: (inout PennyDomain.Ledger) -> Void) -> [LedgerViolation] {
            var ledger = Sample.ledger(
                transactions: [Sample.entry("e", "2026-01-01")], recurring: [Sample.rule("r", start: "2026-01-01")])
            change(&ledger)
            return ledger.violations
        }
        #expect(violations { _ in }.isEmpty)
        #expect(
            violations { $0.transactions.append(Sample.entry("e", "2026-01-02")) } == [.duplicateID("transactions")])
        #expect(violations { $0.transactions[0].id = "" } == [.invalidID("transactions")])
        #expect(
            violations { $0.transactions[0].id = String(repeating: "x", count: 101) } == [.invalidID("transactions")])
        #expect(violations { $0.transactions[0].title = "" } == [.invalidText("e")])
        #expect(violations { $0.transactions[0].note = String(repeating: "n", count: 1001) } == [.invalidText("e")])
        #expect(violations { $0.transactions[0].share = 1001 } == [.invalidAmounts("e")])
        #expect(violations { $0.transactions[0].total = 0 } == [.invalidAmounts("e")])
        #expect(violations { $0.transactions[0].categoryId = "salary" } == [.invalidCategory("e")])
        #expect(violations { $0.transactions[0].accountId = "gone" } == [.invalidAccount("e")])
        #expect(violations { $0.transactions[0].tripId = "gone" } == [.invalidTrip("e")])
        #expect(violations { $0.transactions[0].date = .day("1999-12-31") } == [.dateOutOfRange("e")])
        #expect(
            violations {
                $0.transactions[0] = Sample.entry(
                    "e", "2026-01-01", share: 50, total: 100, kind: .income, tripId: "lisbon")
            } == [.invalidShare("e"), .invalidTrip("e")])
        #expect(violations { $0.recurring[0].anchorDay = 32 } == [.invalidAnchorDay("r")])
        #expect(violations { $0.recurring[0].nextDate = .day("2101-01-01") } == [.dateOutOfRange("r")])
        #expect(violations { $0.categories[0].color = "#12345G" } == [.invalidColor("groceries")])
        #expect(violations { $0.categories[0].icon = String(repeating: "i", count: 81) } == [.invalidText("groceries")])
        #expect(violations { $0.accounts[0].name = " \u{FEFF}" } == [.invalidName("visa")])
        #expect(violations { $0.trips[0].endDate = .day("2026-11-01") } == [.invalidTripDates("lisbon")])
        #expect(
            violations {
                $0.accounts = (0...300).map { PaymentAccount(id: "a\($0)", name: "A", type: .bank) }
            } == [.tooMany("accounts")])
    }
}
