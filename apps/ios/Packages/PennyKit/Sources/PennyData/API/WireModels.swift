// Wire models for the Penny HTTP API (contracts/openapi.json, contract 1.5.0).
//
// These types mirror the JSON exactly and carry no presentation state. Money is integer
// minor units (cents, Int64), calendar dates stay "YYYY-MM-DD" strings (never Date, so a
// time zone cannot shift them), ids are opaque strings, absent optionals stay nil and the
// ledger `version` and snapshot `revision` are preserved as sent. Domain and view models
// are built from them elsewhere (MAZ-70, 71, 73).

public import Foundation

public enum WireEntryKind: String, Codable, Equatable, Sendable {
    case income
    case expense
    case investment
}

public struct WireReceipt: Codable, Equatable, Sendable {
    public var id: String
    public var name: String
    public var mime: String
    public var uri: String

    public init(id: String, name: String, mime: String, uri: String) {
        self.id = id
        self.name = name
        self.mime = mime
        self.uri = uri
    }
}

public struct WireCategory: Codable, Equatable, Sendable {
    public var id: String
    public var name: String
    public var icon: String
    public var color: String
    public var kind: WireEntryKind

    public init(id: String, name: String, icon: String, color: String, kind: WireEntryKind) {
        self.id = id
        self.name = name
        self.icon = icon
        self.color = color
        self.kind = kind
    }
}

public struct WireAccount: Codable, Equatable, Sendable {
    public var id: String
    public var name: String
    public var type: String

    public init(id: String, name: String, type: String) {
        self.id = id
        self.name = name
        self.type = type
    }
}

public struct WireTrip: Codable, Equatable, Sendable {
    public var id: String
    public var name: String
    public var startDate: String
    public var endDate: String
    public var sharedHouseholdId: String?

    public init(id: String, name: String, startDate: String, endDate: String, sharedHouseholdId: String? = nil) {
        self.id = id
        self.name = name
        self.startDate = startDate
        self.endDate = endDate
        self.sharedHouseholdId = sharedHouseholdId
    }
}

/// A personal ledger entry. `total` and `share` are integer cents.
public struct WireEntry: Codable, Equatable, Sendable {
    public var id: String
    public var title: String
    public var kind: WireEntryKind
    public var total: Int64
    public var share: Int64
    public var categoryId: String
    public var accountId: String?
    public var tripId: String?
    public var recurringId: String?
    public var date: String
    public var note: String
    public var receipt: WireReceipt?

    public init(
        id: String, title: String, kind: WireEntryKind, total: Int64, share: Int64, categoryId: String,
        accountId: String? = nil, tripId: String? = nil, recurringId: String? = nil, date: String,
        note: String, receipt: WireReceipt? = nil
    ) {
        self.id = id
        self.title = title
        self.kind = kind
        self.total = total
        self.share = share
        self.categoryId = categoryId
        self.accountId = accountId
        self.tripId = tripId
        self.recurringId = recurringId
        self.date = date
        self.note = note
        self.receipt = receipt
    }
}

public struct WireRecurring: Codable, Equatable, Sendable {
    public var id: String
    public var title: String
    public var kind: WireEntryKind
    public var total: Int64
    public var share: Int64
    public var categoryId: String
    public var accountId: String?
    public var date: String
    public var note: String
    public var frequency: String
    public var nextDate: String
    public var anchorDay: Int?
    public var active: Bool

    public init(
        id: String, title: String, kind: WireEntryKind, total: Int64, share: Int64, categoryId: String,
        accountId: String? = nil, date: String, note: String, frequency: String, nextDate: String,
        anchorDay: Int? = nil, active: Bool
    ) {
        self.id = id
        self.title = title
        self.kind = kind
        self.total = total
        self.share = share
        self.categoryId = categoryId
        self.accountId = accountId
        self.date = date
        self.note = note
        self.frequency = frequency
        self.nextDate = nextDate
        self.anchorDay = anchorDay
        self.active = active
    }
}

/// The whole personal ledger, version 4. `Ledger(wire:)` refuses any other version.
public struct WireLedger: Codable, Equatable, Sendable {
    public var version: Int
    public var currency: String
    public var categories: [WireCategory]
    public var accounts: [WireAccount]?
    public var trips: [WireTrip]?
    public var transactions: [WireEntry]
    public var recurring: [WireRecurring]

    public init(
        version: Int, currency: String, categories: [WireCategory], accounts: [WireAccount]? = nil,
        trips: [WireTrip]? = nil, transactions: [WireEntry], recurring: [WireRecurring]
    ) {
        self.version = version
        self.currency = currency
        self.categories = categories
        self.accounts = accounts
        self.trips = trips
        self.transactions = transactions
        self.recurring = recurring
    }
}

