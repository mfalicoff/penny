/// Stable accessibility identifiers shared by the screens (PennyUI, PennyDesign) and the
/// XCUITest target (`apps/ios/PennyUITests`, MAZ-81). UI tests find elements only through
/// these, never through visible text, so copy, localization and Dynamic Type can change
/// without breaking them.
///
/// Convention (checked by `AccessibilityIDTests` and `scripts/ios.sh lint`):
///
/// - `<area>.<element>`, each fixed segment lowerCamelCase: `auth.email`, `home.settings`.
/// - Every screen's root view is `screen.<name>`: `screen.home`, `screen.activity`.
/// - A row or option for a model ends with its stable id or raw value, never an index or a
///   title: `entry.<transaction id>`, `currency.EUR`, `tab.activity`.
/// - Identifiers describe what an element is, not how it looks or where it sits, so the iPhone
///   tab bar and the iPad sidebar keep their own areas (`tab.*`, `sidebar.*`).
/// - Add a constant here in the same change that adds the identifier to a view, and use it in
///   the view. Never rename one without updating the UI tests in the same change.
///
/// Identifiers are not user-visible and are not localized.
public enum AccessibilityID {
    /// Full identifiers: a lowerCamelCase area, then one or more segments; the last may be a
    /// model id or raw value.
    public static let pattern = #"^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_-]+)+$"#

    /// Screen roots (`screen.<name>`), one per screen in MAZ-122's screen-to-test matrix.
    public enum Screen {
        public static let home = "screen.home"
        public static let activity = "screen.activity"
        public static let shared = "screen.shared"
        public static let household = "screen.household"
        public static let householdExpense = "screen.householdExpense"
        public static let trips = "screen.trips"
        public static let trip = "screen.trip"
        public static let addEntry = "screen.addEntry"
        public static let settings = "screen.settings"
        public static let appearance = "screen.appearance"
        public static let currency = "screen.currency"
        public static let appLock = "screen.appLock"
        public static let recurring = "screen.recurring"
        public static let accounts = "screen.accounts"
        public static let categories = "screen.categories"
        public static let lock = "screen.lock"
        // Entries and Activity (MAZ-73).
        public static let editEntry = "screen.editEntry"
        public static let entryDetail = "screen.entryDetail"
        public static let activityFilters = "screen.activityFilters"
        public static let categoryPicker = "screen.categoryPicker"
        public static let accountPicker = "screen.accountPicker"
        public static let datePicker = "screen.datePicker"
        public static let split = "screen.split"
        public static let entryExtras = "screen.entryExtras"
        /// Add entry's Household: personal, or a household to split with.
        public static let householdPicker = "screen.householdPicker"
        /// The delete confirmation sheet (`delete-confirm` card, MAZ-255).
        public static let deleteConfirm = "screen.deleteConfirm"
        // Accounts, categories and schedules (MAZ-74).
        public static let accountForm = "screen.accountForm"
        public static let categoryForm = "screen.categoryForm"
        public static let schedule = "screen.schedule"
        public static let scheduleForm = "screen.scheduleForm"
        // Overview, calendar and money flow (MAZ-77).
        // Password reset (MAZ-124).
        public static let forgotPassword = "screen.forgotPassword"
        public static let resetPassword = "screen.resetPassword"
        public static let moneyFlow = "screen.moneyFlow"
        public static let insights = "screen.insights"
        public static let calendar = "screen.calendar"
        public static let categorySpending = "screen.categorySpending"

        static let all = [
            home, activity, shared, household, householdExpense, trips, trip, addEntry, settings, appearance, currency,
            appLock, recurring, accounts, categories, lock,
            editEntry, entryDetail, activityFilters, categoryPicker, accountPicker, datePicker, split, entryExtras,
            householdPicker, deleteConfirm,
            accountForm, categoryForm, schedule, scheduleForm,
            moneyFlow, insights, calendar, categorySpending,
            forgotPassword, resetPassword,
        ]
    }

    /// The app root: which top-level state is showing.
    public enum Root {
        public static let launch = "root.launch"
        public static let configurationError = "root.configurationError"
        public static let signedIn = "root.signedIn"
        public static let demo = "root.demo"

        static let all = [launch, configurationError, signedIn, demo]
    }

