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

        static let all = [
            home, activity, shared, household, householdExpense, trips, trip, addEntry, settings, appearance, currency,
            appLock, recurring, accounts, categories, lock,
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

        static let all = [
            restoring, keychainUnavailable, tryDemo, server, changeServer, email, password, signIn, createAccount,
            switchMode, singleSignOn, singleSignOnRetry, error, notice, removeLeftoverData, signOut,
        ]
    }

    /// Server connect.
    public enum Server {
        public static let url = "server.url"
        public static let check = "server.check"
        public static let verified = "server.verified"
        public static let use = "server.use"
        public static let checkAgain = "server.checkAgain"
        public static let infoURL = "serverInfo.url"

        static let all = [url, check, verified, use, checkAgain, infoURL]
    }

    /// The iPhone tab bar. `tab(_:)` takes an `AppTab` raw value.
    public enum Tab {
        public static func tab(_ rawValue: String) -> String { "tab.\(rawValue)" }
        public static let add = "tab.add"

        static let all = [add]
        static let prefixes = ["tab."]
    }

    /// The iPad sidebar. `item(_:)` takes the lowercased item title.
    public enum Sidebar {
        public static func item(_ lowercasedTitle: String) -> String { "sidebar.\(lowercasedTitle)" }
        public static let add = "sidebar.add"
        public static let settings = "sidebar.settings"

        static let all = [add, settings]
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
        public static let emptyAdd = "emptyHome.add"
        public static let emptyDemo = "emptyHome.demo"

        static let all = [settings, hero, month, flow, recent, empty, emptyAdd, emptyDemo]
    }

    /// Settings and its pages. `row(_:)` takes a `SettingsRoute` raw value.
    public enum Settings {
        public static func row(_ rawValue: String) -> String { "settings.\(rawValue)" }
        public static let done = "settings.done"
        public static let server = "settings.server"
        public static let syncStatus = "settings.syncStatus"
        public static let leaveDemo = "settings.leaveDemo"
        /// `Currency` raw values (`CAD`, `EUR`, ...).
        public static func currency(_ code: String) -> String { "currency.\(code)" }
        /// `AppearancePreference` raw values.
        public static func appearance(_ rawValue: String) -> String { "appearance.\(rawValue)" }
        public static let appLockToggle = "appLock.toggle"
        public static let appLockMessage = "appLock.message"

        static let all = [done, server, syncStatus, leaveDemo, appLockToggle, appLockMessage]
        static let prefixes = ["settings.", "currency.", "appearance."]
    }

    /// Entries, trips and other model rows.
    public enum Row {
        /// A transaction row (Activity, Home Recent) by its ledger id.
        public static func entry(_ id: String) -> String { "entry.\(id)" }
        public static func trip(_ id: String) -> String { "trip.\(id)" }

        static let prefixes = ["entry.", "trip."]
    }

    /// Add entry (MAZ-73 replaces the placeholder sheet).
    public enum AddEntry {
        public static let close = "addEntry.close"

        static let all = [close]
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

    /// Every fixed identifier, for the convention and drift tests.
    public static let fixed: [String] =
        Screen.all + Root.all + Auth.all + Server.all + Tab.all + Sidebar.all + Home.all + Settings.all + AddEntry.all
        + Feedback.all + Lock.all

    /// Prefixes of identifiers that end in a model id or raw value.
    public static let dynamicPrefixes: [String] =
        Tab.prefixes + Sidebar.prefixes + Settings.prefixes + Row.prefixes + Feedback.prefixes
}
