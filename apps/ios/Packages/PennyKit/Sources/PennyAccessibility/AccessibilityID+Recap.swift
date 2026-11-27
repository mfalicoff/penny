extension AccessibilityID {
    /// The monthly recap (MAZ-292): its screen, the banner on Home and Insights, Insights' Recap
    /// button and the Settings switch for its notification.
    public enum Recap {
        public static let screen = "screen.recap"
        /// The recap's month menu, in its toolbar.
        public static let month = "recap.month"
        /// Spent, with the comparison bars and the sentence under them.
        public static let spent = "recap.spent"
        public static let comparison = "recap.comparison"
        /// Came in, and where it went (spent, invested, left over).
        public static let money = "recap.money"
        public static let changes = "recap.changes"
        public static let topShared = "recap.topShared"
        public static let split = "recap.split"
        public static let highlights = "recap.highlights"
        /// "Nothing to recap yet", with Add an entry and Choose another month.
        public static let empty = "recap.empty"
        public static let addEntry = "recap.addEntry"
        public static let chooseMonth = "recap.chooseMonth"
        /// "Your October recap is ready", on Home and on Insights, and its close button.
        public static let banner = "home.recapBanner"
        public static let bannerDismiss = "home.recapBannerDismiss"
        /// Insights' Recap button, for any past month.
        public static let insightsButton = "insights.recap"
        /// Settings › Preferences › Monthly recap.
        public static let setting = "settings.monthlyRecap"

        /// A month's comparison bar: `recap.bar.current`, `recap.bar.previous`, `recap.bar.lastYear`.
        public static func bar(_ which: String) -> String { "recap.bar.\(which)" }
        /// A biggest change's row, by category id.
        public static func change(_ categoryId: String) -> String { "recap.change.\(Overview.segment(categoryId))" }

        static let all = [
            screen, month, spent, comparison, money, changes, topShared, split, highlights, empty, addEntry,
            chooseMonth, banner, bannerDismiss, insightsButton, setting,
        ]
        static let prefixes = ["recap.bar.", "recap.change."]
    }
}
