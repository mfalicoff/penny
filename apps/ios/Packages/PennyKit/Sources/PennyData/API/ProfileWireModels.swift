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
        passwordChangedAt: Int64? = nil
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
