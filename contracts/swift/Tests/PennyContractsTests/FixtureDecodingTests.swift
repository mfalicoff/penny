import Foundation
import XCTest
@testable import PennyContracts

/// MAZ-62: every Swift-consumed fixture decodes strictly into typed models and matches
/// its manifest hash. Behavior assertions join as the rules are ported (MAZ-70 onward).
final class FixtureDecodingTests: XCTestCase {
    func testManifestHashesMatchEveryFixture() throws {
        let manifest = try Fixtures.decode(FixtureManifest.self, from: "manifest.json")
        XCTAssertGreaterThan(manifest.fixtures.count, 10)
        for entry in manifest.fixtures {
            XCTAssertEqual(try Fixtures.sha256(entry.file), entry.sha256, entry.file)
            XCTAssertEqual(Set(entry.consumers.keys), ["csharp", "swift", "typescript"], entry.file)
        }
    }

    func testSha256MatchesKnownVectors() {
        XCTAssertEqual(SHA256.hex([]), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
        XCTAssertEqual(SHA256.hex(Array("abc".utf8)), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        XCTAssertEqual(
            SHA256.hex(Array(String(repeating: "a", count: 1000).utf8)),
            "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3"
        )
    }

    func testGoldenFixturesDecodeStrictly() throws {
        let money = try Fixtures.decode(MoneyFixture.self, from: "money.json")
        XCTAssertTrue(money.parse.allSatisfy { ($0.cents == nil) != ($0.error == nil) })
        XCTAssertEqual(money.parse.compactMap(\.cents).max(), 99_999_999_999)
        let recurrence = try Fixtures.decode(RecurrenceFixture.self, from: "recurrence.json")
        XCTAssertTrue(recurrence.sequences.allSatisfy { $0.dates.first == $0.start && $0.dates.count == 13 })
        let merge = try Fixtures.decode(MergeFixture.self, from: "merge-conflicts.json")
        XCTAssertTrue(merge.cases.allSatisfy { $0.expected.version == 4 })
        let upgrades = try Fixtures.decode([LedgerUpgradeCase].self, from: "ledger-upgrades.json")
        XCTAssertTrue(upgrades.allSatisfy { $0.expected.version == 4 && $0.expected.accounts != nil })
        let splits = try Fixtures.decode(SharedSplitsFixture.self, from: "shared-splits.json")
        for item in splits.cases where item.error != true {
            XCTAssertEqual(item.expected?.reduce(0) { $0 + $1.amountCents }, item.totalCents, item.name)
        }
        let parity = try Fixtures.decode(ParityFixture.self, from: "parity-cases.json")
        XCTAssertFalse(parity.dates.isEmpty)
        let totals = try Fixtures.decode(MonthTotalsFixture.self, from: "month-totals.json")
        XCTAssertTrue(totals.cases.allSatisfy { totals.ledgers[$0.ledger] != nil })
        XCTAssertTrue(totals.cases.contains { $0.clock != nil } && totals.cases.contains { $0.today == nil })
    }

    func testScenarioFixturesDecodeStrictlyAndAgree() throws {
        let seeds = try Fixtures.decode(SeedFixture.self, from: "full-stack-seeds.json")
        let states = try Fixtures.decode(RedesignStates.self, from: "redesign-states.json")
        XCTAssertEqual(states.states.count, 61)
        XCTAssertEqual(states.palettes, ["light", "dark"])
        for state in states.states {
            guard let name = state.scenario else {
                XCTAssertNotNil(state.client, state.specimen)
                continue
            }
            let scenario = try XCTUnwrap(seeds.scenarios.first { $0.name == name }, state.specimen)
            XCTAssertTrue(scenario.users.contains(state.as ?? ""), state.specimen)
        }
        let total = try XCTUnwrap(states.totals["alex-2026-10"])
        XCTAssertEqual(total.projected.expenseCents, total.recorded.expenseCents + total.scheduled.reduce(0) { $0 + $1.shareCents })
        // MAZ-136: dana's income after today is expected; projected adds it and the scheduled pay.
        let future = try XCTUnwrap(states.totals["dana-2026-10"])
        XCTAssertFalse(future.expected.isEmpty)
        XCTAssertTrue(future.expected.allSatisfy { $0.date > future.today })
        XCTAssertEqual(
            future.projected.incomeCents,
            future.recorded.incomeCents + (future.expected.map(\.shareCents) + future.scheduled.map(\.shareCents)).reduce(0, +))
        XCTAssertNotNil(seeds.scenarios.first { $0.name == "future-income" })
    }

    func testUnknownMemberIsRejected() throws {
        struct Point: Codable { var x: Int }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        try Data(#"{"x":1,"y":2}"#.utf8).write(to: directory.appendingPathComponent("point.json"))
        setenv("PENNY_CONTRACT_FIXTURES", directory.path, 1)
        defer { unsetenv("PENNY_CONTRACT_FIXTURES") }
        XCTAssertThrowsError(try Fixtures.decode(Point.self, from: "point.json"))
    }
}
