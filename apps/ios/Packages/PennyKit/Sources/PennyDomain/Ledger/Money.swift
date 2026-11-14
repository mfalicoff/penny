/// Integer-cent money. Every amount in the ledger is a whole number of minor currency units
/// (`Int64`); no rule here ever uses `Double` or `Decimal`, so no amount can drift by a cent.
/// Rounding is explicit: half up on non-negative values (JavaScript's `Math.round`, as the web
/// app rounds), computed in integers.
public enum Money {
    /// The largest stored entry amount: 999,999,999.99.
    public static let maxCents: Int64 = 99_999_999_999

    /// Whether `total` and `share` are a storable pair: total 1...maxCents and share 0...total.
    public static func isValidAmounts(total: Int64, share: Int64) -> Bool {
        (1...maxCents).contains(total) && (0...total).contains(share)
    }

    /// Parses what a person typed into cents: up to nine whole digits, then optionally "." or ","
    /// and at most two decimals. Leading and trailing whitespace (JavaScript's `trim` set) is
    /// ignored. A sign, exponent, grouping, an empty string or a third decimal is refused,
    /// and so are non-ASCII digits (golden fixture `money.json`).
    public static func cents(_ input: String) throws(LedgerRuleError) -> Int64 {
        let bytes = Array(JavaScriptText.trim(input).utf8)
        var index = 0
        var whole: Int64 = 0
        var wholeDigits = 0
        while index < bytes.count, (0x30...0x39).contains(bytes[index]) {
            // A tenth digit is already invalid; stopping here also keeps `whole` from overflowing.
            guard wholeDigits < 9 else { throw .invalidAmount }
            whole = whole * 10 + Int64(bytes[index] - 0x30)
            wholeDigits += 1
            index += 1
        }
        guard (1...9).contains(wholeDigits) else { throw .invalidAmount }
        var fraction: Int64 = 0
        var fractionDigits = 0
        if index < bytes.count {
            guard bytes[index] == 0x2E || bytes[index] == 0x2C else { throw .invalidAmount }
            index += 1
            while index < bytes.count, (0x30...0x39).contains(bytes[index]), fractionDigits < 2 {
                fraction = fraction * 10 + Int64(bytes[index] - 0x30)
                fractionDigits += 1
                index += 1
            }
            guard index == bytes.count else { throw .invalidAmount }
        }
        if fractionDigits == 1 { fraction *= 10 }
        return whole * 100 + fraction
    }

    public enum SplitMode: String, CaseIterable, Sendable {
        /// The whole receipt is yours.
        case full
        /// Split equally between 2...100 people; the input is the head count.
        case equal
        /// Your share as an amount, same format as `cents(_:)`.
        case amount
        /// Your share as a percentage 0...100 with two decimals.
        case percent
    }

    /// Your share of `total` in cents. Equal and percent shares round half up to the nearest
    /// cent, so $10.01 split three ways is $3.34 for you, never $3.33.
    ///
    /// A head count is a plain decimal integer; a fraction ("2.5"), exponent or sign is refused.
    /// Forms like "1e1" and "0x2" are refused too.
    ///
    /// `total` comes from `cents(_:)`, so it is within 0...maxCents; anything else is refused as
    /// an invalid amount rather than trapping on overflow.
    public static func personalShare(total: Int64, mode: SplitMode, input: String) throws(LedgerRuleError) -> Int64 {
        guard (0...maxCents).contains(total) else { throw .invalidAmount }
        let result: Int64
        switch mode {
        case .full:
            return total
        case .equal:
            let people = try headCount(input)
            result = divideRoundingHalfUp(total, by: people)
        case .percent:
            let percent = try cents(input)
            guard percent <= 10_000 else { throw .invalidPercentage }
            result = divideRoundingHalfUp(total * percent, by: 10_000)
        case .amount:
            result = try cents(input)
        }
        guard result <= total else { throw .shareExceedsTotal }
        return result
    }

    /// `numerator / denominator` rounded half up for a non-negative numerator.
    public static func divideRoundingHalfUp(_ numerator: Int64, by denominator: Int64) -> Int64 {
        precondition(numerator >= 0 && denominator > 0)
        return (2 * numerator + denominator) / (2 * denominator)
    }

    private static func headCount(_ input: String) throws(LedgerRuleError) -> Int64 {
        let bytes = Array(JavaScriptText.trim(input).utf8)
        var value: Int64 = 0
        var index = 0
        while index < bytes.count, (0x30...0x39).contains(bytes[index]), value <= 1_000 {
            value = value * 10 + Int64(bytes[index] - 0x30)
            index += 1
        }
        // "2.0" is the same number as "2" to a person; a non-zero fraction is not a head count.
        if index < bytes.count, bytes[index] == 0x2E, index > 0 {
            guard bytes[(index + 1)...].allSatisfy({ $0 == 0x30 }) else { throw .invalidSplitPeople }
            index = bytes.count
        }
        guard index == bytes.count, index > 0, (2...100).contains(value) else { throw .invalidSplitPeople }
        return value
    }
}
