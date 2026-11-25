import Foundation
public import Observation
import PennyDomain

/// Everything the receipt inbox screens ask the server (MAZ-184). A protocol so the models are
/// tested without a network; the app uses `APIReceiptInboxService`.
public protocol ReceiptInboxService: Sendable {
    func receiptEmail() async throws -> WireReceiptEmail
    func createReceiptEmail() async throws -> WireReceiptEmail
    func updateReceiptEmail(extend: Bool, allowedSenders: [String]?) async throws -> WireReceiptEmail
    func deleteReceiptEmail() async throws
    func receiptInbox(_ filter: ReceiptInboxFilter, before: String?) async throws -> WireReceiptInboxPage
    func discardInboxItem(id: String) async throws -> WireReceiptInboxCleanup
    func finishInboxItem(id: String) async throws -> WireReceiptInboxCleanup
}

/// The signed-in account's receipt address and inbox, straight from the API. A 401 ends the
/// session it was made with, as everywhere else.
public struct APIReceiptInboxService: ReceiptInboxService {
    private let client: APIClient
    private let sessionExpired: (@MainActor @Sendable () -> Void)?

    public init(client: APIClient, sessionExpired: (@MainActor @Sendable () -> Void)? = nil) {
        self.client = client
        self.sessionExpired = sessionExpired
    }

    private func call<Value>(_ request: () async throws -> Value) async throws -> Value {
        try await SessionExpiry.run(sessionExpired, request)
    }

    public func receiptEmail() async throws -> WireReceiptEmail { try await call { try await client.receiptEmail() } }
    public func createReceiptEmail() async throws -> WireReceiptEmail {
        try await call { try await client.createReceiptEmail() }
    }
    public func updateReceiptEmail(extend: Bool, allowedSenders: [String]?) async throws -> WireReceiptEmail {
        try await call { try await client.updateReceiptEmail(extend: extend, allowedSenders: allowedSenders) }
    }
    public func deleteReceiptEmail() async throws { try await call { try await client.deleteReceiptEmail() } }
    public func receiptInbox(_ filter: ReceiptInboxFilter, before: String?) async throws -> WireReceiptInboxPage {
        try await call { try await client.receiptInbox(filter, before: before) }
    }
    public func discardInboxItem(id: String) async throws -> WireReceiptInboxCleanup {
        try await call { try await client.discardInboxItem(id: id) }
    }
    public func finishInboxItem(id: String) async throws -> WireReceiptInboxCleanup {
        try await call { try await client.finishInboxItem(id: id) }
    }
}

/// What the receipt screens say when the server didn't do what was asked.
public enum ReceiptInboxFailure {
    public static let offline =
        "Connect to the internet to attach receipts. Your receipt inbox opens when you're back online."

    public static func message(_ error: any Error) -> String {
        guard let error = error as? APIError else { return "Something went wrong. Try again." }
        switch error {
        case .offline, .timeout, .unreachable:
            return "Penny can't reach the server. Try again when you're online."
        case .rateLimited:
            return "You've made several new addresses today. Try again tomorrow."
        case .notFound:
            return "This isn't available anymore. It may have been discarded on another device, or it expired."
        case .forbidden(let message, _), .badRequest(let message, _), .conflict(let message, _):
            return message ?? "The server refused this change. Try again."
        case .unauthorized: return "Your session ended. Sign in again."
        default: return "Penny couldn't reach your receipts. Try again."
        }
    }
}

/// The receipt address and the inbox for one signed-in account (MAZ-184): Settings › Receipt
/// email, the Receipts to attach row on Home and in Settings, the inbox list and its items. The
/// inbox and the address need a connection; offline, `isAvailable` is false and the screens
/// say to connect.
@MainActor
@Observable
public final class ReceiptInboxModel {
    public enum Load: Equatable, Sendable {
        case idle, loading, loaded
        case failed(String)
    }

