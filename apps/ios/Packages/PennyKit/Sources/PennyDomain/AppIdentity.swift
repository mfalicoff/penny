/// Identifiers the native app inherits from the retired Expo app (docs/ios-ipa.md).
/// Changing any of them breaks in-place upgrades from the App Store/TestFlight build:
/// a new bundle id is a new app, a new App Group loses the widgets' shared data, and a new
/// widget extension id or kind removes widgets people already placed. The app's tests
/// check the released Expo values, the signing docs, the release script and the built
/// Info.plist against these values.
public enum AppIdentity {
    public static let bundleIdentifier = "com.mfalicoff.penny"
    public static let appGroup = "group.com.mfalicoff.penny"
    public static let urlScheme = DeepLink.scheme

    /// The native WidgetKit extension (MAZ-80, `PennyWidgets/`). Expo's expo-widgets plugin
    /// generated this id, and the extension must keep it.
    public static let widgetExtensionBundleIdentifier = "com.mfalicoff.penny.ExpoWidgetsTarget"
    /// Widget `kind` strings of the Expo app's widgets; placed widgets are matched by kind.
    public static let widgetKinds = [balanceWidgetKind, recentExpensesWidgetKind]
    /// Monthly balance: Left to spend for the month (MAZ-80).
    public static let balanceWidgetKind = "BalanceChartWidget"
    /// Recent expenses, with the add-entry shortcut (MAZ-80).
    public static let recentExpensesWidgetKind = "RecentExpensesWidget"
}
