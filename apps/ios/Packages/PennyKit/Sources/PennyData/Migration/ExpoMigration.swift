import CryptoKit
public import Foundation
import PennyDomain
import os

/// What the importer has done so far, kept durably beside the ledgers so a relaunch, a crash
/// or an interrupted import resumes where it stopped and never applies the same Expo record
/// twice. It holds fingerprints and flags only: no tokens and no ledger contents.
public struct ExpoMigrationJournal: Codable, Equatable, Sendable {
    public struct LedgerRecord: Codable, Equatable, Sendable {
        public var server: String
        public var email: String
        /// SHA-256 of the Expo record as stored, so a record the Expo app changed afterwards
        /// (after a rollback) is imported again, and an unchanged one never is.
        public var fingerprint: String
        public var importedAt: Date
        /// The Expo record was removed after the native ledger synced.
        public var retired: Bool
    }

    public var format = 1
    /// By AsyncStorage key.
    public var ledgers: [String: LedgerRecord] = [:]
    /// The Expo theme value last applied.
    public var theme: String?
    /// The Expo lock setting was read and, when on, saved as the native setting.
    public var lockSettled = false
    /// The Expo server choice was handled (imported, or the native app already had one).
    public var serverSettled = false
    /// Servers whose Expo session was handled (imported, refused or absent). A session the
    /// person later signed out of natively is never imported again.
    public var sessions: [String] = []
    /// Any Expo data was ever found on this device.
    public var foundExpoData = false
    /// Every Expo record was imported, synced and removed.
    public var finishedAt: Date?

    public init() {}
}

/// The outcome of one import pass, for diagnostics (docs/ios-expo-migration.md). It never
/// contains a token or ledger contents.
public struct ExpoMigrationReport: Equatable, Sendable {
    public enum Status: Equatable, Sendable {
        /// No Expo data on this device: a fresh install.
        case nothingToImport
        /// Imported. The Expo data stays on the device until each account has synced.
        case waitingForSync
        /// Every imported account synced and the Expo data was removed.
        case finished
        /// A store could not be opened now (the device has not been unlocked, or the
        /// Keychain refused). Nothing was lost; the next launch tries again.
        case retryLater
        /// Some Expo data could not be imported. It is kept on the device, untouched.
        case needsAttention
    }

    public enum LedgerOutcome: Equatable, Sendable {
        /// Copied into a new native ledger, with this many changes waiting to sync.
        case imported(pendingChanges: Int)
        /// Merged onto a native ledger that already existed.
        case merged(pendingChanges: Int)
        /// The native ledger already held it (a repeated launch or an interrupted import).
        case alreadyImported
        /// Imported earlier; the Expo record is kept until the account syncs.
        case waitingForSync
        /// Synced; the Expo record was removed.
        case retired
        /// The Expo record is damaged or a ledger version this build cannot read. Kept.
        case unreadable
        /// The record's server cannot be worked out (no saved server choice). Kept.
        case unknownServer
        /// The native ledger for this account cannot be read or written now. Kept; retried.
        case blocked(LedgerStoreError)
    }

    public struct Account: Equatable, Sendable {
        /// The AsyncStorage key of the Expo record.
        public var key: String
        public var server: String?
        public var email: String
        public var outcome: LedgerOutcome

        public init(key: String, server: String?, email: String, outcome: LedgerOutcome) {
            self.key = key
            self.server = server
            self.email = email
            self.outcome = outcome
        }
    }

    public enum Note: Equatable, Sendable {
        /// AsyncStorage could not be opened now.
        case storeUnavailable
        /// AsyncStorage's manifest is damaged. Kept.
        case storeCorrupt
        /// The import journal was unreadable and started again.
        case journalReset
        /// The import journal could not be saved; the next launch repeats the safe steps.
        case journalWriteFailed
        /// The Expo lock was on (or unreadable) and is now the native setting.
        case lockImported
        /// The Expo lock setting could not be read or saved; the app stays locked until it can.
        case lockUndetermined
        case themeImported(AppearancePreference)
        case serverImported(String)
        /// The Expo server choice is damaged; the person chooses a server again.
        case serverUnreadable
        case sessionImported(server: String)
        /// An Expo session could not be carried over; the person signs in again. Their data
        /// is kept and reappears when they do.
        case sessionNeedsSignIn(server: String)
        /// Removing Expo data after sync failed; the next launch tries again.
        case cleanupFailed
    }

