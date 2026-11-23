extension AccessibilityID {
    /// Profiles (MAZ-171) and the privacy policy links (MAZ-169): Settings › Profile, its picture
    /// crop and Change password, the name prompt, sign-up's Name field and the privacy links.
    /// Settings › Profile is the `settings.profile` row (`Settings.row`).
    public enum Profile {
        public static let screen = "screen.profile"
        public static let cropScreen = "screen.profilePhoto"
        public static let passwordScreen = "screen.changePassword"
        public static let namePromptScreen = "screen.namePrompt"

        public static let picture = "profile.picture"
        public static let changePicture = "profile.changePicture"
        public static let removePicture = "profile.removePicture"
        public static let pictureError = "profile.pictureError"
        public static let name = "profile.name"
        public static let nameError = "profile.nameError"
        public static let save = "profile.save"
        public static let managed = "profile.managed"
        public static let signIn = "profile.signIn"
        public static let changePassword = "profile.changePassword"
        public static let footer = "profile.footer"
        public static let error = "profile.error"

        public static let cropCancel = "profilePhoto.cancel"
        public static let cropChoose = "profilePhoto.choose"
        public static let cropArea = "profilePhoto.area"

        public static let currentPassword = "changePassword.current"
        public static let newPassword = "changePassword.new"
        public static let passwordSave = "changePassword.save"
        public static let passwordCancel = "changePassword.cancel"
        public static let passwordError = "changePassword.error"
        public static let passwordChanged = "changePassword.changed"

        public static let promptName = "namePrompt.name"
        public static let promptSave = "namePrompt.save"
        public static let promptSkip = "namePrompt.skip"
        public static let promptError = "namePrompt.error"
        public static let promptHint = "namePrompt.hint"

        /// Create account's Name field.
        public static let signUpName = "auth.name"
        /// The Privacy Policy link on sign-in, create account and Settings › Profile.
        public static let privacyPolicy = "legal.privacyPolicy"

        static let all = [
            screen, cropScreen, passwordScreen, namePromptScreen, picture, changePicture, removePicture,
            pictureError, name, nameError, save, managed, signIn, changePassword, footer, error, cropCancel,
            cropChoose, cropArea, currentPassword, newPassword, passwordSave, passwordCancel, passwordError,
            passwordChanged, promptName, promptSave, promptSkip, promptError, promptHint, signUpName, privacyPolicy,
        ]
    }
}
