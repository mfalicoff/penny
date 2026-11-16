extension AccessibilityID {
    /// Emailed receipts (MAZ-184): Settings › Receipt email, the receipt inbox and its items,
    /// the attach sheet and the entry form's From inbox picker. Settings › Receipt email is the
    /// `settings.receiptEmail` row (`Settings.row`).
    public enum ReceiptInbox {
        public static let emailScreen = "screen.receiptEmail"
        public static let inboxScreen = "screen.receiptInbox"
        public static let itemScreen = "screen.receiptInboxItem"
        public static let attachScreen = "screen.receiptAttach"
        public static let pickerScreen = "screen.receiptInboxPicker"

        public static let settingsRow = "settings.receiptInbox"
        public static let homeRow = "home.receiptInbox"
        public static let fromInbox = "entryExtras.receiptInbox"

        public static let address = "receiptEmail.address"
        public static let copy = "receiptEmail.copy"
        public static let share = "receiptEmail.share"
        public static let expiry = "receiptEmail.expiry"
        public static let extend = "receiptEmail.extend"
        public static let rotate = "receiptEmail.rotate"
        public static let confirmRotate = "receiptEmail.confirmRotate"
        public static let turnOff = "receiptEmail.turnOff"
        public static let confirmTurnOff = "receiptEmail.confirmTurnOff"
        public static let create = "receiptEmail.create"
        public static let sender = "receiptEmail.sender"
        public static let senderField = "receiptEmail.senderField"
        public static let addSender = "receiptEmail.addSender"
        public static let howTo = "receiptEmail.howTo"
        public static let emailError = "receiptEmail.error"

        public static let filter = "receiptInbox.filter"
        public static let offline = "receiptInbox.offline"
        public static let empty = "receiptInbox.empty"
        public static let more = "receiptInbox.more"
        public static let error = "receiptInbox.error"
        public static let discard = "receiptInbox.discard"
        public static let confirmDiscard = "receiptInbox.confirmDiscard"
        public static let confirmation = "receiptInbox.confirmation"
        public static let viewEntry = "receiptInbox.viewEntry"
        public static let undo = "receiptInbox.undo"
        public static let dismissConfirmation = "receiptInbox.dismissConfirmation"

        public static let itemSender = "receiptInboxItem.sender"
        public static let itemSubject = "receiptInboxItem.subject"
        public static let itemUnverified = "receiptInboxItem.unverified"
        public static let itemExpiry = "receiptInboxItem.expiry"
        public static let itemError = "receiptInboxItem.error"
        public static let attach = "receiptInboxItem.attach"
        public static let newExpense = "receiptInboxItem.newExpense"
        public static let done = "receiptInboxItem.done"
        public static let itemDiscard = "receiptInboxItem.discard"
        public static let itemConfirm = "receiptInboxItem.confirm"

        public static let attachCancel = "receiptAttach.cancel"
        public static let attachNext = "receiptAttach.next"
        public static let suggested = "receiptAttach.suggested"
        public static let preview = "receiptAttach.preview"
        public static let confirm = "receiptAttach.confirm"
        public static let sharedNote = "receiptAttach.sharedNote"
        public static let replaceNote = "receiptAttach.replaceNote"
        public static let unverifiedNote = "receiptAttach.unverifiedNote"
        public static let attachError = "receiptAttach.error"

        /// An inbox row by its item id.
        public static func item(_ id: String) -> String { "inboxItem.\(id)" }
        /// A file of an item (detail, attach sheet's file step, From inbox) by its receipt id.
        public static func file(_ receiptId: String) -> String { "inboxFile.\(receiptId)" }
        /// The attach sheet's file step, by receipt id.
        public static func attachFile(_ receiptId: String) -> String { "attachFile.\(receiptId)" }
        /// An entry in the attach sheet: `entry-<ledger id>` or `shared-<expense id>`.
        public static func target(_ key: String) -> String { "attachTarget.\(key)" }

        static let all = [
            emailScreen, inboxScreen, itemScreen, attachScreen, pickerScreen, settingsRow, homeRow, fromInbox,
            address, copy, share, expiry, extend, rotate, confirmRotate, turnOff, confirmTurnOff, create, sender,
            senderField, addSender, howTo, emailError, filter, offline, empty, more, error, discard, confirmDiscard,
            confirmation, viewEntry, undo, dismissConfirmation, itemSender, itemSubject, itemUnverified, itemExpiry,
            itemError, attach, newExpense, done, itemDiscard, itemConfirm, attachCancel, attachNext, suggested, preview,
            confirm, sharedNote, replaceNote, unverifiedNote, attachError,
        ]

        static let prefixes = ["inboxItem.", "inboxFile.", "attachFile.", "attachTarget."]
    }
}
