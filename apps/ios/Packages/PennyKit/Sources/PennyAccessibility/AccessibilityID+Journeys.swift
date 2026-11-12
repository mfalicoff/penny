extension AccessibilityID {
    /// Identifiers the full-journey regression suites (MAZ-82) use beyond the ones their feature
    /// issues listed: Activity's search scope and row actions, the entry detail's toolbar, and the
    /// organize forms. The views already set every one of them; `AccessibilityIDTests` keeps
    /// them in step.
    public enum Journeys {
        // Activity search (MAZ-73/121): where results came from, and the row swipe actions.
        public static let searchScopeServer = "activity.scope.server"
        public static let searchScopeDevice = "activity.scope.device"
        public static let searchError = "activity.searchError"
        public static let searchRetry = "activity.searchRetry"
        public static let searchAllMonths = "activity.searchAllMonths"
        public static let rowEdit = "activity.edit"
        public static let rowDelete = "activity.delete"
        public static let deleteCancel = "deleteEntry.cancel"

        // The entry detail's toolbar.
        public static let detailEdit = "entryDetail.edit"
        public static let detailDelete = "entryDetail.delete"

        // The entry form beyond MAZ-73's list.
        public static let conflict = "entryForm.conflict"
        public static let reviewLatest = "entryForm.reviewLatest"

        // Accounts, categories and schedules (MAZ-74).
        public static let categoriesKind = "categories.kind"
        public static let categoryCancel = "categoryForm.cancel"
        public static let accountCancel = "accountForm.cancel"
        public static let scheduleTitle = "scheduleForm.title"
        public static let scheduleAmount = "scheduleForm.amount"
        public static let scheduleFrequency = "scheduleForm.frequency"
        public static let scheduleCancel = "scheduleForm.cancel"

        static let all = [
            searchScopeServer, searchScopeDevice, searchError, searchRetry, searchAllMonths, rowEdit, rowDelete,
            deleteCancel, detailEdit, detailDelete, conflict, reviewLatest, categoriesKind, categoryCancel,
            accountCancel, scheduleTitle, scheduleAmount, scheduleFrequency, scheduleCancel,
        ]
    }
}
