/// Calendar-date strings ("YYYY-MM-DD") are kept as strings end to end. This checks that
/// one is a real date in the contract's 2000-01-01...2100-12-31 range without a time zone.
enum CalendarDate {
    static func isValid(_ text: String) -> Bool {
        let bytes = Array(text.utf8)
        guard bytes.count == 10, bytes[4] == 45, bytes[7] == 45 else { return false }
        func number(_ range: Range<Int>) -> Int? {
            var value = 0
            for index in range {
                guard bytes[index] >= 48, bytes[index] <= 57 else { return nil }
                value = value * 10 + Int(bytes[index] - 48)
            }
            return value
        }
        guard let year = number(0..<4), let month = number(5..<7), let day = number(8..<10),
            (2000...2100).contains(year), (1...12).contains(month), day >= 1
        else { return false }
        let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
        let days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
        return day <= days[month - 1]
    }
}
