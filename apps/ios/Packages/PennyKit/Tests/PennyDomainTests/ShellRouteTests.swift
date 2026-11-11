import Foundation
import PennyDomain
import Testing

@Suite("Shell navigation")
struct ShellRouteTests {
    @Test(
        "whenDeepLinkOpens_ShellRoute_ShouldShowItsDestinationFromTheTabRoot",
        arguments: [
            (DeepLink.home, AppTab.home, [DetailRoute]()),
            (.activity, .activity, []),
            (.households, .shared, []),
            (.household(id: "h1"), .shared, [.household(id: "h1")]),
            (
                .householdExpense(householdID: "h1", expenseID: "e2"), .shared,
                [.household(id: "h1"), .householdExpense(householdID: "h1", expenseID: "e2")]
            ),
            (.trips, .trips, []),
            (.trip(id: "t3"), .trips, [.trip(id: "t3")]),
        ])
    func tabDestinations(link: DeepLink, tab: AppTab, path: [DetailRoute]) {
        var route = ShellRoute()
        route.push(.trip(id: "elsewhere"))
        route.openSettings(.appearance)
        route.open(link)
        #expect(route.tab == tab)
        #expect(route.path(for: tab) == path)
        #expect(!route.isSettingsPresented, "a sheet must not hide the destination")
        #expect(!route.isAddEntryPresented)
    }

    @Test(
        "whenSettingsLinkOpens_ShellRoute_ShouldOpenThatSettingsPage",
        arguments: [
            (DeepLink.SettingsPage.accounts, SettingsRoute.accounts), (.categories, .categories),
            (.recurring, .recurring),
        ])
    func settingsLinks(page: DeepLink.SettingsPage, expected: SettingsRoute) {
        var route = ShellRoute(tab: .trips)
        route.open(.settings(page))
        #expect(route.isSettingsPresented)
        #expect(route.settingsPath == [expected])
        #expect(route.tab == .trips, "Settings opens over the current tab")
        #expect(route.sidebarSelection == .manage(expected))
    }

    @Test("whenAddEntryLinkOpens_ShellRoute_ShouldOpenTheSheetOverTheCurrentPlace")
    func addEntry() {
        var route = ShellRoute(tab: .trips)
        route.push(.trip(id: "t1"))
        route.openSettings()
        route.open(.addEntry)
        #expect(route.isAddEntryPresented)
        #expect(!route.isSettingsPresented)
        #expect(route.tab == .trips)
        #expect(route.path(for: .trips) == [.trip(id: "t1")], "the draft opens over the current page")
    }

    @Test("whenAuthCallbackOpens_ShellRoute_ShouldNotMove")
    func authCallback() {
        var route = ShellRoute(tab: .activity)
        route.open(.authCallback(query: [URLQueryItem(name: "code", value: "x")]))
        #expect(route == ShellRoute(tab: .activity))
    }

    @Test("whenSwitchingTabs_ShellRoute_ShouldKeepEachTabsStack")
    func stacksPerTab() {
        var route = ShellRoute()
        route.select(.trips)
        route.push(.trip(id: "t1"))
        route.select(.home)
        #expect(route.path(for: .trips) == [.trip(id: "t1")])
        route.select(.trips)
        #expect(route.path(for: .trips) == [.trip(id: "t1")])
    }

    @Test("whenCurrentTabIsChosenAgain_ShellRoute_ShouldReturnToItsRoot")
    func reselectPopsToRoot() {
        var route = ShellRoute(tab: .shared)
        route.push(.household(id: "h1"))
        route.select(.shared)
        #expect(route.path(for: .shared).isEmpty)
    }

    @Test("whenSidebarSelects_ShellRoute_ShouldMapToTheSameStateAsTheTabBar")
    func sidebar() {
        var route = ShellRoute()
        route.sidebarSelection = .manage(.categories)
        #expect(route.isSettingsPresented && route.settingsPath == [.categories])
        route.sidebarSelection = .settings
        #expect(route.sidebarSelection == .settings && route.settingsPath.isEmpty)
        route.settingsPath.append(.appearance)
        #expect(route.sidebarSelection == .settings, "Appearance is a page under Settings")
        route.sidebarSelection = .tab(.activity)
        #expect(!route.isSettingsPresented && route.tab == .activity && route.sidebarSelection == .tab(.activity))
    }

    @Test("whenTabsListed_AppTab_ShouldBeHomeActivitySharedTripsWithNoMore")
    func tabs() throws {
        let navigation = try #require(
            try Repository.json("contracts/design-baseline.json")["navigation"] as? [String: Any])
        let iPhone = try #require(navigation["iPhone"] as? [String: Any])
        #expect(AppTab.allCases.map(\.title) == iPhone["tabs"] as? [String])
        #expect(SettingsRoute.manage == [.recurring, .accounts, .categories])
    }
}

@Suite("Deep links after sign-in and unlock")
struct DeepLinkInboxTests {
    let alex = DeepLinkSession.account("https://penny.example.test alex@example.test")
    let sam = DeepLinkSession.account("https://penny.example.test sam@example.test")