    public var status: Status
    public var accounts: [Account] = []
    public var notes: [Note] = []

    public init(status: Status, accounts: [Account] = [], notes: [Note] = []) {
        self.status = status
        self.accounts = accounts
        self.notes = notes
    }

    /// One line per fact, for logs and support. Emails are left out.
    public var lines: [String] {
        var lines = ["Expo import: \(status)"]
        for (index, account) in accounts.enumerated() {
            lines.append("account \(index + 1) on \(account.server ?? "unknown server"): \(account.outcome)")
        }
        lines += notes.map { "note: \($0)" }
        return lines
    }
}

/// Imports the Expo app's data into the native stores, in place, once (MAZ-72):
///
/// - the biometric lock setting first, so the first native launch is locked when the Expo app
///   was (an unreadable setting counts as on, and a setting that cannot be read yet keeps
///   the app concealed through `ExpoImportingLockStore`);
/// - the appearance (`AppearancePreference(legacy:)`) and the chosen server;
/// - every account's `{base, local}` ledger, under every server namespace, into
///   `LedgerFileStore`, keeping unsynced changes as pending changes;
/// - each server's session, when its email is known, into the native Keychain store.
///
/// It never overwrites native data: an existing native ledger gets the Expo pending changes
/// merged onto it, an existing server choice or session wins. The Expo data stays where it
/// is until the imported account has synced; only then is it removed. Damaged Expo data is
/// never removed. Every step is safe to repeat, so a crash or an unavailable store simply
/// resumes at the next launch. See docs/ios-expo-migration.md.
public struct ExpoMigration: Sendable {
    let asyncStorage: ExpoAsyncStorage
    let secureStore: ExpoSecureStore
    let sessions: any SessionStore
    let authPreferences: any AuthPreferences
    let devicePreferences: any DevicePreferences
    let lockStore: any AppLockSettingStore
    let ledgers: LedgerFileStore
    let journalURL: URL
    let fileSystem: any LedgerFileSystem
    let now: @Sendable () -> Date

    static let logger = Logger(subsystem: AppIdentity.bundleIdentifier, category: "ExpoMigration")

    public init(
        asyncStorage: ExpoAsyncStorage, secureStore: ExpoSecureStore, sessions: any SessionStore,
        authPreferences: any AuthPreferences, devicePreferences: any DevicePreferences,
        lockStore: any AppLockSettingStore, ledgers: LedgerFileStore, journalURL: URL,
        fileSystem: any LedgerFileSystem = DurableFileSystem(), now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.asyncStorage = asyncStorage
        self.secureStore = secureStore
        self.sessions = sessions
        self.authPreferences = authPreferences
        self.devicePreferences = devicePreferences
        self.lockStore = lockStore
        self.ledgers = ledgers
        self.journalURL = journalURL
        self.fileSystem = fileSystem
        self.now = now
    }

    /// The importer on the app's real stores: the ones `AppServices.live()`, `AuthController`
    /// and `OfflineLedgerStore.standard()` use.
    public static func live(lockStore: any AppLockSettingStore = KeychainAppLockSettingStore()) -> ExpoMigration {
        ExpoMigration(
            asyncStorage: .standard(), secureStore: ExpoSecureStore(), sessions: KeychainSessionStore(),
            authPreferences: UserDefaultsAuthPreferences(), devicePreferences: UserDefaultsDevicePreferences(),
            lockStore: lockStore, ledgers: LedgerFileStore(directory: LedgerFileStore.defaultDirectory),
            journalURL: defaultJournalURL)
    }

    /// `Application Support/Penny/Migration/expo-import.json`.
    public static var defaultJournalURL: URL {
        URL.applicationSupportDirectory.appending(path: "Penny/Migration/expo-import.json")
    }

