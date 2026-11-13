/// Identifiers frozen for TestFlight/App Store continuity (docs/ios-ipa.md). Changing any of
/// them breaks in-place upgrades of installed builds: a new bundle id is a new app, a new App
/// Group loses the widgets' shared data, and a new widget extension id or kind removes widgets
/// people already placed. The app's tests check the released values, the signing docs, the
/// release script and the built Info.plist against these values.
public enum AppIdentity {
    public static let bundleIdentifier = "com.mfalicoff.penny"
    public static let appGroup = "group.com.mfalicoff.penny"
    public static let urlScheme = DeepLink.scheme

    /// The WidgetKit extension (MAZ-80, `PennyWidgets/`). The id predates the native app and
    /// is frozen for TestFlight/App Store continuity: never rename it.
    public static let widgetExtensionBundleIdentifier = "com.mfalicoff.penny.ExpoWidgetsTarget"
    /// Widget `kind` strings, frozen: placed widgets are matched by kind.
    public static let widgetKinds = [balanceWidgetKind, recentExpensesWidgetKind]
    /// Monthly balance: Left to spend for the month (MAZ-80).
    public static let balanceWidgetKind = "BalanceChartWidget"
    /// Recent expenses, with the add-entry shortcut (MAZ-80).
    public static let recentExpensesWidgetKind = "RecentExpensesWidget"
}
