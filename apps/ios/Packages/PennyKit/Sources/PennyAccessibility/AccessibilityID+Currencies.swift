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
        /// The locked home currency row (a ledger with entries): text, not a choice.
        public static func home(_ code: String) -> String { "currencySettings.home.\(code)" }

        static let all =
            Screen.all + [
                chip, converted, rate, rateNote, pickerClose, rateField, rateDone, rateClose, rateConverted,
                rateError, editedTag, usePublished, useLast, detailAmount, detailOriginal, detailHome, detailRate,
                detailSource,
                detailNote, dailyRates, latestRates, lastRates,
            ]
        static let prefixes = [
            "currencyPicker.option.", "currencyRow.original.", "currencySettings.recent.", "currencySettings.home.",
        ]
    }
}

extension AccessibilityID {
    /// Shared trips and households in several currencies (MAZ-151 phase 2): the trip form's
    /// currency row, the trip page's currencies chip, Exchange rates and amounts (ending in an
    /// expense id or an ISO 4217 code), Balances in a currency with Settle in, a shared expense's
    /// rate, and the shared expense form's currency, converted amount, Rate row and rate sheet.
    public enum SharedCurrencies {
        public enum Screen {
            public static let tripRates = "screen.tripRates"
            public static let sharedRate = "screen.sharedRate"

            static let all = [tripRates, sharedRate]
        }

        // The trip form.
        public static let tripCurrency = "tripForm.currency"
        public static let tripCurrencyNote = "tripForm.currencyNote"

        // The trip page.
        public static let chip = "tripPage.currencies"
        public static func amount(_ expenseId: String) -> String { "tripPage.amount.\(expenseId)" }
        public static func rate(_ code: String) -> String { "tripPage.rate.\(code)" }
        public static let ratesNote = "tripPage.ratesNote"
        public static let ratesClose = "tripRates.close"

        // Balances.
        public static let settleIn = "household.settleIn"
        public static let balancesTitle = "household.balancesTitle"
        public static let currencyNote = "household.currencyNote"
        public static func paid(_ expenseId: String) -> String { "household.expense.paid.\(expenseId)" }

        // A shared expense.
        public static let expenseRate = "sharedExpense.rate"

        // The shared expense form.
        public static let formCurrency = "sharedForm.currency"
        public static let formConverted = "sharedForm.converted"
        public static let formRate = "sharedForm.rate"
        public static let rateField = "sharedRate.field"
        public static let rateConverted = "sharedRate.converted"
        public static let rateError = "sharedRate.error"
        public static let rateDone = "sharedRate.done"
        public static let rateClose = "sharedRate.close"
        public static let usePublished = "sharedRate.usePublished"

        static let all =
            Screen.all + [
                tripCurrency, tripCurrencyNote, chip, ratesNote, ratesClose, settleIn, balancesTitle, currencyNote,
                expenseRate, formCurrency, formConverted, formRate, rateField, rateConverted, rateError, rateDone,
                rateClose, usePublished,
            ]
        static let prefixes = ["tripPage.amount.", "tripPage.rate.", "household.expense.paid."]
    }
}
