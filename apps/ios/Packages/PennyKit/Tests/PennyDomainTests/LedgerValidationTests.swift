import Foundation
import PennyContracts
import PennyDomain
import Testing

@Suite("Ledger validation")
struct LedgerValidationTests {
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
        // The id limit is 1...100 UTF-16 code units of the id itself (`LedgerLimits.IdLength`).
        #expect(violations { $0.transactions[0].id = String(repeating: "x", count: 100) }.isEmpty)
        #expect(
            violations { $0.transactions[0].id = String(repeating: "x", count: 101) } == [.invalidID("transactions")])
        #expect(violations { $0.transactions[0].id = String(repeating: "é", count: 100) }.isEmpty)
        #expect(
            violations { $0.transactions[0].id = String(repeating: "😀", count: 51) } == [.invalidID("transactions")])
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

    @Test("whenIdsAreUUIDsOrUUIDOccurrences_Violations_ShouldBeEmpty")
    func uuidIDs() {
        let rule = "0F8FAD5B-D9CB-469F-A165-70867728950E"
        let entry = "7C9E6679-7425-40DE-944B-E07FC1F90AE7"
        var ledger = Sample.ledger(
            transactions: [
                Sample.entry(entry, "2026-01-01", recurringId: rule),
                Sample.entry("\(rule):2026-01-01", "2026-01-01", recurringId: rule),
            ],
            recurring: [Sample.rule(rule, start: "2026-01-01", next: "2026-02-01")])
        ledger.accounts = [PaymentAccount(id: "A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11", name: "Visa", type: .credit)]
        ledger.transactions[0].accountId = ledger.accounts[0].id
        #expect(ledger.violations.isEmpty)
        // Ids that differ only by canonical equivalence are distinct, as on the server.
        ledger.transactions[1].id = "caf\u{E9}"
        ledger.transactions[0].id = "cafe\u{301}"
        #expect(ledger.violations.isEmpty)
        ledger.transactions[0].id = "caf\u{E9}"
        #expect(ledger.violations == [.duplicateID("transactions")])
    }

    /// .NET `LedgerText.IsStorable`: PostgreSQL text cannot hold NUL, so the server refuses
    /// any string field that contains one.
    @Test("whenATextFieldHoldsNUL_Violations_ShouldRefuseItLikeTheServer")
    func nulText() {
        func violations(_ change: (inout PennyDomain.Ledger) -> Void) -> [LedgerViolation] {
            var ledger = Sample.ledger(
                transactions: [Sample.entry("e", "2026-01-01")], recurring: [Sample.rule("r", start: "2026-01-01")])
            change(&ledger)
            return ledger.violations
        }
        let nul = "a\u{0}b"
        #expect(violations { $0.transactions[0].id = nul } == [.invalidID("transactions")])
        #expect(violations { $0.transactions[0].title = nul } == [.invalidText("e")])
        #expect(violations { $0.transactions[0].note = nul } == [.invalidText("e")])
        #expect(violations { $0.recurring[0].title = nul } == [.invalidText("r")])
        #expect(violations { $0.recurring[0].note = nul } == [.invalidText("r")])
        #expect(violations { $0.transactions[0].recurringId = nul } == [.invalidID("e")])
        #expect(
            violations {
                $0.transactions[0].receipt = ReceiptReference(id: "rc", name: nul, uri: "u", mime: "image/jpeg")
            } == [.invalidText("e")])
        #expect(
            violations {
                $0.transactions[0].receipt = ReceiptReference(id: nul, name: "n", uri: "u", mime: "image/jpeg")
            } == [.invalidID("e")])
        #expect(violations { $0.accounts[0].name = nul } == [.invalidName("visa")])
        #expect(violations { $0.trips[0].name = nul } == [.invalidName("lisbon")])
        #expect(violations { $0.trips[0].sharedHouseholdId = nul } == [.invalidID("trips")])
        #expect(violations { $0.categories[0].name = nul } == [.invalidName("groceries")])
        #expect(violations { $0.categories[0].icon = nul } == [.invalidText("groceries")])
        // Other control characters and paired surrogates are storable.
        #expect(violations { $0.transactions[0].note = "a\u{1}\u{7F}b😀" }.isEmpty)
    }

    /// The other half of `IsStorable`, unpaired surrogates, cannot reach a ledger: Swift
    /// strings are always well-formed. This pins that assumption, so a toolchain that started
    /// keeping lone surrogates would fail here instead of letting one reach the server.
    @Test("whenTextHasAnUnpairedSurrogate_SwiftString_ShouldNeverHoldIt")
    func unpairedSurrogatesAreUnrepresentable() throws {
        for units: [UInt16] in [[0x61, 0xD83D], [0xDE00, 0x61], [0xDE00, 0xD83D]] {
            let bridged = NSString(characters: units, length: units.count) as String
            #expect(!bridged.utf16.contains { UTF16.isLeadSurrogate($0) || UTF16.isTrailSurrogate($0) })
            #expect(String(decoding: units, as: UTF16.self).unicodeScalars.contains("\u{FFFD}"))
        }
        let json = Data(#"["a\ud83d"]"#.utf8)
        #expect(throws: (any Error).self) { try JSONDecoder().decode([String].self, from: json) }
    }
}
