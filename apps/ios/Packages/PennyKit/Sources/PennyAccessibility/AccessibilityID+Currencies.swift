extension AccessibilityID {
    /// Entries in several currencies (MAZ-151): the entry form's currency chip, converted amount
    /// and Rate row, the currency picker and Exchange rate sheets, both amounts on list rows and in
    /// the entry detail, and Settings › Currency's exchange rates. Options and recent currencies end
    /// in an ISO 4217 code; a row's original amount ends in the entry id. The picker searches with the
    /// system search field.
    public enum Currencies {
        public enum Screen {
            public static let picker = "screen.currencyPicker"
            public static let exchangeRate = "screen.exchangeRate"

            static let all = [picker, exchangeRate]
        }

        // The entry form.
        public static let chip = "entryForm.currency"
        public static let converted = "entryForm.converted"
        public static let rate = "entryForm.rate"
        public static let rateNote = "entryForm.rateNote"

        // The currency picker.
        public static let pickerClose = "currencyPicker.close"
        public static func option(_ code: String) -> String { "currencyPicker.option.\(code)" }

        // The Exchange rate sheet.
        public static let rateField = "exchangeRate.field"
        public static let rateDone = "exchangeRate.done"
        public static let rateClose = "exchangeRate.close"
        public static let rateConverted = "exchangeRate.converted"
        public static let rateError = "exchangeRate.error"
        public static let editedTag = "exchangeRate.edited"
        public static let usePublished = "exchangeRate.usePublished"
        public static let useLast = "exchangeRate.useLast"

        // Lists and the entry detail.
        public static func original(_ entryId: String) -> String { "currencyRow.original.\(entryId)" }
        /// The entry detail's amount when it is in the home currency.
        public static let detailAmount = "entryDetail.amount"
        public static let detailOriginal = "entryDetail.original"
        public static let detailHome = "entryDetail.home"
        public static let detailRate = "entryDetail.rate"
        public static let detailSource = "entryDetail.rateSource"
        public static let detailNote = "entryDetail.rateNote"

        // Settings › Currency.
        public static let dailyRates = "currencySettings.dailyRates"
        public static let latestRates = "currencySettings.latestRates"
        public static let lastRates = "currencySettings.lastRates"
        public static func recent(_ code: String) -> String { "currencySettings.recent.\(code)" }

        static let all =
            Screen.all + [
                chip, converted, rate, rateNote, pickerClose, rateField, rateDone, rateClose, rateConverted,
                rateError, editedTag, usePublished, useLast, detailAmount, detailOriginal, detailHome, detailRate,
                detailSource,
                detailNote, dailyRates, latestRates, lastRates,
            ]
        static let prefixes = [
            "currencyPicker.option.", "currencyRow.original.", "currencySettings.recent.",
        ]
    }
}
