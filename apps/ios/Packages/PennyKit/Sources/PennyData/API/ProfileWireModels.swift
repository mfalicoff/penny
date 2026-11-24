import Foundation

/// `GET`, `PATCH /api/profile` and the picture operations (MAZ-171): the signed-in person's
/// display name and picture, and which of them they may change. A provider-managed field
/// (`nameEditable` or `avatarEditable` false) is read only; the API answers 403 to a change.
public struct WireProfile: Codable, Equatable, Sendable {
    public var userId: String
    public var email: String
    /// Absent when the person has no name: show the email.
    public var displayName: String?
    /// Same-origin picture URL (`/api/users/<id>/avatar?v=<version>`), loaded with the
    /// session. Absent when there is no picture: show initials.
    public var avatarUrl: String?
    public var nameEditable: Bool
    public var avatarEditable: Bool
    /// Ask "What should people call you?" (iphone-name-prompt); skipping sends
    /// `namePromptDismissed`.
    public var needsName: Bool
    /// `password` or `oidc`.
    public var signIn: String
    /// For an `oidc` account, the configured name of its own sign-in provider; absent when
    /// none is configured ("your sign-in provider").
    public var provider: String?
    /// Unix milliseconds when a password account last changed its password; absent before the
    /// first change and for `oidc` accounts ("Changed Oct 3").
    public var passwordChangedAt: Int64?
    /// MAZ-172: whether the current email is proven (an emailed link was opened, the provider says
    /// so, an operator marked it, or the account is older than verification). Nothing waits for
    /// it; show the unverified state only while the server sends email. True from servers before
    /// verification, which never ask for it.
    public var emailVerified: Bool
    /// Unix milliseconds when the current email was verified; absent while unverified.
    public var emailVerifiedAt: Int64?

    public init(
        userId: String,
        email: String,
        displayName: String? = nil,
        avatarUrl: String? = nil,
        nameEditable: Bool = true,
        avatarEditable: Bool = true,
        needsName: Bool = false,
        signIn: String = "password",
        provider: String? = nil,
        passwordChangedAt: Int64? = nil,
        emailVerified: Bool = true,
        emailVerifiedAt: Int64? = nil
    ) {
        self.userId = userId
        self.email = email
        self.displayName = displayName
        self.avatarUrl = avatarUrl
        self.nameEditable = nameEditable
        self.avatarEditable = avatarEditable
        self.needsName = needsName
        self.signIn = signIn
        self.provider = provider
        self.passwordChangedAt = passwordChangedAt
        self.emailVerified = emailVerified
        self.emailVerifiedAt = emailVerifiedAt
    }

    private enum CodingKeys: String, CodingKey {
        case userId, email, displayName, avatarUrl, nameEditable, avatarEditable, needsName, signIn, provider
        case passwordChangedAt, emailVerified, emailVerifiedAt
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        userId = try container.decode(String.self, forKey: .userId)
        email = try container.decode(String.self, forKey: .email)
        displayName = try container.decodeIfPresent(String.self, forKey: .displayName)
        avatarUrl = try container.decodeIfPresent(String.self, forKey: .avatarUrl)
        nameEditable = try container.decode(Bool.self, forKey: .nameEditable)
        avatarEditable = try container.decode(Bool.self, forKey: .avatarEditable)
        needsName = try container.decode(Bool.self, forKey: .needsName)
        signIn = try container.decode(String.self, forKey: .signIn)
        provider = try container.decodeIfPresent(String.self, forKey: .provider)
        passwordChangedAt = try container.decodeIfPresent(Int64.self, forKey: .passwordChangedAt)
        emailVerified = try container.decodeIfPresent(Bool.self, forKey: .emailVerified) ?? true
        emailVerifiedAt = try container.decodeIfPresent(Int64.self, forKey: .emailVerifiedAt)
    }
}

/// `PATCH /api/profile` body. Encode only the fields to change: a `nil` name is left out,
/// so clear a name with `clearingName()` (which sends `"displayName": null`).
public struct WireProfileUpdate: Encodable, Equatable, Sendable {
    public var displayName: String?
    public var clearsName: Bool
    public var namePromptDismissed: Bool

    public init(displayName: String? = nil, namePromptDismissed: Bool = false) {
        self.displayName = displayName
        self.clearsName = false
        self.namePromptDismissed = namePromptDismissed
    }

    public static func clearingName() -> WireProfileUpdate {
        var update = WireProfileUpdate()
        update.clearsName = true
        return update
    }

    private enum CodingKeys: String, CodingKey {
        case displayName
        case namePromptDismissed
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        if clearsName {
            try container.encodeNil(forKey: .displayName)
        } else if let displayName {
            try container.encode(displayName, forKey: .displayName)
        }
        if namePromptDismissed {
            try container.encode(true, forKey: .namePromptDismissed)
        }
    }
}

/// `POST /api/auth/register` with the optional name asked at sign-up (MAZ-171).
public struct WireRegistration: Encodable, Equatable, Sendable {
    public var email: String
    public var password: String
    /// Left out when `nil`; a blank name counts as none on the server.
    public var displayName: String?

    public init(email: String, password: String, displayName: String? = nil) {
        self.email = email
        self.password = password
        self.displayName = displayName
    }
}

/// `POST /api/auth/password` (MAZ-171): a signed-in password change. 400 for a wrong current
/// password or a new one outside 10–256 characters, 403 for an account that signs in with a
/// provider. Other sessions end; this one stays.
public struct WirePasswordChange: Encodable, Equatable, Sendable {
    public var currentPassword: String
    public var newPassword: String

    public init(currentPassword: String, newPassword: String) {
        self.currentPassword = currentPassword
        self.newPassword = newPassword
    }
}

/// `POST /api/auth/email` (MAZ-172): a password account moves to another address after its
/// password. The account becomes unverified and, while the server sends email, a new link goes to
/// the new address. 400 for an invalid address or a wrong password, 409 for an address another
/// account uses, 403 for an account that signs in with a provider.
public struct WireEmailChange: Encodable, Equatable, Sendable {
    public var email: String
    public var password: String

    public init(email: String, password: String) {
        self.email = email
        self.password = password
    }
}

/// `POST /api/auth/email-verification` body: the code from the emailed link's fragment.
public struct WireEmailVerificationRequest: Encodable, Equatable, Sendable {
    public var token: String

    public init(token: String) { self.token = token }
}

/// `POST /api/auth/email-verification` answer: the address that is now verified.
public struct WireEmailVerified: Decodable, Equatable, Sendable {
    public var email: String

    public init(email: String) { self.email = email }
}
