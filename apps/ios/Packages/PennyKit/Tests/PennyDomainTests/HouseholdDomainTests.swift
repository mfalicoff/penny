import Foundation
import PennyContracts
import PennyDomain
import Testing

@Suite("Household invites (MAZ-75)")
struct InviteLinkTests {
    static func server(_ text: String) throws -> ServerURL { try ServerURL(text) }

    @Test(
        "whenTyped_InviteCode_ShouldDropSeparatorsAndUpperCase",
        arguments: [
            ("4f2a9c01be", "4F2A9C01BE"), ("4F2A9 C01BE", "4F2A9C01BE"), (" 4f2a9-c01be ", "4F2A9C01BE"),
            ("4F2A9·C01BE", "4F2A9C01BE"), ("4f.2a.9c.01.be", "4F2A9C01BE"),
        ])
    func typedCodes(input: String, expected: String) {
        #expect(InviteCode(typed: input)?.value == expected)
    }

    @Test(
        "whenNotTenHexCharacters_InviteCode_ShouldBeRefused",
        arguments: ["", "4F2A9C01B", "4F2A9C01BEE", "4F2A9C01BG", "ＡＢＣＤＥ12345", "4F2A9C01B\u{0301}E"])
    func refusedCodes(input: String) {
        #expect(InviteCode(typed: input) == nil)
    }

    @Test("whenGrouped_InviteCode_ShouldReadAsTwoFivesAndTypeBack")
    func grouped() throws {
        let code = try #require(InviteCode(typed: "4F2A9C01BE"))
        #expect(code.grouped == "4F2A9 C01BE")
        #expect(InviteCode(typed: code.grouped) == code)
        #expect(code.spoken.hasPrefix("4, F, 2"))
    }

    @Test("whenBuilt_InviteLink_ShouldRoundTripThroughTheDeepLinkParser")
    func roundTrip() throws {
        let code = try #require(InviteCode(typed: "a1b2c3d4e5"))
        let link = InviteLink(code: code, server: try Self.server("https://penny.example.test:8443/base"))
        #expect(link.url.scheme == "penny")
        #expect(link.url.absoluteString.hasPrefix("penny://join?code=A1B2C3D4E5&server=https%3A%2F%2F"))
        guard case .join(let parsedCode, let parsedServer) = DeepLink(url: link.url) else {
            Issue.record("not a join link")
            return
        }
        let parsed = try InviteLink(code: parsedCode, server: parsedServer, allowsLoopbackHTTP: false)
        #expect(parsed == link)
    }

    @Test("whenTheLinkNamesNoServer_InviteLink_ShouldMeanTheCurrentOne")
    func noServer() throws {
        let link = try InviteLink(code: "A1B2C3D4E5", server: nil, allowsLoopbackHTTP: false)
        #expect(link.server == nil)
        #expect(link.target(current: try Self.server("https://penny.example.test")) == .current)
        #expect(InviteLink(code: link.code, server: nil).url.absoluteString == "penny://join?code=A1B2C3D4E5")
    }

    @Test("whenTheLinkNamesAnotherServer_InviteLink_ShouldAskForThatServer")
    func otherServer() throws {
        let mine = try Self.server("https://penny.example.test")
        let theirs = try Self.server("https://friends.example.test")
        let link = try InviteLink(code: "A1B2C3D4E5", server: theirs.description, allowsLoopbackHTTP: false)
        #expect(link.target(current: mine) == .other(theirs))
        #expect(link.target(current: theirs) == .current)
        // Signed out with no server chosen: still "another" server, so the app asks first.
        #expect(link.target(current: nil) == .other(theirs))
        // The same server written differently (case, default port, trailing slash) is the same.
        let same = try InviteLink(
            code: "A1B2C3D4E5", server: "HTTPS://Penny.Example.test:443/", allowsLoopbackHTTP: false)
        #expect(same.target(current: mine) == .current)
    }

