import Foundation
import PennyDomain
import Testing

@Suite("Deep links")
struct DeepLinkTests {
    @Test(
        "whenKnownRoute_DeepLink_ShouldOpenItsDestination",
        arguments: [
            ("penny:///", DeepLink.home),
            ("penny://", .home),
            ("penny:///transactions", .activity),
            ("penny:///entries/new", .addEntry),
            ("penny:///accounts", .settings(.accounts)),
            ("penny:///categories", .settings(.categories)),
            ("penny:///recurring", .settings(.recurring)),
            ("penny:///households", .households),
            ("penny:///households/h1", .household(id: "h1")),
            ("penny:///households/h1/expenses/e2", .householdExpense(householdID: "h1", expenseID: "e2")),
            ("penny:///trips", .trips),
            ("penny:///trips/t3", .trip(id: "t3")),
        ])
    func knownRoutes(url: String, expected: DeepLink) throws {
        #expect(DeepLink(url: try #require(URL(string: url))) == expected)
    }

    @Test("whenFirstSegmentIsTheHost_DeepLink_ShouldParseLikeAnEmptyHost")
    func hostForm() throws {
        // The Recent expenses widget links to penny://entries/new (`DeepLink.addEntry`).
        #expect(DeepLink(url: try #require(URL(string: "penny://entries/new"))) == .addEntry)
        #expect(DeepLink(url: try #require(URL(string: "PENNY://trips/t3/"))) == .trip(id: "t3"))
    }

    @Test("whenEveryBaselineRoute_DeepLink_ShouldHaveADestination")
    func everyBaselineRoute() throws {
        let navigation = try #require(
            try Repository.json("contracts/design-baseline.json")["navigation"] as? [String: Any])
        let routes = try #require(navigation["routes"] as? [[String: Any]]).compactMap { $0["route"] as? String }
        #expect(routes.count >= 12)
        for route in routes {
            let path = route.replacingOccurrences(of: "[id]", with: "x").replacingOccurrences(
                of: "[expenseId]", with: "y")
            #expect(DeepLink(url: try #require(URL(string: "penny://\(path)"))) != nil, "No destination for \(route)")
        }
    }

    @Test("whenOidcCallback_DeepLink_ShouldPassTheQueryOn")
    func authCallback() throws {
        let link = DeepLink(url: try #require(URL(string: "penny://auth/callback?code=abc&state=xyz")))
        #expect(
            link
                == .authCallback(query: [
                    URLQueryItem(name: "code", value: "abc"), URLQueryItem(name: "state", value: "xyz"),
                ]))
    }

    @Test(
        "whenUnknownOrUnsafe_DeepLink_ShouldReturnNil",
        arguments: [
            "https://penny.example.com/transactions",
            "penny:///settings",
            "penny:///entries",
            "penny:///households/h1/expenses",
            "penny:///trips/../accounts",
            "penny:///trips/\(String(repeating: "a", count: 129))",
        ])
    func rejected(url: String) throws {
        #expect(DeepLink(url: try #require(URL(string: url))) == nil)
    }
}