    // MARK: Journal

    func loadJournal() -> (ExpoMigrationJournal, reset: Bool) {
        guard let data = try? fileSystem.read(journalURL) else { return (ExpoMigrationJournal(), false) }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let journal = try? decoder.decode(ExpoMigrationJournal.self, from: data), journal.format == 1 else {
            return (ExpoMigrationJournal(), true)
        }
        return (journal, false)
    }

    func saveJournal(_ journal: ExpoMigrationJournal) -> Bool {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        guard let data = try? encoder.encode(journal) else { return false }
        return (try? fileSystem.write(data, to: journalURL)) != nil
    }

    /// The journal as saved, for diagnostics and tests.
    public func journal() -> ExpoMigrationJournal { loadJournal().0 }

    // MARK: Lock

    /// Applies the Expo lock setting if that has not happened yet. Throws (so the lock
    /// controller stays concealed) while the Expo setting cannot be read or the native one
    /// cannot be saved. `ExpoImportingLockStore` calls this before every read.
    public func importLock() throws(AppLockStoreError) {
        var (journal, _) = loadJournal()
        guard !journal.lockSettled else { return }
        _ = try importLock(into: &journal)
        _ = saveJournal(journal)
    }

    /// Returns whether the lock was turned on.
    private func importLock(into journal: inout ExpoMigrationJournal) throws(AppLockStoreError) -> Bool {
        guard !journal.lockSettled else { return false }
        let value: String?
        do {
            value = try secureStore.string(forKey: ExpoLegacyFormat.lockKey)
        } catch .corrupt {
            value = "unreadable"
        } catch {
            throw .unavailable
        }
        if value != nil { journal.foundExpoData = true }
        // The Expo app stayed locked on anything but "false" (or no setting); so does this one.
        let enabled = value != nil && value != "false"
        if enabled { try lockStore.write(true) }
        journal.lockSettled = true
        return enabled
    }

    // MARK: Run

    /// One import pass. Synchronous and local (no network): call it at launch before the lock,
    /// the sign-in state and the offline store read their settings.
    @discardableResult
    public func run() -> ExpoMigrationReport {
        var (journal, reset) = loadJournal()
        var report = ExpoMigrationReport(status: .nothingToImport)
        if reset { report.notes.append(.journalReset) }

        // Once finished, only Expo data written again (a rollback to the Expo build and back)
        // starts another pass, and then the settled steps run again.
        let values: [String: String]?
        do {
            values = try asyncStorage.load()
        } catch .unavailable {
            values = nil
            report.notes.append(.storeUnavailable)
        } catch {
            values = nil
            report.notes.append(.storeCorrupt)
        }
        let hasPennyData = values?.keys.contains { $0.hasPrefix("penny:") } ?? false
        if journal.finishedAt != nil {
            guard hasPennyData else {
                report.status = journal.foundExpoData ? .finished : .nothingToImport
                return finish(report)
            }
            journal.finishedAt = nil
            journal.lockSettled = false
            journal.sessions = []
        }

        do {
            if try importLock(into: &journal) { report.notes.append(.lockImported) }
        } catch {
            report.notes.append(.lockUndetermined)
        }
        importTheme(into: &journal, report: &report)

        if let values {
            if !values.isEmpty { journal.foundExpoData = true }
            importStore(values, into: &journal, report: &report)
        } else if !report.notes.contains(.storeUnavailable), !report.notes.contains(.storeCorrupt) {
            // No AsyncStorage: a fresh install, or one with Keychain items an earlier
            // install left behind. Those are applied above (lock, theme) and then removed.
            if !journal.foundExpoData {
                journal.finishedAt = now()
            } else if journal.lockSettled {
                if removeSecureItems(servers: [], legacyServer: nil) {
                    journal.finishedAt = now()
                } else {
                    report.notes.append(.cleanupFailed)
                }
            }
        }

        if !saveJournal(journal) { report.notes.append(.journalWriteFailed) }
        report.status = Self.status(of: report, journal: journal)
        return finish(report)
    }

