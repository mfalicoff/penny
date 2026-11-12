extension AccessibilityID {
    /// Personal and shared trips (MAZ-76). The Trips tab is `screen.trips` and a personal trip
    /// `screen.trip`; trip rows are `trip.<trip id or household id>` (`Row.trip`). A shared trip
    /// reuses the household identifiers for its expenses, balances and people
    /// (`household.expense.<id>`, `household.member.<user id>`…); private expenses from before
    /// sharing are `entry.<transaction id>`.
    public enum Trips {
        public enum Screen {
            public static let sharedTrip = "screen.sharedTrip"
            public static let form = "screen.tripForm"
            public static let share = "screen.shareTrip"

            static let all = [sharedTrip, form, share]
        }

        // The Trips tab.
        public static let new = "trips.new"
        public static let join = "trips.join"
        public static let featured = "trips.featured"
        public static let featuredAdd = "trips.featuredAdd"
        public static let notice = "trips.notice"

        // A trip page (personal or shared).
        public static let phase = "tripPage.phase"
        public static let dates = "tripPage.dates"
        public static let yourSpending = "tripPage.yourSpending"
        public static let total = "tripPage.total"
        public static let outside = "tripPage.outside"
        public static let addExpense = "tripPage.addExpense"
        public static let share = "tripPage.share"
        public static let edit = "tripPage.edit"
        public static let sharedAs = "tripPage.sharedAs"
        public static let openShared = "tripPage.openShared"
        public static let privateNote = "tripPage.privateNote"
        public static let onlyYou = "tripPage.onlyYou"
        public static let sharedExpenses = "tripPage.sharedExpenses"
        public static func category(_ id: String) -> String { "tripPage.category.\(id)" }

        // New trip and Edit trip.
        public static let formName = "tripForm.name"
        public static let formStart = "tripForm.start"
        public static let formEnd = "tripForm.end"
        public static let formShare = "tripForm.share"
        public static let formSave = "tripForm.save"
        public static let formClose = "tripForm.close"
        public static let formDelete = "tripForm.delete"
        public static let formDeleteNote = "tripForm.deleteNote"
        public static let formError = "tripForm.error"
        public static let formNameProblem = "tripForm.nameProblem"
        public static let formDateProblem = "tripForm.dateProblem"

        // Share trip.
        public static let shareConfirm = "shareTrip.confirm"
        public static let shareClose = "shareTrip.close"
        public static let shareError = "shareTrip.error"
        public static let sharePrivate = "shareTrip.private"

        static let all =
            Screen.all + [
                new, join, featured, featuredAdd, notice, phase, dates, yourSpending, total, outside, addExpense, share,
                edit, sharedAs, openShared, privateNote, onlyYou, sharedExpenses, formName, formStart, formEnd,
                formShare, formSave, formClose, formDelete, formDeleteNote, formError, formNameProblem,
                formDateProblem, shareConfirm, shareClose, shareError, sharePrivate,
            ]
        static let prefixes = ["tripPage.category."]
    }
}
