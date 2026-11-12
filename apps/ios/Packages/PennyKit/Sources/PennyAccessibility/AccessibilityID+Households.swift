extension AccessibilityID {
    /// Households, shared expenses, payments, invites and history (MAZ-75). Screens reuse
    /// `screen.shared`, `screen.household` and `screen.householdExpense`; rows end in the
    /// model id (`household.expense.<expense id>`, `household.member.<user id>`, a suggestion
    /// as `<from user id>-<to user id>`, an overdue month as `YYYY-MM`).
    public enum Households {
        public enum Screen {
            public static let start = "screen.householdStart"
            public static let invite = "screen.invite"
            public static let scanner = "screen.inviteScanner"
            public static let expenseForm = "screen.sharedExpenseForm"
            public static let recordShare = "screen.recordShare"
            public static let recordMonthly = "screen.recordMonthly"
            public static let paymentStale = "screen.paymentStale"
            public static let history = "screen.householdHistory"

            static let all = [start, invite, scanner, expenseForm, recordShare, recordMonthly, paymentStale, history]
        }

        // The Shared tab.
        public static let create = "shared.create"
        public static let join = "shared.join"
        public static let overall = "shared.overall"
        public static let listNotice = "shared.notice"
        public static func row(_ id: String) -> String { "shared.household.\(id)" }

        // Create or join.
        public static let startMode = "householdStart.mode"
        public static let name = "householdStart.name"
        public static let currency = "householdStart.currency"
        public static let createButton = "householdStart.create"
        public static let code = "householdStart.code"
        public static let joinButton = "householdStart.joinButton"
        public static let scan = "householdStart.scan"
        public static let startError = "householdStart.error"
        public static let otherServer = "householdStart.otherServer"
        public static let useOtherServer = "householdStart.useOtherServer"
        public static let startClose = "householdStart.close"

        // A household.
        public static let balance = "household.balance"
        public static let recordPayment = "household.recordPayment"
        public static let addExpense = "household.addExpense"
        public static let section = "household.section"
        public static let history = "household.history"
        public static let month = "household.month"
        public static let previousMonth = "household.previousMonth"
        public static let nextMonth = "household.nextMonth"
        public static let readOnly = "household.readOnly"
        public static let notice = "household.notice"
        public static let invite = "household.invite"
        public static let leave = "household.leave"
        public static let archive = "household.archive"
        public static let rename = "household.rename"
        public static let monthlyNote = "household.monthlyNote"
        public static func expense(_ id: String) -> String { "household.expense.\(id)" }
        public static func member(_ userId: String) -> String { "household.member.\(userId)" }
        public static func balanceRow(_ userId: String) -> String { "household.balanceRow.\(userId)" }
        public static func suggestion(from: String, to: String) -> String { "household.suggestion.\(from)-\(to)" }
        public static func overdue(_ month: String) -> String { "household.overdue.\(month)" }
        public static func rule(_ id: String) -> String { "household.rule.\(id)" }
        public static func removeMember(_ userId: String) -> String { "household.removeMember.\(userId)" }

        // The invite.
        public static let inviteCode = "invite.code"
        public static let inviteQR = "invite.qr"
        public static let inviteExpires = "invite.expires"
        public static let inviteShare = "invite.share"
        public static let inviteCopy = "invite.copy"
        public static let inviteNew = "invite.new"

        // The camera scanner.
        public static let scannerPreview = "scanner.preview"
        public static let scannerDenied = "scanner.denied"
        public static let scannerTypeCode = "scanner.typeCode"
        public static let scannerClose = "scanner.close"

        // A shared expense.
        public static let expenseTotal = "sharedExpense.total"
        public static let expenseShare = "sharedExpense.yourShare"
        public static let expenseEdit = "sharedExpense.edit"
        public static let expenseDelete = "sharedExpense.delete"
        public static let expenseHistory = "sharedExpense.history"
        public static func share(_ userId: String) -> String { "sharedExpense.share.\(userId)" }
        public static func markPaid(_ userId: String) -> String { "sharedExpense.markPaid.\(userId)" }

        // The shared expense form.
        public static let formAmount = "sharedForm.amount"
        public static let formTitle = "sharedForm.title"
        public static let formDate = "sharedForm.date"
        public static let formMode = "sharedForm.mode"
        public static let formYourShare = "sharedForm.yourShare"
        public static let formAccount = "sharedForm.account"
        public static let formNote = "sharedForm.note"
        public static let formRepeat = "sharedForm.repeat"
        public static let formSave = "sharedForm.save"
        public static let formClose = "sharedForm.close"
        public static let formCategory = "sharedForm.category"
        public static let formActive = "sharedForm.active"
        public static let formProblem = "sharedForm.problem"
        public static let formError = "sharedForm.error"
        public static let formReviewLatest = "sharedForm.reviewLatest"
        public static let formRestoredDraft = "sharedForm.restoredDraft"
        public static let formKeepDraft = "sharedForm.keepDraft"
        public static let formDiscard = "sharedForm.discard"
        public static func payer(_ userId: String) -> String { "sharedForm.payer.\(userId)" }
        public static func split(_ userId: String) -> String { "sharedForm.split.\(userId)" }

        // Recording payments.
        public static let recordShareConfirm = "recordShare.confirm"
        public static let recordShareExplanation = "recordShare.explanation"
        public static let recordMonthlyConfirm = "recordMonthly.confirm"
        public static let recordMonthlyExplanation = "recordMonthly.explanation"
        public static let paymentError = "payment.error"
        public static let staleOld = "paymentStale.old"
        public static let staleNew = "paymentStale.new"
        public static let staleReview = "paymentStale.review"

        // History.
        public static let historyEmpty = "history.empty"
        public static func historyFilter(_ rawValue: String) -> String { "history.filter.\(rawValue)" }
        public static func historyEvent(_ id: String) -> String { "history.event.\(id)" }

        static let all =
            Screen.all + [
                create, join, overall, listNotice, startMode, name, currency, createButton, code, joinButton, scan,
                startError, otherServer, useOtherServer, startClose, balance, recordPayment, addExpense, section,
                history, month, previousMonth, nextMonth, readOnly, notice, invite, leave, archive, rename,
                monthlyNote, inviteCode, inviteQR, inviteExpires, inviteShare, inviteCopy, inviteNew, scannerPreview,
                scannerDenied, scannerTypeCode, scannerClose, expenseTotal, expenseShare, expenseEdit, expenseDelete,
                expenseHistory, formAmount, formTitle, formDate, formMode, formYourShare, formAccount, formNote,
                formRepeat, formSave, formClose, formCategory, formActive, formProblem, formError, formReviewLatest,
                formRestoredDraft,
                formKeepDraft, formDiscard, recordShareConfirm, recordShareExplanation, recordMonthlyConfirm,
                recordMonthlyExplanation, paymentError, staleOld, staleNew, staleReview, historyEmpty,
            ]
        static let prefixes = [
            "shared.household.", "household.expense.", "household.member.", "household.balanceRow.",
            "household.suggestion.",
            "household.overdue.", "household.rule.", "household.removeMember.", "sharedExpense.share.",
            "sharedExpense.markPaid.", "sharedForm.payer.", "sharedForm.split.", "history.filter.", "history.event.",
        ]
    }
}