    /// Sign-in, create account, single sign-on and sign-out (MAZ-68).
    public enum Auth {
        public static let restoring = "auth.restoring"
        public static let keychainUnavailable = "auth.keychainUnavailable"
        public static let tryDemo = "auth.tryDemo"
        public static let server = "auth.server"
        public static let changeServer = "auth.changeServer"
        public static let email = "auth.email"
        public static let password = "auth.password"
        public static let signIn = "auth.signIn"
        public static let createAccount = "auth.createAccount"
        public static let switchMode = "auth.switchMode"
        public static let singleSignOn = "auth.singleSignOn"
        public static let singleSignOnRetry = "auth.singleSignOnRetry"
        public static let error = "auth.error"
        public static let notice = "auth.notice"
        public static let removeLeftoverData = "auth.removeLeftoverData"
        public static let signOut = "auth.signOut"
        public static let back = "auth.back"
        public static let passwordStrength = "auth.passwordStrength"
        public static let passwordRule = "auth.passwordRule"
        // Password reset (MAZ-124): Forgot password, the reset email and the reset code.
        public static let forgotPassword = "auth.forgotPassword"
        public static let sendResetLink = "auth.sendResetLink"
        public static let resetSent = "auth.resetSent"
        public static let resend = "auth.resend"
        public static let enterResetCode = "auth.enterResetCode"
        public static let resetCode = "auth.resetCode"
        public static let newPassword = "auth.newPassword"
        public static let setPassword = "auth.setPassword"

        static let all = [
            restoring, keychainUnavailable, tryDemo, server, changeServer, email, password, signIn, createAccount,
            switchMode, singleSignOn, singleSignOnRetry, error, notice, removeLeftoverData, signOut, back,
            passwordStrength, passwordRule, forgotPassword, sendResetLink, resetSent, resend, enterResetCode, resetCode,
            newPassword, setPassword,
        ]
    }

    /// Server connect.
    public enum Server {
        public static let url = "server.url"
        public static let check = "server.check"
        public static let verified = "server.verified"
        public static let use = "server.use"
        public static let checkAgain = "server.checkAgain"
        public static let clear = "server.clear"
        public static let close = "server.close"
        public static let infoURL = "serverInfo.url"

        static let all = [url, check, verified, use, checkAgain, clear, close, infoURL]
    }

    /// The iPhone tab bar. `tab(_:)` takes an `AppTab` raw value.
    public enum Tab {
        public static func tab(_ rawValue: String) -> String { "tab.\(rawValue)" }
        public static let add = "tab.add"
        /// The cards' tab bar itself (`PennyTabBar`, MAZ-254).
        public static let bar = "tab.bar"

        static let all = [add, bar]
        static let prefixes = ["tab."]
    }

    /// The iPad sidebar. `item(_:)` takes the lowercased item title.
    public enum Sidebar {
        public static func item(_ lowercasedTitle: String) -> String { "sidebar.\(lowercasedTitle)" }
        public static let settings = "sidebar.settings"
        /// Together's rows (MAZ-182): each household and trip by its id.
        public static func household(_ id: String) -> String { "sidebar.household.\(id)" }
        public static func trip(_ id: String) -> String { "sidebar.trip.\(id)" }

        static let all = [settings]
        static let prefixes = ["sidebar."]
    }

    /// Home.
    public enum Home {
        public static let settings = "home.settings"
        public static let hero = "home.hero"
        public static let month = "home.month"
        public static let flow = "home.flow"
        public static let recent = "home.recent"
        public static let empty = "home.empty"
        /// The empty Home's Income, Expense and Invest tiles (`empty-home` card, MAZ-245).
        public static let emptyIncome = "emptyHome.income"
        public static let emptyExpense = "emptyHome.expense"
        public static let emptyInvest = "emptyHome.invest"
        public static let emptyDemo = "emptyHome.demo"
        // MAZ-77: projected and expected income, Explore your month, the iPad dashboard panels.
        public static let projected = "home.projected"
        public static let expectedIncome = "home.expectedIncome"
        public static let explore = "home.explore"
        public static let exploreCalendar = "home.exploreCalendar"
        public static let exploreInsights = "home.exploreInsights"
        public static let exploreMoneyFlow = "home.exploreMoneyFlow"
        /// The toolbar calendar button (MAZ-180), next to Settings as on the `home` card; it opens
        /// the calendar sheet (MAZ-254).
        public static let calendar = "home.calendar"
        public static let totals = "home.totals"
        public static let comingUp = "home.comingUp"
        public static let dailySpending = "home.dailySpending"
        public static let sharedNotice = "home.sharedNotice"
        public static let sharedNoticeRetry = "home.sharedNoticeRetry"
        /// iPad Home's toolbar (`ipad-home` card, MAZ-245): the month's back and forward
        /// arrows, search (Activity's search field) and the copper Add entry capsule.
        public static let previousMonth = "home.previousMonth"
        public static let nextMonth = "home.nextMonth"
        public static let search = "home.search"
        public static let add = "home.add"
        /// The Follow your money card's Insights pill (`home` card, MAZ-254).
        public static let insights = "home.insights"
        /// iPad Home in portrait (`ipad-home-portrait`): spending by category, and each of its rows
        /// (`home.category.<category id>`).
        public static let byCategory = "home.byCategory"
        public static func category(_ id: String) -> String { "home.category.\(Overview.segment(id))" }

