import PennyAccessibility
import XCTest

/// Performance baselines (MAZ-82, TestPlans/Performance.xctestplan): cold launch, the first sync
/// of a large ledger after sign-in, scrolling it, and searching it online and on the device.
///
/// Every measurement is attached as `perf-<name>.json` and compared with its budget in
/// `PerformanceTests.budgets` (documented in docs/ios-qa.md#performance-budgets). Budgets are
/// for the CI simulator, generous enough to absorb runner noise but tight enough to catch an
/// order-of-magnitude regression; the XCTest metrics (launch, scroll hitches) are recorded in the
/// result bundle for trend review rather than asserted, because simulator hitch numbers are not
/// representative of devices.
final class PerformanceTests: PennyUITestCase {
    /// Seconds.
    /// Regression budgets: about 1.5 times the first baseline (iPhone 18 Pro simulator, iOS 27.0,
    /// Debug, 2026-11-12), so an order-of-magnitude regression fails while runner noise does not.
    /// The targets the product should reach are in docs/ios-qa.md; `activity-open-large-ledger`
    /// is far from its target and tracked there.
    static let budgets: [String: Double] = [
        "launch-to-home-demo": 10,
        "sign-in-to-first-sync-large-ledger": 15,
        "activity-open-large-ledger": 40,
        "search-server-large-ledger": 15,
        "search-device-large-ledger": 15,
    ]

    /// Entries in the large ledger: about a year and a half of heavy use (the API allows 100,000).
    static let largeLedgerSize = 5_000

    /// Attaches the measurement and returns a message when it is over its budget. Tests collect
    /// the messages and throw once at the end (`checkBudgets`): an `XCTAssert` failure in async
    /// UI test code hangs the test instead of stopping it, and every number should be recorded.
    @MainActor
    private func record(_ name: String, seconds: Double, extra: [String: Any] = [:]) -> String? {
        var values: [String: Any] = [
            "name": name, "seconds": (seconds * 1000).rounded() / 1000, "device": Device.name,
            "budget": Self.budgets[name] ?? 0,
        ]
        values.merge(extra) { _, new in new }
        let data =
            (try? JSONSerialization.data(withJSONObject: values, options: [.prettyPrinted, .sortedKeys])) ?? Data()
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = "\(Device.name)-perf-\(name).json"
        attachment.lifetime = .keepAlways
        add(attachment)
        print("PERF \(Device.name) \(name) \(String(format: "%.3f", seconds))s budget \(Self.budgets[name] ?? 0)s")
        guard let budget = Self.budgets[name], seconds > budget else { return nil }
        return "\(name) took \(String(format: "%.2f", seconds))s, over its \(budget)s budget"
    }

    private func checkBudgets(_ overruns: [String?]) throws {
        let over = overruns.compactMap(\.self)
        guard over.isEmpty else { throw UIExpectationFailed(description: over.joined(separator: "; ")) }
    }

    @MainActor
    private func timed(_ work: () throws -> Void) rethrows -> Double {
        let start = Date()
        try work()
        return Date().timeIntervalSince(start)
    }

    /// Synthetic entries spread over 2025-05 … 2026-10, a fifth of them in the pinned month so
    /// Activity's default month has a long list. Titles cycle through a fixed vocabulary, and one
    /// marker entry per run is the search target.
    @MainActor
    static func largeLedger(prefix: String) -> [Stack.Transaction] {
        let words = [
            "Groceries", "Coffee", "Bus fare", "Lunch", "Pharmacy", "Books", "Hardware", "Bakery", "Cinema",
            "Streaming",
        ]
        let categories = ["groceries", "food", "transport", "food", "health", "shopping", "home", "food", "fun", "fun"]
        return (0..<largeLedgerSize).map { index in
            let inPinnedMonth = index % 5 == 0
            let month = inPinnedMonth ? 10 : 1 + (index % 9)
            let year = inPinnedMonth ? 2026 : (index % 2 == 0 ? 2026 : 2025)
            let day = 1 + (index % 15)
            let date = String(format: "%04d-%02d-%02d", year, month, day)
            let word = index % words.count
            return Stack.Transaction(
                id: "\(prefix)-\(index)", title: "\(words[word]) \(index)", cents: 100 + (index * 37) % 9_900,
                date: date, categoryID: categories[word])
        }
    }