    @Test("whenALinkArrivedForOneAccount_DeepLinkInbox_ShouldNotOpenItInTheNextAccount")
    func tiedToTheAccount() {
        var inbox = DeepLinkInbox()
        inbox.sessionChanged(to: alex)
        inbox.receive(.activity)
        // Alex signs out before unlocking; Sam signs in.
        inbox.sessionChanged(to: nil)
        inbox.sessionChanged(to: sam)
        #expect(inbox.take(ready: true, for: sam) == nil)
        #expect(inbox.pending == nil, "dropped, not kept for later")

        inbox.sessionChanged(to: alex)
        inbox.receive(.activity)
        inbox.sessionChanged(to: nil)
        inbox.sessionChanged(to: alex)
        #expect(inbox.take(ready: true, for: alex) == .activity, "the same account signing in again opens it")
    }

    @Test("whenTheDemoOpensWhileALinkWaits_DeepLinkInbox_ShouldKeepTheLinkForTheAccount")
    func demoLeavesAccountLinks() {
        var inbox = DeepLinkInbox()
        inbox.receive(.addEntry)
        inbox.sessionChanged(to: .demo)
        #expect(inbox.take(ready: true, for: .demo) == nil)
        #expect(inbox.pending == .addEntry)
        inbox.sessionChanged(to: alex)
        #expect(inbox.take(ready: true, for: alex) == .addEntry, "a link from before sign-in opens in the account")
    }

    @Test("whenALinkArrivesDuringTheDemo_DeepLinkInbox_ShouldOpenItInTheDemoOnly")
    func demoLinks() {
        var inbox = DeepLinkInbox()
        inbox.sessionChanged(to: .demo)
        inbox.receive(.activity)
        #expect(inbox.take(ready: true, for: .demo) == .activity)
        inbox.receive(.home)
        inbox.sessionChanged(to: alex)
        #expect(inbox.take(ready: true, for: alex) == nil, "a demo link never opens in an account")
        #expect(inbox.pending == nil)
    }

    @Test("whenLinkArrivesBeforeTheShellIsReady_DeepLinkInbox_ShouldKeepItUntilReady")
    func waitsForReady() {
        var inbox = DeepLinkInbox()
        inbox.receive(.trip(id: "t1"))
        #expect(inbox.take(ready: false, for: alex) == nil, "signed out or locked: keep it")
        #expect(inbox.pending == .trip(id: "t1"))
        #expect(inbox.take(ready: true, for: alex) == .trip(id: "t1"))
        #expect(inbox.take(ready: true, for: alex) == nil, "delivered once")
    }

    @Test("whenSeveralLinksArriveWhileLocked_DeepLinkInbox_ShouldOpenOnlyTheNewest")
    func newestWins() {
        var inbox = DeepLinkInbox()
        inbox.receive(.activity)
        inbox.receive(.addEntry)
        #expect(inbox.take(ready: true, for: alex) == .addEntry)
    }

    @Test("whenAuthCallbackArrives_DeepLinkInbox_ShouldIgnoreIt")
    func ignoresCallback() {
        var inbox = DeepLinkInbox(.home)
        inbox.receive(.authCallback(query: []))
        #expect(inbox.pending == .home)
    }

    @Test("whenSignedInAndUnlockedAfterALegacyLink_Shell_ShouldOpenTheLinksDestination")
    func afterAuthentication() throws {
        var inbox = DeepLinkInbox()
        let url = try #require(URL(string: "penny://households/h1/expenses/e2"))
        inbox.receive(try #require(DeepLink(url: url)))
        var route = ShellRoute()
        // Restoring the session, then the lock prompt: nothing is shown yet.
        #expect(inbox.take(ready: false, for: alex) == nil)
        if let link = inbox.take(ready: true, for: alex) { route.open(link) }
        #expect(route.tab == .shared)
        #expect(route.path(for: .shared).last == .householdExpense(householdID: "h1", expenseID: "e2"))
    }
}

@Suite("Demo ledger")
struct DemoLedgerTests {
    private let today = CalendarDate(year: 2026, month: 11, day: 9) ?? .earliest

    @Test("whenBuilt_DemoLedger_ShouldBeValidAndDatedInTheCurrentMonth")
    func valid() {
        let ledger = DemoLedger.make(today: today)
        #expect(ledger.violations.isEmpty)
        #expect(!ledger.transactions.isEmpty)
        #expect(ledger.transactions.allSatisfy { MonthKey(today).contains($0.date) && $0.date <= today })
    }

    @Test("whenBuiltOnTheFirstOfTheMonth_DemoLedger_ShouldNotReachIntoTheLastMonth")
    func firstOfMonth() throws {
        let first = try #require(CalendarDate(year: 2026, month: 3, day: 1))
        #expect(DemoLedger.make(today: first).transactions.allSatisfy { $0.date == first })
    }

    @Test("whenBuilt_DemoLedger_ShouldMarkEveryIdAsDemo")
    func ids() {
        let ledger = DemoLedger.make(today: today)
        let ids =
            ledger.transactions.map(\.id) + ledger.recurring.map(\.id) + ledger.accounts.map(\.id)
            + ledger.trips.map(\.id)
        #expect(ids.allSatisfy { $0.hasPrefix(DemoLedger.idPrefix) })
        #expect(Set(ids).count == ids.count)
    }

    @Test("whenComparedWithTheAPI_Currency_ShouldOfferExactlyTheLedgerCurrencies")
    func currencies() throws {
        let schemas = try #require(
            (try Repository.json("contracts/openapi.json")["components"] as? [String: Any])?["schemas"]
                as? [String: Any])
        let ledger = try #require(schemas["Ledger"] as? [String: Any])
        let currency = try #require((ledger["properties"] as? [String: Any])?["currency"] as? [String: Any])
        #expect(currency["enum"] as? [String] == Currency.allCases.map(\.rawValue))
    }
}