    private func finish(_ report: ExpoMigrationReport) -> ExpoMigrationReport {
        for line in report.lines { Self.logger.notice("\(line, privacy: .public)") }
        return report
    }

    static func status(of report: ExpoMigrationReport, journal: ExpoMigrationJournal) -> ExpoMigrationReport.Status {
        let attention = report.accounts.contains {
            switch $0.outcome {
            case .unreadable, .unknownServer: true
            default: false
            }
        }
        if attention || report.notes.contains(.storeCorrupt) { return .needsAttention }
        let blocked = report.accounts.contains { if case .blocked = $0.outcome { true } else { false } }
        if blocked || report.notes.contains(.storeUnavailable) || report.notes.contains(.lockUndetermined) {
            return .retryLater
        }
        if journal.finishedAt != nil { return journal.foundExpoData ? .finished : .nothingToImport }
        return .waitingForSync
    }

    private func importTheme(into journal: inout ExpoMigrationJournal, report: inout ExpoMigrationReport) {
        guard let theme = try? secureStore.string(forKey: ExpoLegacyFormat.themeKey) else { return }
        journal.foundExpoData = true
        guard theme != journal.theme else { return }
        let appearance = AppearancePreference(legacy: theme)
        devicePreferences.setAppearance(appearance)
        journal.theme = theme
        report.notes.append(.themeImported(appearance))
    }

    // MARK: AsyncStorage

    private func importStore(
        _ values: [String: String], into journal: inout ExpoMigrationJournal, report: inout ExpoMigrationReport
    ) {
        let connection = values[ExpoLegacyFormat.serverConnectionKey].flatMap(ExpoLegacyFormat.serverConnection)
        if values[ExpoLegacyFormat.serverConnectionKey] != nil, connection == nil {
            report.notes.append(.serverUnreadable)
        }
        if let connection, !journal.serverSettled {
            if let server = try? ServerURL(connection.url) {
                if authPreferences.savedServer() == nil {
                    try? authPreferences.setSavedServer(SavedServer(server: server, version: connection.version))
                    report.notes.append(.serverImported(server.description))
                }
            } else {
                report.notes.append(.serverUnreadable)
            }
            journal.serverSettled = true
        }
        let legacyServer = connection?.legacyUrl

        var servers = Set([connection?.url, connection?.legacyUrl].compactMap { $0 })
        for key in values.keys {
            if let server = ExpoLegacyFormat.split(key).server { servers.insert(server) }
        }

        for key in values.keys.sorted() where key.hasPrefix(ExpoLegacyFormat.ledgerPrefix) {
            guard let text = values[key] else { continue }
            report.accounts.append(importLedger(key: key, text: text, legacyServer: legacyServer, into: &journal))
            if !saveJournal(journal), !report.notes.contains(.journalWriteFailed) {
                report.notes.append(.journalWriteFailed)
            }
        }
        if let legacyServer {
            importSessions(values, servers: servers, legacyServer: legacyServer, into: &journal, report: &report)
        }
        retire(values, servers: servers, legacyServer: legacyServer, into: &journal, report: &report)
    }

    private func scope(ledgerKey key: String, legacyServer: String?) -> AccountScope? {
        let (name, scoped) = ExpoLegacyFormat.split(key)
        let email = String(name.dropFirst(ExpoLegacyFormat.ledgerPrefix.count))
        guard !email.isEmpty, let text = scoped ?? legacyServer, let server = try? ServerURL(text) else { return nil }
        return AccountScope(server: server, email: email.lowercased())
    }