        static let all = [
            settings, hero, month, flow, recent, empty, emptyIncome, emptyExpense, emptyInvest, emptyDemo,
            projected, expectedIncome, explore, exploreCalendar, exploreInsights, exploreMoneyFlow, totals, comingUp,
            dailySpending, sharedNotice, sharedNoticeRetry, calendar, previousMonth, nextMonth, search, add, insights,
            byCategory,
        ]
        static let prefixes = ["home.category."]
    }

    /// The money flow, Insights, a category's spending and the calendar (MAZ-77). Flow rows and
    /// categories end in their id with any character outside `[A-Za-z0-9_-]` written as `-`
    /// (`moneyFlow.node.expense-food`); calendar days end in `YYYY-MM-DD`.
    public enum Overview {
        public static let flowTotals = "moneyFlow.totals"
        public static let flowChart = "moneyFlow.chart"
        public static let flowFocus = "moneyFlow.focus"
        public static let flowFocusClear = "moneyFlow.focusClear"
        public static let flowDetails = "moneyFlow.details"
        /// The focus hint and "Show as a table" under the chart (MAZ-224).
        public static let flowHint = "moneyFlow.hint"
        public static let flowTable = "moneyFlow.table"
        public static let insightsComparison = "insights.comparison"
        public static let insightsDonut = "insights.donut"
        public static let categoryTotal = "categorySpending.total"
        public static let calendarPrevious = "calendar.previous"
        public static let calendarNext = "calendar.next"
        public static let calendarToday = "calendar.today"
        /// The calendar sheet's Close (MAZ-254).
        public static let calendarClose = "calendar.close"
        public static let calendarGrid = "calendar.grid"
        public static let calendarDayTotal = "calendar.dayTotal"
        public static let calendarDayEntries = "calendar.dayEntries"
        public static let calendarLegend = "calendar.legend"

        /// A chart label of the money flow (`MoneyFlow.Node.id`).
        public static func flowNode(_ id: String) -> String { "moneyFlow.node.\(segment(id))" }
        /// A row of the money flow's value list.
        public static func flowRow(_ id: String) -> String { "moneyFlow.row.\(segment(id))" }
        /// An Insights category row (category id).
        public static func category(_ id: String) -> String { "insights.category.\(segment(id))" }
        /// A calendar day, `YYYY-MM-DD`.
        public static func day(_ date: String) -> String { "calendar.day.\(date)" }

        static func segment(_ id: String) -> String {
            String(
                id.unicodeScalars.map { scalar -> Character in
                    let allowed =
                        ("a"..."z").contains(scalar) || ("A"..."Z").contains(scalar) || ("0"..."9").contains(scalar)
                        || scalar == "_" || scalar == "-"
                    return allowed ? Character(scalar) : "-"
                })
        }

        static let all = [
            flowTotals, flowChart, flowFocus, flowFocusClear, flowDetails, flowHint, flowTable, insightsComparison,
            insightsDonut,
            categoryTotal, calendarPrevious, calendarNext, calendarToday, calendarClose, calendarGrid,
            calendarDayTotal, calendarDayEntries, calendarLegend,
        ]
        static let prefixes = ["moneyFlow.node.", "moneyFlow.row.", "insights.category.", "calendar.day."]
    }

