extension AccessibilityID {
    /// The year in review (MAZ-292, phase 2): its Insights card, the January banner on Home and
    /// Insights, its four pages, and Share your year.
    public enum YearReview {
        public static let screen = "screen.yearReview"
        /// "2026 in review" in Insights, from December 26 to January 31.
        public static let insightsCard = "insights.yearReview"
        /// "Your 2026 in review is ready" on Home and Insights in January, and its close button.
        public static let banner = "home.yearReviewBanner"
        public static let bannerDismiss = "home.yearReviewBannerDismiss"
        /// The progress segments, with the page number as their value.
        public static let progress = "yearReview.progress"
        public static let close = "yearReview.close"
        /// "Share your year", on every page.
        public static let share = "yearReview.share"
        /// The first page's total and its busiest-month columns.
        public static let total = "yearReview.total"
        public static let months = "yearReview.months"
        public static let daysAway = "yearReview.daysAway"
        public static let tripShare = "yearReview.tripShare"
        public static let sharedFoot = "yearReview.sharedFoot"

        /// Share your year: its screen, the image, the switch and Share….
        public static let shareScreen = "screen.yearReviewShare"
        public static let shareImage = "yearReviewShare.image"
        public static let shareAmounts = "yearReviewShare.amounts"
        public static let shareSend = "yearReviewShare.send"
        public static let shareClose = "yearReviewShare.close"

        /// A page: `yearReview.page.categories`, `.trips`, `.shared`, `.facts`.
        public static func page(_ name: String) -> String { "yearReview.page.\(name)" }
        /// A top category's row, by its key (the name without case).
        public static func category(_ key: String) -> String { "yearReview.category.\(Overview.segment(key))" }
        /// A trip's row, by the trip's id (a shared trip's household id).
        public static func trip(_ id: String) -> String { "yearReview.trip.\(Overview.segment(id))" }
        /// A payer's row, by the rule's key: `you`, or the payer's lower-cased email with every
        /// character but letters, digits, `_` and `-` as `-` (identifiers are never shown).
        public static func payer(_ key: String) -> String { "yearReview.payer.\(Overview.segment(key))" }
        /// A fun fact: `quiet`, `run`, `recorded`, `weekday`, `category`.
        public static func fact(_ name: String) -> String { "yearReview.fact.\(name)" }

        static let all = [
            screen, insightsCard, banner, bannerDismiss, progress, close, share, total, months, daysAway, tripShare,
            sharedFoot, shareScreen, shareImage, shareAmounts, shareSend, shareClose,
        ]
        static let prefixes = [
            "yearReview.page.", "yearReview.category.", "yearReview.trip.", "yearReview.payer.", "yearReview.fact.",
        ]
    }
}
