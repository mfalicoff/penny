// Wire models for the Penny HTTP API (contracts/openapi.json, contract 2.1.0).
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
    /// Contract 2.2.0: how many people split an expense, the person included. Omitted when nil.
    public var participants: Int?
    public var categoryId: String
    public var accountId: String?
    public var tripId: String?
    public var recurringId: String?
    public var date: String
    public var note: String
    public var receipt: WireReceipt?

    public init(
        id: String, title: String, kind: WireEntryKind, total: Int64, share: Int64, participants: Int? = nil,
        categoryId: String,
        accountId: String? = nil, tripId: String? = nil, recurringId: String? = nil, date: String,
        note: String, receipt: WireReceipt? = nil
    ) {
        self.id = id
        self.title = title
        self.kind = kind
        self.total = total
        self.share = share
        self.participants = participants
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
    /// Contract 2.2.0: how many people split an expense, the person included. Omitted when nil.
    public var participants: Int?
    public var categoryId: String
    public var accountId: String?
    public var date: String
    public var note: String
    public var frequency: String
    public var nextDate: String
    public var anchorDay: Int?
    public var active: Bool

    public init(
        id: String, title: String, kind: WireEntryKind, total: Int64, share: Int64, participants: Int? = nil,
        categoryId: String,
        accountId: String? = nil, date: String, note: String, frequency: String, nextDate: String,
        anchorDay: Int? = nil, active: Bool
    ) {
        self.id = id
        self.title = title
        self.kind = kind
        self.total = total
        self.share = share
        self.participants = participants
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
    /// MAZ-171: absent on servers older than profiles.
    public var userId: String?
    /// The person's display name; absent when they have none (show the email).
    public var displayName: String?
    /// Same-origin picture URL (`/api/users/<id>/avatar?v=<version>`); absent without a picture.
    public var avatarUrl: String?
    /// Ask "What should people call you?" once. Older servers send nothing: don't ask.
    public var needsName: Bool?

    public init(
        email: String, userId: String? = nil, displayName: String? = nil, avatarUrl: String? = nil,
        needsName: Bool? = nil
    ) {
        self.email = email
        self.userId = userId
        self.displayName = displayName
        self.avatarUrl = avatarUrl
        self.needsName = needsName
    }
}

public struct WireServerInfo: Codable, Equatable, Sendable {
    public var name: String
    public var version: String
    /// MAZ-169: the operator's privacy policy (`Legal__PrivacyPolicyUrl`). Absent on older servers
    /// and `null` when none is set. Read it through `privacyPolicy`, which drops anything that
    /// isn't an absolute http(s) URL.
    public var privacyPolicyUrl: String?
    /// MAZ-124: whether the server sends email (password reset links and invitations by email).
    /// Absent on older servers; read it through `sendsEmail`, which treats absent as false.
    public var emailEnabled: Bool?
    /// MAZ-129: which opt-in client telemetry the server takes. Absent on older servers; read it
    /// through `takesNativeTelemetry`.
    public var telemetry: WireClientTelemetryInfo?

    public init(
        name: String, version: String, privacyPolicyUrl: String? = nil, emailEnabled: Bool? = nil,
        telemetry: WireClientTelemetryInfo? = nil
    ) {
        self.name = name
        self.version = version
        self.privacyPolicyUrl = privacyPolicyUrl
        self.emailEnabled = emailEnabled
        self.telemetry = telemetry
    }

    private enum CodingKeys: String, CodingKey { case name, version, privacyPolicyUrl, emailEnabled, telemetry }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        name = try container.decode(String.self, forKey: .name)
        version = try container.decode(String.self, forKey: .version)
        privacyPolicyUrl = try container.decodeIfPresent(String.self, forKey: .privacyPolicyUrl)
        emailEnabled = try container.decodeIfPresent(Bool.self, forKey: .emailEnabled)
        // A malformed telemetry object reads as absent: the app then never asks or sends.
        telemetry = try? container.decodeIfPresent(WireClientTelemetryInfo.self, forKey: .telemetry)
    }

    public var sendsEmail: Bool { emailEnabled == true }

    /// Whether the iOS app may offer crash and performance reports (`telemetry.native`).
    public var takesNativeTelemetry: Bool { telemetry?.native == true }

    public var privacyPolicy: URL? { PrivacyPolicy.url(privacyPolicyUrl) }
}

/// The privacy policy link's rule (MAZ-169), as on the web: only an absolute http or https URL
/// with a host and no credentials becomes a link, so a bad value never opens anything else.
public enum PrivacyPolicy {
    public static let maxLength = 2048