    private static func fingerprint(_ text: String) -> String {
        SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    private func importLedger(
        key: String, text: String, legacyServer: String?, into journal: inout ExpoMigrationJournal
    ) -> ExpoMigrationReport.Account {
        let (name, scoped) = ExpoLegacyFormat.split(key)
        let email = String(name.dropFirst(ExpoLegacyFormat.ledgerPrefix.count))
        guard let scope = scope(ledgerKey: key, legacyServer: legacyServer) else {
            return .init(key: key, server: scoped ?? legacyServer, email: email, outcome: .unknownServer)
        }
        func account(_ outcome: ExpoMigrationReport.LedgerOutcome) -> ExpoMigrationReport.Account {
            .init(key: key, server: scope.server.description, email: scope.email, outcome: outcome)
        }
        let fingerprint = Self.fingerprint(text)
        if let record = journal.ledgers[key], record.fingerprint == fingerprint {
            return account(record.retired ? .retired : .waitingForSync)
        }
        guard let legacy = ExpoLegacyFormat.ledger(text) else { return account(.unreadable) }

        let pending = PendingChanges(base: legacy.base, local: legacy.local).count
        let outcome: ExpoMigrationReport.LedgerOutcome
        do {
            if let existing = try ledgers.load(scope) {
                if existing.base == legacy.base && existing.local == legacy.local || pending == 0 {
                    // Already imported (an interrupted pass), or nothing unsynced to add to a
                    // native ledger that is at least as new.
                    outcome = .alreadyImported
                } else {
                    var next = existing
                    next.local = LedgerMerge.merge(base: legacy.base, local: legacy.local, remote: existing.local)
                    try ledgers.save(next, for: scope)
                    outcome = .merged(pendingChanges: pending)
                }
            } else {
                // The Expo app kept no revision. The engine always reads the server before it
                // writes, so revision 0 only means "merge onto whatever the server has".
                try ledgers.save(
                    LocalLedgerSnapshot(base: legacy.base, local: legacy.local, baseRevision: 0, lastSyncedAt: nil),
                    for: scope)
                outcome = .imported(pendingChanges: pending)
            }
        } catch {
            return account(.blocked(error))
        }
        journal.ledgers[key] = .init(
            server: scope.server.description, email: scope.email, fingerprint: fingerprint, importedAt: now(),
            retired: false)
        return account(outcome)
    }

    private func importSessions(
        _ values: [String: String], servers: Set<String>, legacyServer: String,
        into journal: inout ExpoMigrationJournal,
        report: inout ExpoMigrationReport
    ) {
        for text in servers.sorted() where !journal.sessions.contains(text) {
            guard let server = try? ServerURL(text) else { continue }
            let key = ExpoLegacyFormat.storageKey(ExpoLegacyFormat.sessionKey, server: text, legacyServer: legacyServer)
            let token: String?
            do {
                token = try secureStore.string(forKey: key)
            } catch .unavailable {
                if !report.notes.contains(.storeUnavailable) { report.notes.append(.storeUnavailable) }
                continue
            } catch {
                token = nil
                report.notes.append(.sessionNeedsSignIn(server: server.description))
            }
            guard let token else {
                journal.sessions.append(text)
                continue
            }
            let emailKey = ExpoLegacyFormat.storageKey(
                ExpoLegacyFormat.activeAccountKey, server: text, legacyServer: legacyServer)
            guard let email = values[emailKey],
                let session = try? ServerSession(server: server, email: email, token: token)
            else {
                // The Expo app had forgotten the account (its session had expired) or the token
                // is not one the server issues: sign in again.
                report.notes.append(.sessionNeedsSignIn(server: server.description))
                journal.sessions.append(text)
                continue
            }
            do {
                if try sessions.load(server: server) == nil {
                    // The native app deletes leftover sessions on its first launch; do that
                    // now, so the imported one is not deleted with them.
                    if !authPreferences.hasLaunchedBefore {
                        try sessions.deleteAll()
                        authPreferences.markLaunched()
                    }
                    try sessions.save(session)
                    report.notes.append(.sessionImported(server: server.description))
                }
                journal.sessions.append(text)
            } catch .unavailable {
                if !report.notes.contains(.storeUnavailable) { report.notes.append(.storeUnavailable) }
            } catch {
                report.notes.append(.sessionNeedsSignIn(server: server.description))
                journal.sessions.append(text)
            }
        }
    }

    // MARK: Retirement

    /// Removes each imported Expo ledger once the native one has synced after the import
    /// with nothing pending (or was removed by a sign-out the person agreed to). When every
    /// Expo ledger is gone, removes the rest of the Expo data Penny wrote.
    private func retire(
        _ values: [String: String], servers: Set<String>, legacyServer: String?,
        into journal: inout ExpoMigrationJournal, report: inout ExpoMigrationReport
    ) {
        var removable: Set<String> = []
        for (key, record) in journal.ledgers where !record.retired {
            guard let text = values[key] else {
                journal.ledgers[key]?.retired = true
                continue
            }
            guard Self.fingerprint(text) == record.fingerprint, let server = try? ServerURL(record.server) else {
                continue
            }
            let scope = AccountScope(server: server, email: record.email)
            switch Result(catching: { () throws(LedgerStoreError) in try ledgers.load(scope) }) {
            case .success(let snapshot?):
                if !snapshot.hasPendingChanges, let synced = snapshot.lastSyncedAt, synced >= record.importedAt {
                    removable.insert(key)
                }
            case .success(nil):
                // Imported, then removed by a sign-out after it synced or the person agreed
                // to discard it.
                removable.insert(key)
            case .failure:
                continue
            }
        }
        if !removable.isEmpty {
            do {
                try asyncStorage.remove(removable)
                for key in removable { journal.ledgers[key]?.retired = true }
                for index in report.accounts.indices where removable.contains(report.accounts[index].key) {
                    report.accounts[index].outcome = .retired
                }
            } catch {
                report.notes.append(.cleanupFailed)
                return
            }
        }

        let remaining = values.keys.filter {
            $0.hasPrefix(ExpoLegacyFormat.ledgerPrefix) && journal.ledgers[$0]?.retired != true
        }
        // Everything else goes only after every ledger, the lock and every session were
        // handled, so nothing an unavailable Keychain hid this time is deleted unread.
        let handled = servers.allSatisfy { (try? ServerURL($0)) == nil || journal.sessions.contains($0) }
        guard remaining.isEmpty, let legacyServer, journal.lockSettled, handled else { return }
        let others = Set(
            values.keys.filter {
                $0 == ExpoLegacyFormat.serverConnectionKey
                    || ExpoLegacyFormat.split($0).name == ExpoLegacyFormat.activeAccountKey
            })
        do {
            try asyncStorage.remove(others)
        } catch {
            report.notes.append(.cleanupFailed)
            return
        }
        guard removeSecureItems(servers: servers, legacyServer: legacyServer) else {
            report.notes.append(.cleanupFailed)
            return
        }
        journal.finishedAt = now()
    }

    /// Removes the Expo Keychain items Penny wrote: the theme, the lock and each server's
    /// session. Returns false when any could not be removed.
    private func removeSecureItems(servers: Set<String>, legacyServer: String?) -> Bool {
        var keys = [ExpoLegacyFormat.themeKey, ExpoLegacyFormat.lockKey, ExpoLegacyFormat.sessionKey]
        if let legacyServer {
            keys += servers.map {
                ExpoLegacyFormat.storageKey(ExpoLegacyFormat.sessionKey, server: $0, legacyServer: legacyServer)
            }
        }
        var removed = true
        for key in Set(keys) where (try? secureStore.remove(key)) == nil { removed = false }
        return removed
    }
}

/// The native lock setting, after the Expo one has been applied: until it has, reading fails
/// (the lock controller stays concealed with Try again), so the first native launch can never
/// open an app the Expo build kept locked.
public struct ExpoImportingLockStore: AppLockSettingStore {
    private let native: any AppLockSettingStore
    private let migration: ExpoMigration

    /// `migration` must write to `native` (`ExpoMigration.live(lockStore: native)`).
    public init(native: any AppLockSettingStore, migration: ExpoMigration) {
        self.native = native
        self.migration = migration
    }

    public func read() throws(AppLockStoreError) -> Bool {
        try migration.importLock()
        return try native.read()
    }

    public func write(_ enabled: Bool) throws(AppLockStoreError) {
        try native.write(enabled)
    }
}