    @Test(
        "whenTheLinkIsMalformed_InviteLink_ShouldRefuseIt",
        arguments: [
            (String?.none, String?.some("https://penny.example.test"), InviteLink.Invalid.invalidCode),
            ("NOTACODE!!", "https://penny.example.test", .invalidCode),
            ("A1B2C3D4E5", "penny.example.test", .invalidServer),
            ("A1B2C3D4E5", "ftp://penny.example.test", .invalidServer),
            ("A1B2C3D4E5", "https://user:secret@penny.example.test", .invalidServer),
            ("A1B2C3D4E5", "https://penny.example.test/?next=evil", .invalidServer),
            ("A1B2C3D4E5", "http://penny.example.test", .insecureServer),
        ])
    func malformed(code: String?, server: String?, expected: InviteLink.Invalid) {
        #expect(throws: expected) {
            try InviteLink(code: code, server: server, allowsLoopbackHTTP: true)
        }
    }

    @Test("whenTheServerIsPlainHTTPLoopback_InviteLink_ShouldBeAllowedOnlyInDevelopment")
    func loopback() throws {
        for host in ["http://localhost:3001", "http://127.0.0.1:5080", "http://[::1]:3001"] {
            #expect(throws: InviteLink.Invalid.insecureServer) {
                try InviteLink(code: "A1B2C3D4E5", server: host, allowsLoopbackHTTP: false)
            }
            #expect(try InviteLink(code: "A1B2C3D4E5", server: host, allowsLoopbackHTTP: true).server != nil)
        }
    }

    @Test("whenAQueryKeyRepeats_DeepLink_ShouldMakeTheJoinLinkMalformed")
    func repeatedKeys() throws {
        let url = try #require(URL(string: "penny://join?code=A1B2C3D4E5&server=https://a.test&server=https://b.test"))
        #expect(DeepLink(url: url) == .join(code: nil, server: nil))
        #expect(throws: InviteLink.Invalid.invalidCode) {
            try InviteLink(code: nil, server: nil, allowsLoopbackHTTP: false)
        }
    }

    @Test("whenScanned_InviteLink_ShouldAcceptAJoinLinkOrABareCodeAndNothingElse")
    func scanned() throws {
        let link = try InviteLink(
            scanned: "penny://join?code=a1b2c3d4e5&server=https%3A%2F%2Fpenny.example.test", allowsLoopbackHTTP: false)
        #expect(link.code.value == "A1B2C3D4E5")
        #expect(link.server == (try Self.server("https://penny.example.test")))
        #expect(try InviteLink(scanned: " A1B2C 3D4E5\n", allowsLoopbackHTTP: false).server == nil)
        #expect(throws: InviteLink.Invalid.invalidCode) {
            try InviteLink(scanned: "https://example.test/join?code=A1B2C3D4E5", allowsLoopbackHTTP: false)
        }
        #expect(throws: InviteLink.Invalid.invalidCode) {
            try InviteLink(scanned: "penny:///households", allowsLoopbackHTTP: false)
        }
        #expect(throws: InviteLink.Invalid.invalidCode) { try InviteLink(scanned: "hello", allowsLoopbackHTTP: false) }
    }

    @Test("whenAJoinLinkOpens_ShellRoute_ShouldShowSharedWithTheJoinSheet")
    func shellRoute() {
        var route = ShellRoute(tab: .home)
        route.openSettings(.appearance)
        route.open(.join(code: "A1B2C3D4E5", server: "https://penny.example.test"))
        #expect(route.tab == .shared)
        #expect(route.path(for: .shared).isEmpty)
        #expect(!route.isSettingsPresented)
        do {
            let presented = route.presentPendingHouseholdStart()
            #expect(presented)
        }
        #expect(route.householdStart == .join(code: "A1B2C3D4E5", server: "https://penny.example.test"))
        // Another destination or sheet replaces it, so two sheets never compete.
        route.openAddEntry()
        #expect(route.householdStart == nil)
        route.householdStart = .create
        route.open(.household(id: "h1"))
        #expect(route.householdStart == nil)
        #expect(route.path(for: .shared) == [.household(id: "h1")])
    }
}