    public static func url(_ text: String?) -> URL? {
        guard let text, !text.isEmpty, text.utf16.count <= maxLength,
            let url = URL(string: text), let scheme = url.scheme?.lowercased(),
            scheme == "https" || scheme == "http", let host = url.host, !host.isEmpty,
            url.user == nil, url.password == nil
        else { return nil }
        return url
    }
}

struct WireOk: Decodable, Sendable {
    var ok: Bool
}

struct WireErrorBody: Decodable, Sendable {
    var error: String
    /// The stable failure name (contract 2.1.0). Absent from a server before 2.1.0.
    var code: String?
}

/// Who paid a shared expense, as the household members see them (MAZ-275).
public struct WireExpensePayer: Codable, Equatable, Sendable {
    public var email: String
    /// Omitted when they have none (MAZ-171): show the email.
    public var displayName: String?
    /// True once they deleted their account (MAZ-152): show "Former member", never the email.
    public var deleted: Bool?

    public init(email: String, displayName: String? = nil, deleted: Bool? = nil) {
        self.email = email
        self.displayName = displayName
        self.deleted = deleted
    }
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
    /// Absent from servers before MAZ-275.
    public var payer: WireExpensePayer?
    /// True when the viewer paid; absent from servers before MAZ-275.
    public var paidByYou: Bool?
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

/// `GET /api/auth/oidc`: the sign-in providers configured on this server (MAZ-170).
/// `providers` is absent from servers before MAZ-170, which had at most one provider,
/// described by `enabled` and `label`.
public struct WireOidcConfig: Codable, Equatable, Sendable {
    public var enabled: Bool
    /// Deprecated: the first provider's label, for clients from before MAZ-170.
    public var label: String?
    public var providers: [WireOidcProvider]?

    public init(enabled: Bool, label: String? = nil, providers: [WireOidcProvider]? = nil) {
        self.enabled = enabled
        self.label = label
        self.providers = providers
    }
}

/// One configured sign-in provider in `GET /api/auth/oidc` (MAZ-170).
public struct WireOidcProvider: Codable, Equatable, Sendable {
    /// Sent as `provider` to start a sign-in.
    public var id: String
    public var label: String
    /// `google`, `apple` or `sso`; any other name gets the generic sign-in mark.
    public var icon: String
    /// The platform's own sign-in may be used (Sign in with Apple), through `/api/auth/oidc/native/*`.
    public var native: Bool

    public init(id: String, label: String, icon: String, native: Bool = false) {
        self.id = id
        self.label = label
        self.icon = icon
        self.native = native
    }
}

/// `POST /api/auth/oidc/native/start` (MAZ-170): one pending native sign-in. The nonce goes
/// unchanged on the platform request, and the ID token must carry it.
public struct WireOidcNativeChallenge: Decodable, Equatable, Sendable {
    public var transaction: String
    public var nonce: String
    public var expiresAt: Int64
    /// The response's `Date` header, as on `WireOidcChallenge`. Not part of the body.
    public var serverDate: Date?

    enum CodingKeys: String, CodingKey {
        case transaction, nonce, expiresAt
    }

    public init(transaction: String, nonce: String, expiresAt: Int64, serverDate: Date? = nil) {
        self.transaction = transaction
        self.nonce = nonce
        self.expiresAt = expiresAt
        self.serverDate = serverDate
    }

    /// How long the server keeps the attempt, on the server's clock alone. Nil without a `Date`.
    public var lifetime: TimeInterval? {
        serverDate.map { Date(timeIntervalSince1970: TimeInterval(expiresAt) / 1000).timeIntervalSince($0) }
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
    /// MAZ-170. Left out for a server from before MAZ-170, which then uses its only provider.
    var provider: String?
}

struct WireOidcNativeStart: Encodable, Sendable {
    var provider: String
}

struct WireOidcNativeComplete: Encodable, Sendable {
    var transaction: String
    var idToken: String
    var givenName: String?
    var familyName: String?
}

struct WireOidcComplete: Encodable, Sendable {
    var transaction: String
    var callbackUrl: String
}

/// `ClientTelemetryInfo` (MAZ-129): which opt-in client telemetry the server accepts.
public struct WireClientTelemetryInfo: Codable, Equatable, Sendable {
    public var web: Bool
    public var sessionReplay: Bool
    /// The iOS app may offer crash and performance reports.
    public var native: Bool

    public init(web: Bool = false, sessionReplay: Bool = false, native: Bool) {
        self.web = web
        self.sessionReplay = sessionReplay
        self.native = native
    }
}