    /// Settings and its pages. `row(_:)` takes a `SettingsRoute` raw value.
    public enum Settings {
        public static func row(_ rawValue: String) -> String { "settings.\(rawValue)" }
        public static let done = "settings.done"
        /// iPad: the toolbar's copper Add entry capsule (`ipad-settings` card, MAZ-254).
        public static let add = "settings.add"
        public static let server = "settings.server"
        public static let syncStatus = "settings.syncStatus"
        /// The large title of the page beside the iPad's Settings list (MAZ-250).
        public static let pageTitle = "settings.pageTitle"
        public static let account = "settings.account"
        public static let leaveDemo = "settings.leaveDemo"
        /// `Currency` raw values (`CAD`, `EUR`, ...).
        public static func currency(_ code: String) -> String { "currency.\(code)" }
        /// `AppearancePreference` raw values.
        public static func appearance(_ rawValue: String) -> String { "appearance.\(rawValue)" }
        /// The Display section (MAZ-250).
        public static let showCents = "appearance.showCents"
        public static let reduceTransparency = "appearance.reduceTransparency"
        public static let weekStart = "appearance.weekStart"
        public static let appLockToggle = "appLock.toggle"
        public static let appLockMessage = "appLock.message"
        public static let appLockHeader = "appLock.header"
        /// `AppLockDelay` raw values (`immediately`, `oneMinute`, `fiveMinutes`).
        public static func appLockDelay(_ rawValue: String) -> String { "appLock.delay.\(rawValue)" }

        static let all = [
            done, server, syncStatus, pageTitle, account, leaveDemo, appLockToggle, appLockMessage, appLockHeader,
            showCents, reduceTransparency, weekStart, add,
        ]
        static let prefixes = ["settings.", "currency.", "appearance.", "appLock.delay."]
    }

    /// Entries, trips and other model rows.
    public enum Row {
        /// A transaction row (Activity, Home Recent) by its ledger id.
        public static func entry(_ id: String) -> String { "entry.\(id)" }
        public static func trip(_ id: String) -> String { "trip.\(id)" }

        static let prefixes = ["entry.", "trip."]
    }

    /// The add and edit entry sheet (MAZ-73). `keypad(_:)` takes a digit, `separator` or `delete`
    /// (the iPhone keypad; iPad types into `amount`); `category(_:)` takes a category id.
    public enum EntryForm {
        public static let kind = "entryForm.kind"
        public static let amount = "entryForm.amount"
        public static let title = "entryForm.title"
        public static let account = "entryForm.account"
        public static let date = "entryForm.date"
        public static let save = "entryForm.save"
        public static let close = "entryForm.close"
        public static let discard = "entryForm.discard"
        public static let retry = "entryForm.retry"
        /// Where a new expense goes: Personal or a household (opens the Household picker).
        public static let household = "entryForm.household"
        public static func keypad(_ key: String) -> String { "keypad.\(key)" }
        public static func category(_ id: String) -> String { "entryForm.category.\(id)" }
        /// A Household picker row: a household id, or `personal`.
        public static func householdOption(_ id: String?) -> String { "householdPicker.\(id ?? "personal")" }

        static let all = [kind, amount, title, account, date, save, close, discard, retry, household]
        static let prefixes = ["keypad.", "entryForm.category.", "householdPicker."]
    }

    /// Activity and its filters (MAZ-73). `kindFilter(_:)` takes an `EntryKind` raw value or `all`.
    public enum Activity {
        public static let filters = "activity.filters"
        /// iPad: the toolbar's copper Add entry capsule (`ipad-activity` card, MAZ-254).
        public static let add = "activity.add"
        public static let totals = "activity.totals"
        public static let searchEmpty = "activity.searchEmpty"
        /// iPad: the detail beside the list before an entry is chosen.
        public static let noSelection = "activity.noSelection"
        public static let deleteConfirm = "deleteEntry.confirm"
        /// Activity's own search field (MAZ-255): the bottom bar on iPhone, under the title on iPad.
        public static let search = "activity.search"
        /// iPhone: the bottom bar's back button, × while searching (`activity`, `search-empty`).
        public static let searchBack = "activity.searchBack"
        public static let searchClear = "activity.searchClear"
        public static let searchBar = "activity.searchBar"
        public static func kindFilter(_ rawValue: String) -> String { "activity.filter.\(rawValue)" }

        static let all = [
            filters, totals, searchEmpty, noSelection, deleteConfirm, add, search, searchBack, searchClear, searchBar,
        ]
        static let prefixes = ["activity.filter."]
    }

    /// Accounts, categories and recurring schedules (MAZ-74). Rows take the model id.
    public enum Organize {
        public static let addAccount = "accounts.add"
        public static let addCategory = "categories.add"
        public static let addSchedule = "recurring.add"
        public static let accountName = "accountForm.name"
        public static let accountSave = "accountForm.save"
        public static let categoryName = "categoryForm.name"
        public static let categorySave = "categoryForm.save"
        public static let scheduleSave = "scheduleForm.save"
        /// The schedule page's … menu (Edit, Pause or Resume, Remove).
        public static let scheduleMore = "schedule.more"
        public static func account(_ id: String) -> String { "account.\(id)" }
        public static func category(_ id: String) -> String { "category.\(id)" }
        public static func schedule(_ id: String) -> String { "schedule.\(id)" }
        /// A household's shared schedule on Recurring (MAZ-198), by its rule id.
        public static func sharedSchedule(_ id: String) -> String { "sharedSchedule.\(id)" }

