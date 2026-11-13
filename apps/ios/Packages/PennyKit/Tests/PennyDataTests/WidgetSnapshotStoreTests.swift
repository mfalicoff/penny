import Foundation
import PennyData
import PennyDomain
import Testing

@Suite("Widget snapshot store: the App Group file")
struct WidgetSnapshotStoreTests {
    static let snapshot = WidgetSnapshot(
        month: "2026-11", currency: "CAD", generatedAt: Date(timeIntervalSince1970: 1_794_000_000), income: 320_000,
        spent: 148_335, invested: 60_000, leftToSpend: 111_665, projectedRemaining: 96_665,
        recentExpenses: [.init(title: "Groceries", cents: 4890, date: "2026-11-09", shared: true)],
        waitingToSync: false)

    static func scope(_ email: String) throws -> AccountScope {
        AccountScope(server: try ServerURL("https://penny.example.test"), email: email)
    }

    /// A store in a new temporary directory, removed by the caller.
    static func temporaryStore() -> (WidgetSnapshotStore, URL) {
        let root = FileManager.default.temporaryDirectory.appending(path: "widget-store-\(UUID().uuidString)")
        return (WidgetSnapshotStore(root: root), root)
    }

    @Test("whenNothingWritten_WidgetSnapshotStore_ShouldReadSignedOut")
    func empty() {
        let (store, root) = Self.temporaryStore()
        defer { try? FileManager.default.removeItem(at: root) }
        #expect(store.read() == .signedOut)
        #expect(store.storedOwner() == nil)
        #expect(!store.clear())
    }

    @Test("whenWritten_WidgetSnapshotStore_ShouldReadTheSameSnapshotAndOwner")
    func roundTrip() throws {
        let (store, root) = Self.temporaryStore()
        defer { try? FileManager.default.removeItem(at: root) }
        let owner = WidgetSnapshotStore.owner(try Self.scope("alex@example.test"))
        try store.write(Self.snapshot, owner: owner)
        #expect(store.read() == .snapshot(Self.snapshot))
        #expect(store.storedOwner() == owner)
        #expect(store.snapshot(for: owner) == Self.snapshot)
        #expect(store.snapshot(for: "someone-else") == nil)
    }

    @Test("whenWritten_WidgetSnapshotStore_ShouldStoreOnlyTheVersionedEnvelopeAndNoAccountDetails")
    func fileContents() throws {
        let (store, root) = Self.temporaryStore()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = try Self.scope("alex@example.test")
        try store.write(Self.snapshot, owner: WidgetSnapshotStore.owner(scope))
        let data = try Data(contentsOf: store.fileURL)
        let object = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(Set(object.keys) == ["version", "owner", "snapshot"])
        #expect(object["version"] as? Int == WidgetSnapshotStore.version)
        let text = try #require(String(data: data, encoding: .utf8))
        #expect(!text.contains("alex"))
        #expect(!text.contains("example.test"))
        #expect(store.fileURL.lastPathComponent == "snapshot.json")
        #expect(store.fileURL.deletingLastPathComponent().lastPathComponent == "Widgets")
    }

    @Test("whenEmailCaseDiffers_WidgetSnapshotStoreOwner_ShouldBeTheSameAndDifferPerAccount")
    func owners() throws {
        let alex = WidgetSnapshotStore.owner(try Self.scope("alex@example.test"))
        #expect(alex == WidgetSnapshotStore.owner(try Self.scope("Alex@Example.test")))
        #expect(alex != WidgetSnapshotStore.owner(try Self.scope("sam@example.test")))
        let other = AccountScope(server: try ServerURL("https://other.example.test"), email: "alex@example.test")
        #expect(alex != WidgetSnapshotStore.owner(other))
        #expect(alex.count == 32)
    }

    @Test("whenFileIsNewerOrDamaged_WidgetSnapshotStore_ShouldReadUnreadable")
    func unreadable() throws {
        let (store, root) = Self.temporaryStore()
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: store.directory, withIntermediateDirectories: true)

        try Data(#"{"version": 2, "owner": "x", "snapshot": {"future": true}}"#.utf8).write(to: store.fileURL)
        #expect(store.read() == .unreadable)

        try Data("not json".utf8).write(to: store.fileURL)
        #expect(store.read() == .unreadable)
        #expect(store.storedOwner() == nil)

        try Data(#"{"version": 1, "owner": "x", "snapshot": {"month": "2026-11"}}"#.utf8).write(to: store.fileURL)
        #expect(store.read() == .unreadable, "missing fields are damage, never zeros")
    }

    @Test("whenAnotherAccountOwnsTheFile_WidgetSnapshotStore_ShouldClearIt")
    func clearUnlessOwned() throws {
        let (store, root) = Self.temporaryStore()
        defer { try? FileManager.default.removeItem(at: root) }
        try store.write(Self.snapshot, owner: "alex")
        #expect(!store.clear(unlessOwnedBy: "alex"))
        #expect(store.read() == .snapshot(Self.snapshot))
        #expect(store.clear(unlessOwnedBy: "sam"))
        #expect(store.read() == .signedOut)
        #expect(!store.clear(unlessOwnedBy: "sam"), "nothing left to clear")
    }

    @Test("whenCleared_WidgetSnapshotStore_ShouldRemoveTheSnapshotAndLegacyExpoKeys")
    func clearLegacy() throws {
        let suite = "penny.tests.widgets.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set(Data("layout".utf8), forKey: "__expo_widgets_BalanceChartWidget_layout")
        defaults.set(Data("timeline".utf8), forKey: "__expo_widgets_RecentExpensesWidget_timeline")
        defaults.set("kept", forKey: "unrelated")
        let root = FileManager.default.temporaryDirectory.appending(path: "widget-store-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let store = WidgetSnapshotStore(root: root, legacyDefaultsSuite: suite)
        try store.write(Self.snapshot, owner: "alex")

        #expect(store.clear())
        #expect(store.read() == .signedOut)
        #expect(defaults.object(forKey: "__expo_widgets_BalanceChartWidget_layout") == nil)
        #expect(defaults.object(forKey: "__expo_widgets_RecentExpensesWidget_timeline") == nil)
        #expect(defaults.string(forKey: "unrelated") == "kept")
    }

    @Test("whenDirectoryCannotBeCreated_WidgetSnapshotStore_ShouldThrowCouldNotWrite")
    func writeFailure() throws {
        let blocker = FileManager.default.temporaryDirectory.appending(path: "widget-blocker-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: blocker) }
        // A file where the store's root directory should be.
        try Data("x".utf8).write(to: blocker)
        let store = WidgetSnapshotStore(root: blocker)
        #expect(throws: WidgetSnapshotStore.WriteFailure.self) { try store.write(Self.snapshot, owner: "alex") }
        #expect(store.read() == .signedOut)
    }
}
