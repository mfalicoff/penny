import Foundation
import PennyDomain

/// `GET /api/receipt-email`: whether this server takes emailed receipts, its receipt domain,
/// and the account's live address (MAZ-184). Always answered, `enabled: false` included, so
/// the app knows to hide the feature.
public struct WireReceiptEmail: Codable, Equatable, Sendable {
    public var enabled: Bool
    public var domain: String?
    public var address: WireReceiptEmailAddress?

    public init(enabled: Bool, domain: String?, address: WireReceiptEmailAddress?) {
        self.enabled = enabled
        self.domain = domain
        self.address = address
    }
}

/// A live private receipt address. Times are Unix milliseconds.
public struct WireReceiptEmailAddress: Codable, Equatable, Sendable {
    public var address: String
    public var createdAt: Int64
    public var expiresAt: Int64
    public var lastReceivedAt: Int64?
    /// Lower-case addresses or domains; empty means any sender.
    public var allowedSenders: [String]

    public init(
        address: String, createdAt: Int64, expiresAt: Int64, lastReceivedAt: Int64? = nil,
        allowedSenders: [String] = []
    ) {
        self.address = address
        self.createdAt = createdAt
        self.expiresAt = expiresAt
        self.lastReceivedAt = lastReceivedAt
        self.allowedSenders = allowedSenders
    }
}

/// One received email in the owner-only receipt inbox. `from`, `subject` and the file names
/// are untrusted text from the internet: they are shown as plain text only, never interpreted
/// as Markdown or HTML (`ReceiptInboxText.plain`).
public struct WireReceiptInboxItem: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    /// The sender's display name, or the address when it has none.
    public var from: String
    public var subject: String
    /// Unix milliseconds.
    public var receivedAt: Int64
    /// `to_attach`, `partly_attached` or `attached`.
    public var status: String
    public var senderVerified: Bool
    /// When an unhandled item is discarded; nil once attached.
    public var expiresAt: Int64?
    public var attachedAt: Int64?
    /// The rendered email first, then each attachment.
    public var files: [WireReceiptInboxFile]

    public init(
        id: String, from: String, subject: String, receivedAt: Int64, status: String, senderVerified: Bool,
        expiresAt: Int64?, attachedAt: Int64? = nil, files: [WireReceiptInboxFile]
    ) {
        self.id = id
        self.from = from
        self.subject = subject
        self.receivedAt = receivedAt
        self.status = status
        self.senderVerified = senderVerified
        self.expiresAt = expiresAt
        self.attachedAt = attachedAt
        self.files = files
    }
}

public struct WireReceiptInboxFile: Codable, Equatable, Sendable, Identifiable {
    public var receiptId: String
    /// `email` (the rendered message) or `attachment`.
    public var kind: String
    public var name: String
    public var mime: String
    public var sizeBytes: Int
    /// An entry, a live shared expense or a shared rule links it.
    public var linked: Bool
    public var uri: String

    public var id: String { receiptId }

    public init(
        receiptId: String, kind: String, name: String, mime: String, sizeBytes: Int, linked: Bool, uri: String
    ) {
        self.receiptId = receiptId
        self.kind = kind
        self.name = name
        self.mime = mime
        self.sizeBytes = sizeBytes
        self.linked = linked
        self.uri = uri
    }
}

public struct WireReceiptInboxPage: Codable, Equatable, Sendable {
    public var items: [WireReceiptInboxItem]
    /// Pass as `before` for the next page.
    public var next: String?

    public init(items: [WireReceiptInboxItem], next: String?) {
        self.items = items
        self.next = next
    }
}

/// What Discard and Done did: files deleted, and files kept because something links them.
public struct WireReceiptInboxCleanup: Codable, Equatable, Sendable {
    public var deleted: Int
    public var kept: Int

    public init(deleted: Int, kept: Int) {
        self.deleted = deleted
        self.kept = kept
    }
}

/// The inbox filters the API takes.
public enum ReceiptInboxFilter: String, CaseIterable, Hashable, Sendable {
    case toAttach = "to_attach"
    case attached
}

/// Emailed receipts (MAZ-184): the receipt address and the receipt inbox. Every call needs a
/// session. While the feature is off on the server, everything but `receiptEmail()` answers 404.
/// Attaching has no endpoint of its own: it is the normal ledger or shared expense save with
/// the file's `receiptId` (docs/plans/email-receipts.md).
extension APIClient {
    private struct UpdateBody: Encodable {
        var extend: Bool?
        var allowedSenders: [String]?
    }

    public func receiptEmail() async throws -> WireReceiptEmail {
        try await json(.get, "/api/receipt-email")
    }

    /// Creates the address, or rotates it: the current one stops working at once. 429 when
    /// too many were made today.
    public func createReceiptEmail() async throws -> WireReceiptEmail {
        try await json(.post, "/api/receipt-email")
    }

    /// Extends the lifetime from now, and/or replaces the allowed senders (at most 50).
    public func updateReceiptEmail(extend: Bool = false, allowedSenders: [String]? = nil) async throws
        -> WireReceiptEmail
    {
        guard extend || allowedSenders != nil else { throw APIError.invalidRequest(.invalidField("extend")) }
        if let allowedSenders, allowedSenders.count > 50 || allowedSenders.contains(where: { $0.utf16.count > 254 }) {
            throw APIError.invalidRequest(.invalidField("allowedSenders"))
        }
        return try await json(
            .patch, "/api/receipt-email", body: UpdateBody(extend: extend ? true : nil, allowedSenders: allowedSenders))
    }

    /// Turns the address off. Items already in the inbox stay.
    public func deleteReceiptEmail() async throws {
        let ok: WireOk = try await json(.delete, "/api/receipt-email")
        guard ok.ok else { throw APIError.malformedResponse }
    }

    /// One page of the inbox, newest first.
    public func receiptInbox(_ filter: ReceiptInboxFilter = .toAttach, before: String? = nil) async throws
        -> WireReceiptInboxPage
    {
        var query = [URLQueryItem(name: "status", value: filter.rawValue)]
        if let before {
            guard !before.isEmpty, before.utf16.count <= 100 else {
                throw APIError.invalidRequest(.invalidField("before"))
            }
            query.append(URLQueryItem(name: "before", value: before))
        }
        return try await json(.get, "/api/receipt-inbox", query: query)
    }

    /// Deletes the item and its files that nothing links.
    public func discardInboxItem(id: String) async throws -> WireReceiptInboxCleanup {
        try await json(.delete, "/api/receipt-inbox/\(try Self.segment(id, field: "id"))")
    }

    /// Marks a partly attached item Attached and deletes its files that nothing links.
    public func finishInboxItem(id: String) async throws -> WireReceiptInboxCleanup {
        try await json(.post, "/api/receipt-inbox/\(try Self.segment(id, field: "id"))/done")
    }
}