@Suite("Shared splits (MAZ-75 preview of HouseholdSplits)")
struct HouseholdSplitTests {
    @Test("whenGivenTheGoldenCases_HouseholdSplit_ShouldMatchTheServer")
    func golden() throws {
        let fixture = try Fixtures.decode(SharedSplitsFixture.self, from: "shared-splits.json")
        #expect(fixture.cases.count >= 20)
        for testCase in fixture.cases {
            let result: [SharedShare]?
            switch testCase.input.mode {
            case "equal":
                result = try? HouseholdSplit.equal(
                    total: testCase.totalCents, memberIds: testCase.input.memberIds ?? [])
            case "exact":
                let allocations = testCase.input.allocations ?? []
                // Duplicates can't be expressed as a dictionary: they are refused like the server does.
                guard Set(allocations.map(\.userId)).count == allocations.count else {
                    #expect(testCase.error == true, "\(testCase.name)")
                    continue
                }
                result = try? HouseholdSplit.exact(
                    total: testCase.totalCents,
                    amounts: Dictionary(uniqueKeysWithValues: allocations.map { ($0.userId, $0.amountCents ?? -1) }))
            default:
                let allocations = testCase.input.allocations ?? []
                guard Set(allocations.map(\.userId)).count == allocations.count else {
                    #expect(testCase.error == true, "\(testCase.name)")
                    continue
                }
                result = try? HouseholdSplit.percent(
                    total: testCase.totalCents,
                    basisPoints: Dictionary(
                        uniqueKeysWithValues: allocations.map { ($0.userId, $0.percentBasisPoints ?? -1) }))
            }
            if testCase.error == true {
                #expect(result == nil, "\(testCase.name) should be refused")
            } else {
                let expected = (testCase.expected ?? []).map {
                    SharedShare(userId: $0.userId, amountCents: $0.amountCents)
                }
                #expect(result == expected, "\(testCase.name)")
            }
        }
    }

    @Test("whenSplitting_HouseholdSplit_ShouldAlwaysAddUpToTheTotal")
    func addsUp() throws {
        for total: Int64 in [1, 2, 99, 100, 101, 9_999, 10_001, 333_333, HouseholdSplit.maxTotal] {
            let equal = try HouseholdSplit.equal(total: total, memberIds: ["c", "a", "b"])
            #expect(equal.map(\.amountCents).reduce(0, +) == total)
            let percent = try HouseholdSplit.percent(total: total, basisPoints: ["a": 3333, "b": 3333, "c": 3334])
            #expect(percent.map(\.amountCents).reduce(0, +) == total)
        }
    }

    @Test(
        "whenTypingAPercentage_HouseholdSplit_ShouldReadBasisPoints",
        arguments: [
            ("33.33", Int64?.some(3333)), ("50", 5000), ("12,5", 1250), (" 25% ", 2500), ("100", 10_000),
            ("0", 0), ("100.01", nil), ("-5", nil), ("1.234", nil), ("", nil), ("abc", nil),
        ])
    func percentages(input: String, expected: Int64?) {
        #expect(HouseholdSplit.basisPoints(input) == expected)
    }

    @Test("whenShowingBasisPoints_HouseholdSplit_ShouldWriteThemBackAsTyped")
    func percentText() {
        #expect(HouseholdSplit.percentText(3333) == "33.33")
        #expect(HouseholdSplit.percentText(5000) == "50")
        #expect(HouseholdSplit.percentText(1250) == "12.5")
        #expect(HouseholdSplit.percentText(5) == "0.05")
        for points: Int64 in [0, 1, 9, 10, 99, 101, 3333, 10_000] {
            #expect(HouseholdSplit.basisPoints(HouseholdSplit.percentText(points)) == points)
        }
    }