/// `GET /api/ledger` and the body and result of `PUT /api/ledger`. `revision` is the
/// optimistic-concurrency unit: a write sends the revision it was based on, and a stale one
/// answers 409 (`APIError.conflict`) without changing data.
public struct LedgerSnapshot: Codable, Equatable, Sendable {
    public var revision: Int
    public var ledger: WireLedger

    public init(revision: Int, ledger: WireLedger) {
        self.revision = revision
        self.ledger = ledger
    }
}

public struct WireCredentials: Codable, Equatable, Sendable {
    public var email: String
    public var password: String

    public init(email: String, password: String) {
        self.email = email
        self.password = password
    }
}

/// The login and register result. The token is the bearer credential for one server.
public struct WireSession: Decodable, Equatable, Sendable {
    public var token: String
    public var email: String
}

public struct WireMe: Codable, Equatable, Sendable {
    public var email: String
}

public struct WireServerInfo: Codable, Equatable, Sendable {
    public var name: String
    public var version: String
}

struct WireOk: Decodable, Sendable {
    var ok: Bool
}

struct WireErrorBody: Decodable, Sendable {
    var error: String
}

/// A shared expense as projected for the viewer. Money is `totalCents` and `shareCents`.
public struct WireProjectedExpense: Codable, Equatable, Sendable {
    public struct Category: Codable, Equatable, Sendable {
        public var name: String
        public var icon: String
        public var color: String
    }

    public var id: String
    public var householdId: String
    public var householdName: String?
    public var householdCurrency: String?
    public var title: String
    public var date: String
    public var totalCents: Int64
    public var shareCents: Int64
    public var payerUserId: String
    public var category: Category
    public var note: String
    public var receipt: WireReceipt?
    public var accountId: String?
    public var scheduled: Bool?
    /// The shared rule: on previews, and on recorded occurrences it recorded (MAZ-139); absent
    /// on one-off expenses. Previews are matched to recorded rows by household, rule and date.
    public var recurringId: String?
    public var receiptId: String?
}

/// `GET /api/households/projection`: the caller's recorded shares (`transactions`) and the
/// month's previews of shared rules (`scheduled`), across every household they are in.
public struct WireHouseholdProjection: Codable, Equatable, Sendable {
    public var transactions: [WireProjectedExpense]
    public var scheduled: [WireProjectedExpense]

    public init(transactions: [WireProjectedExpense] = [], scheduled: [WireProjectedExpense] = []) {
        self.transactions = transactions
        self.scheduled = scheduled
    }
}

/// `GET /api/auth/oidc`: whether single sign-on is configured on this server.
public struct WireOidcConfig: Codable, Equatable, Sendable {
    public var enabled: Bool
    public var label: String?

    public init(enabled: Bool, label: String? = nil) {
        self.enabled = enabled
        self.label = label
    }
}

/// `POST /api/auth/oidc/start`: one pending sign-in attempt. `expiresAt` is Unix
/// milliseconds on the server's clock. The transaction is a secret between this device and
/// the server.
public struct WireOidcChallenge: Decodable, Equatable, Sendable {
    public var transaction: String
    public var authorizationUrl: String
    public var expiresAt: Int64
    /// The response's `Date` header (the server's clock when it answered), when it sent one.
    /// Not part of the body.
    public var serverDate: Date?

    enum CodingKeys: String, CodingKey {
        case transaction, authorizationUrl, expiresAt
    }

    public init(transaction: String, authorizationUrl: String, expiresAt: Int64, serverDate: Date? = nil) {
        self.transaction = transaction
        self.authorizationUrl = authorizationUrl
        self.expiresAt = expiresAt
        self.serverDate = serverDate
    }

    /// How long the server keeps the attempt, measured on the server's clock alone, so a
    /// device clock that is off does not matter. Nil without a `Date` header: the device
    /// then cannot judge the absolute `expiresAt`, and the server's own check decides.
    public var lifetime: TimeInterval? {
        serverDate.map { expiry.timeIntervalSince($0) }
    }

    /// The provider page to open in the system authentication session: HTTPS, or plain
    /// HTTP only for a loopback provider in development. Nil for anything else.
    public var authorizationURL: URL? {
        guard let url = URL(string: authorizationUrl), let host = url.host?.lowercased(), !host.isEmpty else {
            return nil
        }
        switch url.scheme?.lowercased() {
        case "https": return url
        case "http" where ["localhost", "127.0.0.1", "::1"].contains(host): return url
        default: return nil
        }
    }

    /// When the server forgets the attempt.
    public var expiry: Date { Date(timeIntervalSince1970: TimeInterval(expiresAt) / 1000) }
}

struct WireOidcStart: Encodable, Sendable {
    var redirectUri: String
}

struct WireOidcComplete: Encodable, Sendable {
    var transaction: String
    var callbackUrl: String
}
