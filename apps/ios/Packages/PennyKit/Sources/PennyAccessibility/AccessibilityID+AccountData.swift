extension AccessibilityID {
    /// MAZ-152: Settings › Profile › Your data (cards `iphone-profile`, `ipad-profile`), the Delete
    /// account page (`iphone-delete-account`), the full export (`iphone-export-all`) and sign-in's
    /// notice afterwards.
    public enum AccountData {
        public static let deleteScreen = "screen.deleteAccount"
        public static let exportScreen = "screen.exportAll"

        /// Profile's Export all your data and Delete account rows.
        public static let exportRow = "profile.exportAll"
        public static let deleteRow = "profile.deleteAccount"

        public static let deleteExportLink = "deleteAccount.export"
        public static let deleteStays = "deleteAccount.staysForOthers"
        public static let deletePassword = "deleteAccount.password"
        public static let deleteConfirm = "deleteAccount.confirm"
        public static let deleteError = "deleteAccount.error"

        public static let exportFile = "exportAll.file"
        public static let exportShare = "exportAll.share"
        public static let exportPreparing = "exportAll.preparing"
        public static let exportError = "exportAll.error"
        public static let exportRetry = "exportAll.retry"

        /// Sign-in after the account was deleted.
        public static let deletedNotice = "auth.accountDeleted"

        static let all = [
            deleteScreen, exportScreen, exportRow, deleteRow, deleteExportLink, deleteStays, deletePassword,
            deleteConfirm, deleteError, exportFile, exportShare, exportPreparing, exportError, exportRetry,
            deletedNotice,
        ]
    }
}
