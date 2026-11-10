#if PENNY_TEST_CONTROLS
    import Foundation
    import PennyData
    import PennyDomain

    /// Expo data for in-place upgrade rehearsals (MAZ-72, used by MAZ-81's UI tests). Launching
    /// with `PENNY_TEST_EXPO_FIXTURE=upgrade` writes, in the Expo app's own formats, what an
    /// Expo install with every hard case leaves behind, and does not import it; the next
    /// launch without the variable is the first launch of the upgraded app.
    ///
    /// - Lock on, AMOLED theme, the server `serverURL` (default `http://127.0.0.1:9`, where
    ///   nothing listens, so the first native launch is offline).
    /// - `alex@example.test`, signed in, with one synced and one unsynced entry.
    /// - `sam@example.test` on a second server, with an expired session (no token).
    /// - A damaged ledger record for `damaged@example.test`, which must be kept.
    ///
    /// Fixture data only: made-up names and amounts, `.test` emails and loopback servers.
    enum ExpoUpgradeFixture {
        static let variable = "PENNY_TEST_EXPO_FIXTURE"
        static let defaultServer = "http://127.0.0.1:9"
        static let secondServer = "http://127.0.0.2:9"
        static let token = String(repeating: "5e", count: 32)

        static func stage(server: String) throws {
            let storage = ExpoAsyncStorage.standard()
            let secure = ExpoSecureStore()
            func key(_ name: String, _ on: String) -> String {
                ExpoLegacyFormat.storageKey(name, server: on, legacyServer: server)
            }
            let connection = ExpoLegacyFormat.ServerConnection(url: server, legacyUrl: server, version: "1.0.0")
            let synced = ledger([entry("fixture-lunch", "Lunch", 1_250)])
            let pending = ledger([entry("fixture-lunch", "Lunch", 1_250), entry("fixture-taxi", "Taxi", 2_400)])
            try storage.set([
                ExpoLegacyFormat.serverConnectionKey: try json(connection),
                key(ExpoLegacyFormat.activeAccountKey, server): "alex@example.test",
                key(ExpoLegacyFormat.ledgerPrefix + "alex@example.test", server): try json(
                    ExpoLegacyFormat.LocalLedger(base: WireLedger(synced), local: WireLedger(pending))),
                key(ExpoLegacyFormat.ledgerPrefix + "sam@example.test", secondServer): try json(
                    ExpoLegacyFormat.LocalLedger(base: WireLedger(synced), local: WireLedger(synced))),
                key(ExpoLegacyFormat.ledgerPrefix + "damaged@example.test", server): #"{"base":{"version":4,"#,
            ])
            try secure.set(token, forKey: key(ExpoLegacyFormat.sessionKey, server))
            try secure.set("amoled", forKey: ExpoLegacyFormat.themeKey)
            try secure.set("true", forKey: ExpoLegacyFormat.lockKey)
        }

        private static func json(_ value: some Encodable) throws -> String {
            String(decoding: try JSONEncoder().encode(value), as: UTF8.self)
        }

        private static func ledger(_ entries: [LedgerEntry]) -> Ledger { Ledger(transactions: entries) }

        private static func entry(_ id: String, _ title: String, _ cents: Int64) -> LedgerEntry {
            LedgerEntry(
                id: id, title: title, kind: .expense, total: cents, share: cents, categoryId: "food",
                date: CalendarDate("2026-11-02") ?? CalendarDate(Date()))
        }
    }
#endif