        static let all = [
            addAccount, addCategory, addSchedule, accountName, accountSave, categoryName, categorySave, scheduleSave,
            scheduleMore,
        ]
        static let prefixes = ["account.", "category.", "schedule.", "sharedSchedule."]
    }

    /// Banners, toasts and named states.
    public enum Feedback {
        public static let syncBanner = "banner.sync"
        public static let demoBanner = "banner.demo"
        public static let saveErrorBanner = "banner.saveError"
        public static let savedToast = "toast.saved"
        /// `PennyStateView` kinds (`state.empty`, `state.unavailable`, ...).
        public static func state(_ kind: String) -> String { "state.\(kind)" }

        static let all = [syncBanner, demoBanner, saveErrorBanner, savedToast]
        static let prefixes = ["state."]
    }

    /// The app lock cover.
    public enum Lock {
        public static let message = "lock.message"
        public static let retry = "lock.retry"
        public static let unlock = "lock.unlock"

        static let all = [message, retry, unlock]
    }

    /// Receipts (MAZ-78): More details' Receipt group, the upload row, the entry detail's receipt
    /// row and the receipt viewer (`screen.receipt`).
    public enum Receipt {
        public static let screen = "screen.receipt"
        /// The form's "Receipt, repeat, trip" row, which opens More details.
        public static let moreDetails = "entryForm.details"
        public static let attached = "entryExtras.receipt"
        public static let remove = "entryExtras.removeReceipt"
        public static let photo = "entryExtras.receiptPhoto"
        public static let file = "entryExtras.receiptFile"
        public static let hint = "entryExtras.receiptHint"
        public static let detailRow = "entryDetail.receipt"
        public static let saveWaiting = "entryForm.receiptUploading"
        public static let reading = "receiptUpload.reading"
        public static let progress = "receiptUpload.progress"
        public static let cancel = "receiptUpload.cancel"
        public static let retry = "receiptUpload.retry"
        public static let dismiss = "receiptUpload.dismiss"
        public static let error = "receiptUpload.error"
        public static let viewerClose = "receipt.close"
        public static let viewerTitle = "receipt.title"
        public static let viewerShare = "receipt.share"
        public static let viewerRemove = "receipt.remove"
        public static let viewerLoading = "receipt.loading"
        public static let viewerError = "receipt.error"
        public static let viewerRetry = "receipt.retry"
        public static let viewerImage = "receipt.image"
        public static let viewerPDF = "receipt.pdf"
        public static let viewerPageCount = "receipt.pageCount"
        public static let viewerUndecodable = "receipt.undecodable"
        public static let viewerEntry = "receipt.entry"

        static let all = [
            screen, moreDetails, attached, remove, photo, file, hint, detailRow, saveWaiting, reading, progress, cancel,
            retry,
            dismiss, error, viewerClose, viewerTitle, viewerShare, viewerRemove, viewerLoading, viewerError,
            viewerRetry, viewerImage, viewerPDF, viewerPageCount, viewerUndecodable, viewerEntry,
        ]
    }

    /// Every fixed identifier, for the convention and drift tests.
    public static let fixed: [String] =
        Screen.all + Root.all + Auth.all + Server.all + Tab.all + Sidebar.all + Home.all + Settings.all + EntryForm.all
        + Activity.all + Organize.all + Feedback.all + Lock.all + Overview.all
        + Households.all
        + Receipt.all
        + ReceiptInbox.all
        + Profile.all
        + EmailVerification.all
        + AccountData.all
        + Trips.all
        + Notifications.all
        + Journeys.all
        + Cards.all

    /// Prefixes of identifiers that end in a model id or raw value.
    public static let dynamicPrefixes: [String] =
        Tab.prefixes + Sidebar.prefixes + Settings.prefixes + Row.prefixes + Feedback.prefixes + EntryForm.prefixes
        + Activity.prefixes + Organize.prefixes + Overview.prefixes + Home.prefixes
        + Households.prefixes
        + ReceiptInbox.prefixes
        + Trips.prefixes
}
