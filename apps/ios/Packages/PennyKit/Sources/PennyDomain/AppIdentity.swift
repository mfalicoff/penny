/// Identifiers the native app inherits from the legacy Expo app (app.json, docs/ios-ipa.md).
/// Changing any of them breaks in-place upgrades from the App Store/TestFlight build:
/// a new bundle id is a new app, a new App Group loses the widgets' shared data, and a new
/// widget extension id or kind removes widgets people already placed. The app's tests
/// check app.json, the signing docs and the built Info.plist against these values.
public enum AppIdentity {
    public static let bundleIdentifier = "com.mfalicoff.penny"
    public static let appGroup = "group.com.mfalicoff.penny"
    public static let urlScheme = DeepLink.scheme

    /// Reserved for the native WidgetKit extension (MAZ-80). Expo's expo-widgets plugin
    /// generated this id, and the extension must keep it.
    public static let widgetExtensionBundleIdentifier = "com.mfalicoff.penny.ExpoWidgetsTarget"
    /// Widget `kind` strings from the legacy app.json; placed widgets are matched by kind.
    public static let widgetKinds = ["BalanceChartWidget", "RecentExpensesWidget"]
}