    /// The server's answer to `GET /api/receipt-email`; nil before it was read.
    public private(set) var email: WireReceiptEmail?
    public private(set) var emailLoad: Load = .idle
    public private(set) var items: [ReceiptInboxFilter: [WireReceiptInboxItem]] = [:]
    public private(set) var loads: [ReceiptInboxFilter: Load] = [:]
    @ObservationIgnored private var cursors: [ReceiptInboxFilter: String] = [:]
    /// An address or inbox action is running (the screens disable their buttons).
    public private(set) var isWorking = false

    @ObservationIgnored private let service: (any ReceiptInboxService)?
    @ObservationIgnored private let available: @MainActor () -> Bool

    /// - Parameters:
    ///   - service: nil in the demo and previews (no server, nothing to show).
    ///   - available: whether online-only actions can run now (`canUseOnlineOnlyActions`).
    public init(service: (any ReceiptInboxService)?, available: @escaping @MainActor () -> Bool = { true }) {
        self.service = service
        self.available = available
    }

    public var isSupported: Bool { service != nil }
    /// Online, signed in, session not expired.
    public var isAvailable: Bool { service != nil && available() }
    /// The server takes emailed receipts.
    public var isEnabled: Bool { email?.enabled == true }
    public var address: WireReceiptEmailAddress? { email?.address }

    /// Items to attach that the list has read (the first page and any loaded after it).
    public var toAttachCount: Int { items[.toAttach]?.count ?? 0 }
    /// More items to attach exist than the list has read.
    public var hasMoreToAttach: Bool { cursors[.toAttach] != nil }

    public func list(_ filter: ReceiptInboxFilter) -> [WireReceiptInboxItem] { items[filter] ?? [] }
    public func load(_ filter: ReceiptInboxFilter) -> Load { loads[filter] ?? .idle }
    public func hasMore(_ filter: ReceiptInboxFilter) -> Bool { cursors[filter] != nil }

    public func item(id: String) -> WireReceiptInboxItem? {
        for filter in ReceiptInboxFilter.allCases {
            if let item = items[filter]?.first(where: { $0.id == id }) { return item }
        }
        return nil
    }

    /// Whether `receiptId` came from an inbox item the app has read: removing it from an entry
    /// sends it back to the inbox.
    public func isInboxReceipt(_ receiptId: String) -> Bool {
        items.values.contains { $0.contains { $0.files.contains { $0.receiptId == receiptId } } }
    }

    // MARK: Reading

    /// Reads the address, and the items to attach when the feature is on.
    public func refresh() async {
        await refreshEmail()
        if isEnabled { await refresh(.toAttach) }
    }

    public func refreshEmail() async {
        guard let service, available() else { return }
        if email == nil { emailLoad = .loading }
        do {
            email = try await service.receiptEmail()
            emailLoad = .loaded
            if email?.enabled != true {
                items = [:]
                cursors = [:]
            }
        } catch is CancellationError {
            if emailLoad == .loading { emailLoad = .idle }
        } catch {
            emailLoad = .failed(ReceiptInboxFailure.message(error))
        }
    }

    /// Reads the first page of `filter` again.
    public func refresh(_ filter: ReceiptInboxFilter) async {
        guard let service, available() else { return }
        if items[filter] == nil { loads[filter] = .loading }
        do {
            let page = try await service.receiptInbox(filter, before: nil)
            items[filter] = page.items
            cursors[filter] = page.next
            loads[filter] = .loaded
        } catch is CancellationError {
            if loads[filter] == .loading { loads[filter] = .idle }
        } catch APIError.notFound {
            // The feature was turned off on the server meanwhile.
            items[filter] = []
            cursors[filter] = nil
            loads[filter] = .loaded
            await refreshEmail()
        } catch {
            loads[filter] = .failed(ReceiptInboxFailure.message(error))
        }
    }

    public func loadMore(_ filter: ReceiptInboxFilter) async {
        guard let service, available(), let cursor = cursors[filter] else { return }
        do {
            let page = try await service.receiptInbox(filter, before: cursor)
            let known = Set((items[filter] ?? []).map(\.id))
            items[filter, default: []].append(contentsOf: page.items.filter { !known.contains($0.id) })
            cursors[filter] = page.next
        } catch {
            loads[filter] = .failed(ReceiptInboxFailure.message(error))
        }
    }

