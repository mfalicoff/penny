extension AccessibilityID {
    /// Identifiers the redesign card captures (MAZ-122, `PennyUITests/Cards`) use beyond the
    /// journeys' lists: the entry form's split and category sheets and the schedule detail. The
    /// views already set every one of them; `AccessibilityIDTests` keeps them in step.
    public enum Cards {
        public static let entrySplit = "entryForm.split"
        public static let moreCategories = "entryForm.moreCategories"
        public static let splitMode = "split.mode"
        public static let splitInput = "split.input"
        public static let splitShare = "split.share"
        public static let scheduleCadence = "schedule.cadence"

        static let all = [entrySplit, moreCategories, splitMode, splitInput, splitShare, scheduleCadence]
    }
}
