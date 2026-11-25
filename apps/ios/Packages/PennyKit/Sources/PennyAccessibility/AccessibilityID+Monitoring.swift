extension AccessibilityID {
    /// Crash and performance reports (MAZ-129): the "Help fix problems faster?" sheet
    /// (`iphone-monitoring-prompt`) and Settings › Privacy (`iphone-privacy`). The Settings row is
    /// `settings.privacy` (`Settings.row`).
    public enum Monitoring {
        public static let promptScreen = "screen.monitoringPrompt"
        public static let share = "monitoringPrompt.share"
        public static let decline = "monitoringPrompt.decline"
        public static let promptPolicy = "monitoringPrompt.privacyPolicy"

        public static let privacyScreen = "screen.privacy"
        public static let crashes = "privacy.crashes"
        public static let performance = "privacy.performance"
        public static let policy = "privacy.policy"

        static let all = [promptScreen, share, decline, promptPolicy, privacyScreen, crashes, performance, policy]
    }
}