    /// Finds an item a notification opened: in what the list has read, otherwise in a fresh
    /// read of both filters. Nil when it is gone (discarded elsewhere, or expired).
    public func locate(_ id: String) async -> WireReceiptInboxItem? {
        if email == nil { await refreshEmail() }
        await refresh(.toAttach)
        if let item = item(id: id) { return item }
        await refresh(.attached)
        return item(id: id)
    }

    // MARK: The address

    /// Creates the address, or makes a new one (the current one stops working at once).
    public func createAddress() async -> String? {
        await run { service in self.email = try await service.createReceiptEmail() }
    }

    public func extend() async -> String? {
        await run { service in self.email = try await service.updateReceiptEmail(extend: true, allowedSenders: nil) }
    }

    /// Replaces the allowed senders. Each is trimmed and lower-cased; empties and repeats go.
    public func setAllowedSenders(_ senders: [String]) async -> String? {
        let list = Self.normalizedSenders(senders)
        return await run { service in
            self.email = try await service.updateReceiptEmail(extend: false, allowedSenders: list)
        }
    }

    public func turnOff() async -> String? {
        await run { service in
            try await service.deleteReceiptEmail()
            if let current = self.email {
                self.email = WireReceiptEmail(enabled: current.enabled, domain: current.domain, address: nil)
            }
        }
    }

    /// An allowed sender as the server keeps it: an address (`name@example.test`) or a domain
    /// (`example.test`), lower case, at most 254 characters. Nil for anything else.
    public static func normalizedSender(_ text: String) -> String? {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !value.isEmpty, value.utf16.count <= 254, !value.contains(where: \.isWhitespace) else { return nil }
        let parts = value.split(separator: "@", omittingEmptySubsequences: false)
        guard parts.count <= 2, let domain = parts.last, domain.contains("."), !domain.hasPrefix("."),
            !domain.hasSuffix("."), parts.count == 1 || !(parts.first ?? "").isEmpty
        else { return nil }
        return value
    }

    static func normalizedSenders(_ senders: [String]) -> [String] {
        var seen = Set<String>()
        return senders.compactMap(normalizedSender).filter { seen.insert($0).inserted }
    }

    // MARK: Items

    /// Discards the item and its unlinked files.
    public func discard(_ item: WireReceiptInboxItem) async -> String? {
        await run { service in
            _ = try await service.discardInboxItem(id: item.id)
            self.remove(item.id)
        } refreshOnNotFound: {
            self.remove(item.id)
        }
    }

    /// Done on a partly attached item: it moves to Attached, its unlinked files go.
    public func finish(_ item: WireReceiptInboxItem) async -> String? {
        await run { service in
            _ = try await service.finishInboxItem(id: item.id)
            self.remove(item.id)
            await self.refresh(.attached)
        } refreshOnNotFound: {
            self.remove(item.id)
        }
    }

    /// After a save that linked or unlinked an inbox receipt: read what the list shows again.
    public func linksChanged() async {
        for filter in ReceiptInboxFilter.allCases where items[filter] != nil { await refresh(filter) }
    }

    private func remove(_ id: String) {
        for filter in ReceiptInboxFilter.allCases { items[filter]?.removeAll { $0.id == id } }
    }

    private func run(
        _ action: @MainActor (any ReceiptInboxService) async throws -> Void,
        refreshOnNotFound: (@MainActor () -> Void)? = nil
    ) async -> String? {
        guard let service else { return "Sign in to use emailed receipts." }
        guard available() else { return ReceiptInboxFailure.offline }
        isWorking = true
        defer { isWorking = false }
        do {
            try await action(service)
            return nil
        } catch is CancellationError {
            return nil
        } catch APIError.notFound where refreshOnNotFound != nil {
            refreshOnNotFound?()
            return ReceiptInboxFailure.message(APIError.notFound(message: nil))
        } catch {
            return ReceiptInboxFailure.message(error)
        }
    }
}