    @Test("whenTheMonthEndsInUTC_SettlementCalendar_ShouldOpenMonthlyPayments")
    func monthEnd() throws {
        let september = try #require(MonthKey(year: 2026, month: 9))
        #expect(!SettlementCalendar.monthlyPaymentsOpen(september, todayUTC: try #require(CalendarDate("2026-09-29"))))
        #expect(SettlementCalendar.monthlyPaymentsOpen(september, todayUTC: try #require(CalendarDate("2026-09-30"))))
        #expect(SettlementCalendar.monthlyPaymentsOpen(september, todayUTC: try #require(CalendarDate("2026-11-02"))))
        let leap = try #require(MonthKey(year: 2028, month: 2))
        #expect(!SettlementCalendar.monthlyPaymentsOpen(leap, todayUTC: try #require(CalendarDate("2028-02-28"))))
        #expect(SettlementCalendar.monthlyPaymentsOpen(leap, todayUTC: try #require(CalendarDate("2028-02-29"))))
    }

    @Test("whenConvertingAnOffset_SettlementCalendar_ShouldUseTheJavaScriptSignAndClamp")
    func offsets() {
        #expect(SettlementCalendar.timezoneOffsetMinutes(secondsFromGMT: -5 * 3600) == 300)
        #expect(SettlementCalendar.timezoneOffsetMinutes(secondsFromGMT: 3600) == -60)
        #expect(SettlementCalendar.timezoneOffsetMinutes(secondsFromGMT: 14 * 3600) == -840)
        #expect(SettlementCalendar.timezoneOffsetMinutes(secondsFromGMT: -13 * 3600) == 720)
    }
}

@Suite("Join links over other screens (MAZ-75 review)")
struct JoinRouteTests {
    @Test("whenAJoinLinkOpens_ShellRoute_ShouldWaitToPresentTheSheetUntilNothingElseIsUp")
    func pending() {
        var route = ShellRoute(tab: .home)
        route.openSettings(.currency)
        route.open(.join(code: "A1B2C3D4E5", server: nil))
        #expect(!route.isSettingsPresented)
        #expect(route.tab == .shared)
        #expect(route.householdStart == nil, "not in the same update that closes Settings")
        #expect(route.pendingHouseholdStart == .join(code: "A1B2C3D4E5", server: nil))
        do {
            let presented = route.presentPendingHouseholdStart()
            #expect(presented)
        }
        #expect(route.householdStart == .join(code: "A1B2C3D4E5", server: nil))
        #expect(route.pendingHouseholdStart == nil)
    }

    @Test("whenAnotherSheetIsUp_ShellRoute_ShouldKeepTheJoinSheetWaiting")
    func blocked() {
        var route = ShellRoute(tab: .home)
        route.open(.join(code: "A1B2C3D4E5", server: nil))
        route.isAddEntryPresented = true
        do {
            let presented = route.presentPendingHouseholdStart()
            #expect(!presented)
        }
        route.isAddEntryPresented = false
        route.isSettingsPresented = true
        do {
            let presented = route.presentPendingHouseholdStart()
            #expect(!presented, "the iPhone Settings sheet is up")
        }
        route.settingsIsColumn = true
        do {
            let presented = route.presentPendingHouseholdStart()
            #expect(presented, "the iPad Settings column isn't a sheet")
        }
    }

    @Test("whenAnotherDestinationOpens_ShellRoute_ShouldDropAWaitingJoinSheet")
    func replaced() {
        var route = ShellRoute(tab: .home)
        route.open(.join(code: "A1B2C3D4E5", server: nil))
        route.open(.trips)
        #expect(route.pendingHouseholdStart == nil)
        do {
            let presented = route.presentPendingHouseholdStart()
            #expect(!presented)
        }
    }
}
