extension AccessibilityID {
    /// Household notifications (MAZ-79): the Settings row and the Shared tab's prompt. An opened
    /// notification shows the existing `screen.household` and `screen.householdExpense`.
    public enum Notifications {
        public static let settingsRow = "settings.notifications"
        public static let prompt = "notifications.prompt"
        public static let allow = "notifications.allow"
        public static let notNow = "notifications.notNow"

        static let all = [settingsRow, prompt, allow, notNow]
    }
}
