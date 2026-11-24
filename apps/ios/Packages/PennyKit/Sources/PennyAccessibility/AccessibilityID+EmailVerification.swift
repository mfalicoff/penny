extension AccessibilityID {
    /// Email verification (MAZ-172): "Check your email" after a password sign-up
    /// (`iphone-verify-email`), Change email, the Shared tab's reminder (`iphone-unverified`) and the
    /// Sign-in row's state in Settings › Profile (`iphone-profile`, `ipad-profile`).
    public enum EmailVerification {
        public static let checkEmailScreen = "screen.checkEmail"
        public static let changeEmailScreen = "screen.changeEmail"

        public static let address = "verifyEmail.address"
        public static let continueToPenny = "verifyEmail.continue"
        public static let resend = "verifyEmail.resend"
        public static let changeEmail = "verifyEmail.changeEmail"
        public static let message = "verifyEmail.message"

        public static let newEmail = "changeEmail.email"
        public static let password = "changeEmail.password"
        public static let send = "changeEmail.send"
        public static let close = "changeEmail.close"
        public static let error = "changeEmail.error"

        /// The Shared tab's reminder and its buttons.
        public static let reminder = "shared.verifyEmail"
        public static let reminderResend = "shared.verifyEmail.resend"
        public static let reminderChangeEmail = "shared.verifyEmail.changeEmail"

        /// Settings › Profile's Sign-in row: Verified, or Not verified with Resend link.
        public static let verified = "profile.emailVerified"
        public static let unverified = "profile.emailUnverified"
        public static let profileResend = "profile.resendVerification"

        static let all = [
            checkEmailScreen, changeEmailScreen, address, continueToPenny, resend, changeEmail, message, newEmail,
            password, send, close, error, reminder, reminderResend, reminderChangeEmail, verified, unverified,
            profileResend,
        ]
    }
}
