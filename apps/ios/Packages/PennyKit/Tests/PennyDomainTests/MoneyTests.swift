import PennyContracts
import PennyDomain
import Testing

@Suite("Integer-cent money")
struct MoneyTests {
    static func mode(_ text: String) throws -> Money.SplitMode {
        try #require(Money.SplitMode(rawValue: text))
    }

    static func message(_ body: () throws(LedgerRuleError) -> Int64) -> (Int64?, String?) {
        do {
            return (try body(), nil)
        } catch {
            return (nil, error.message)
        }
    }

    @Test("whenGoldenParseCase_Cents_ShouldMatchMoneyFixture")
    func goldenParse() throws {
        let fixture = try Fixtures.decode(MoneyFixture.self, from: "money.json")
        #expect(fixture.parse.count >= 20)
        for item in fixture.parse {
            let (cents, error) = Self.message { () throws(LedgerRuleError) in try Money.cents(item.input) }
            #expect(cents == item.cents && error == item.error, "input \(item.input.debugDescription)")
        }
    }

    @Test("whenGoldenShareCase_PersonalShare_ShouldMatchMoneyFixture")
    func goldenShares() throws {
        let fixture = try Fixtures.decode(MoneyFixture.self, from: "money.json")
        for item in fixture.personalShares {
            let mode = try Self.mode(item.mode)
            let (share, error) = Self.message { () throws(LedgerRuleError) in
                try Money.personalShare(total: item.total, mode: mode, input: item.input)
            }
            #expect(share == item.share && error == item.error, "\(item.total) \(item.mode) \(item.input)")
        }
    }

    @Test("whenGoldenStoredAmounts_IsValidAmounts_ShouldMatchServerBounds")
    func goldenStoredAmounts() throws {
        let fixture = try Fixtures.decode(MoneyFixture.self, from: "money.json")
        for item in fixture.ledgerAmounts {
            // Fractions are never integer cents, so they are invalid before any range check.
            let valid =
                if let total = Int64(exactly: item.total), let share = Int64(exactly: item.share) {
                    Money.isValidAmounts(total: total, share: share)
                } else {
                    false
                }
            #expect(valid == item.valid, "total \(item.total) share \(item.share)")
        }
    }

    @Test("whenParityCase_MoneyAndShares_ShouldMatchParityFixture")
    func parityCases() throws {
        let fixture = try Fixtures.decode(ParityFixture.self, from: "parity-cases.json")
        for item in fixture.money {
            let (cents, error) = Self.message { () throws(LedgerRuleError) in try Money.cents(item.input) }
            #expect(cents == item.cents && error == item.error)
        }
        for item in fixture.personalShares {
            let mode = try Self.mode(item.mode)
            let (share, error) = Self.message { () throws(LedgerRuleError) in
                try Money.personalShare(total: item.total, mode: mode, input: item.input)
            }
            #expect(share == item.share && error == item.error)
        }
    }

    @Test(
        "whenInputIsHostile_Cents_ShouldRefuseWithoutOverflow",
        arguments: [
            String(repeating: "9", count: 40), String(repeating: "0", count: 10) + "1",
            "1" + String(repeating: "0", count: 30) + ".00",
            "1..2", "1.2.3", "1,2,3", "12.3 4", "１２", "\u{0085}12", "12\u{0085}",
        ])
    func hostileInput(input: String) {
        #expect(throws: LedgerRuleError.invalidAmount) { try Money.cents(input) }
    }

    @Test("whenJavaScriptWhitespaceSurrounds_Cents_ShouldTrimLikeStringTrim")
    func javascriptTrim() throws {
        // U+FEFF and U+3000 are JavaScript whitespace; U+0085 (above) is not.
        #expect(try Money.cents("\u{FEFF}\u{3000}4,05\u{2029}\t") == 405)
        #expect(try Money.cents("000000001") == 100)
    }

    @Test("whenEverySplitOfABoundaryTotal_EqualShare_ShouldRoundHalfUpAndStayWithinTotal")
    func equalShareProperty() throws {
        for total: Int64 in [1, 2, 3, 99, 100, 101, 1001, 99_999, 99_999_999_999] {
            for people: Int64 in 2...100 {
                let share = try Money.personalShare(total: total, mode: .equal, input: String(people))
                // Half up: share is in (T/n - 1/2, T/n + 1/2], so exactly half a cent rounds up.
                #expect(2 * share * people > 2 * total - people && 2 * share * people <= 2 * total + people)
                #expect((0...total).contains(share))
            }
        }
    }

    @Test("whenEveryBasisPoint_PercentShare_ShouldRoundHalfUp")
    func percentShareProperty() throws {
        for total: Int64 in [1, 7, 1001, 99_999_999_999] {
            for basisPoints: Int64 in stride(from: 0, through: 10_000, by: 37) {
                let input = "\(basisPoints / 100).\(String(basisPoints % 100).leftPadded(2))"
                let share = try Money.personalShare(total: total, mode: .percent, input: input)
                let exact = total * basisPoints
                #expect(share * 10_000 * 2 > exact * 2 - 10_000 && share * 10_000 * 2 <= exact * 2 + 10_000, "\(input)")
            }
        }
    }

    @Test(
        "whenHeadCountIsNotAPlainInteger_EqualShare_ShouldRefuse",
        arguments: ["", " ", "2.5", "2.01", "-2", "+2", "1e1", "0x3", "two", "101", "1", "0", "99999999999999999999"])
    func headCountRefused(input: String) {
        #expect(throws: LedgerRuleError.invalidSplitPeople) {
            try Money.personalShare(total: 1000, mode: .equal, input: input)
        }
    }

    @Test("whenHeadCountHasAZeroFractionOrSpaces_EqualShare_ShouldAcceptLikeNumber")
    func headCountAccepted() throws {
        #expect(try Money.personalShare(total: 1000, mode: .equal, input: " 4 ") == 250)
        #expect(try Money.personalShare(total: 1000, mode: .equal, input: "4.0") == 250)
        #expect(try Money.personalShare(total: 1000, mode: .equal, input: "4.") == 250)
        #expect(try Money.personalShare(total: 1000, mode: .equal, input: "004") == 250)
    }

    @Test("whenTotalIsOutOfRange_PersonalShare_ShouldRefuseInsteadOfOverflowing")
    func totalOutOfRange() {
        #expect(throws: LedgerRuleError.invalidAmount) {
            try Money.personalShare(total: Int64.max, mode: .percent, input: "50")
        }
        #expect(throws: LedgerRuleError.invalidAmount) { try Money.personalShare(total: -1, mode: .equal, input: "2") }
    }
}

extension String {
    func leftPadded(_ width: Int) -> String { String(repeating: "0", count: max(0, width - count)) + self }
}