    /// Cold launch into the demo's Home (no network), five times, with XCTest's launch metric
    /// in the result bundle and the wall-clock time to Home asserted against its budget.
    @MainActor
    func test_whenLaunchedCold_Launch_ShouldReachHomeWithinBudget() async throws {
        var options = LaunchOptions()
        options.usesStack = false
        options.demo = true
        let penny = try await launch(options)
        try penny.waitForShell()
        app.terminate()

        let configured = app
        let metricOptions = XCTMeasureOptions()
        metricOptions.iterationCount = 5
        measure(metrics: [XCTApplicationLaunchMetric(waitUntilResponsive: true)], options: metricOptions) {
            configured.launch()
            configured.terminate()
        }

        var samples: [Double] = []
        for _ in 0..<3 {
            samples.append(
                try timed {
                    configured.launch()
                    try Penny(app: configured).waitForShell()
                })
            configured.terminate()
        }
        let median = samples.sorted()[samples.count / 2]
        try checkBudgets([record("launch-to-home-demo", seconds: median, extra: ["samples": samples])])
    }

    /// A 5,000-entry ledger: the first sync after sign-in, opening Activity, scrolling it (with
    /// the scroll-deceleration hitch metric), server search and device search (while offline).
    @MainActor
    func test_whenTheLedgerIsLarge_SyncScrollAndSearch_ShouldStayWithinBudget() async throws {
        let stack = try await stack()
        let account = try await makeAccount("perf")
        let prefix = "perf-\(stack.configuration.runID)-\(Device.name)"
        var entries = Self.largeLedger(prefix: prefix)
        let marker = "\(prefix)-marker"
        entries.append(
            Stack.Transaction(id: marker, title: "Quillwort nursery seedlings", cents: 4321, categoryID: "home"))
        try await stack.addTransactions(token: account.token, entries)

        let penny = try await launch()
        try penny.type(account.email, into: AccessibilityID.Auth.email)
        try penny.type(account.password, into: AccessibilityID.Auth.password)
        let sync = try timed {
            try penny.tap(AccessibilityID.Auth.signIn)
            try penny.waitForShell(timeout: 60)
            try penny.wait(for: AccessibilityID.Home.hero, timeout: 60)
        }
        var overruns = [String?]()
        overruns.append(record("sign-in-to-first-sync-large-ledger", seconds: sync, extra: ["entries": entries.count]))

        let open = try timed {
            try penny.openActivity()
            try penny.wait(for: AccessibilityID.Activity.totals, timeout: 30)
        }
        overruns.append(record("activity-open-large-ledger", seconds: open))

        // Scrolling: XCTest's hitch metric over five passes (recorded in the xcresult).
        let list = app.collectionViews.firstMatch
        guard list.waitForExistence(timeout: Penny.timeout) else {
            throw UIExpectationFailed(description: "Activity has no list to scroll")
        }
        let scrollOptions = XCTMeasureOptions()
        scrollOptions.invocationOptions = [.manuallyStop]
        scrollOptions.iterationCount = 5
        measure(metrics: [XCTOSSignpostMetric.scrollDecelerationMetric], options: scrollOptions) {
            list.swipeUp(velocity: .fast)
            stopMeasuring()
            list.swipeDown(velocity: .fast)
        }
        screenshot("perf-activity-scrolled")

        // Server search: typing a rare word until the server's result row shows.
        let server = try timed {
            try penny.search("quillwort")
            try penny.wait(for: AccessibilityID.Journeys.searchScopeServer, timeout: 30)
            try penny.wait(for: AccessibilityID.Row.entry(marker), timeout: 30)
        }
        overruns.append(record("search-server-large-ledger", seconds: server))
        penny.endSearch()

        // Device search: the server drops the search request, so the same query runs over the 5,001
        // rows on the device, under "Couldn't search your server" (the device fallback's banner).
        try await stack.setFaults([.offline("/api/")])
        let device = try timed {
            try penny.search("quillwort")
            try penny.wait(for: AccessibilityID.Journeys.searchError, timeout: 30)
            try penny.wait(for: AccessibilityID.Row.entry(marker), timeout: 30)
        }
        overruns.append(record("search-device-large-ledger", seconds: device))
        screenshot("perf-search-device")
        try checkBudgets(overruns)
    }
}
