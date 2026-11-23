public import Foundation

// MAZ-171: the signed-in person's profile (name and picture), Change password, and other
// people's pictures. See contracts/openapi.json (`Profile`, `ProfileUpdate`, `PasswordChange`).

extension APIClient {
    /// `POST /api/auth/register` with the name asked at sign-up.
    public func register(_ registration: WireRegistration) async throws -> ServerSession {
        let wire: WireSession = try await json(
            .post, "/api/auth/register", body: registration, authenticated: false)
        do {
            return try ServerSession(server: configuration.server, email: wire.email, token: wire.token)
        } catch {
            throw APIError.malformedResponse
        }
    }

    /// `GET /api/profile`.
    public func profile() async throws -> WireProfile {
        try await json(.get, "/api/profile")
    }

    /// `PATCH /api/profile`: a name, a cleared name, or "Not now" on the name prompt. 403 when a
    /// provider manages the name.
    public func updateProfile(_ update: WireProfileUpdate) async throws -> WireProfile {
        try await json(.patch, "/api/profile", body: update)
    }

    /// `PUT /api/profile/avatar` with the picture's bytes (the app sends a cropped JPEG). The
    /// server re-encodes it and strips its metadata.
    public func uploadAvatar(_ data: Data, mime: String = "image/jpeg") async throws -> WireProfile {
        guard !data.isEmpty, data.count <= AvatarRules.maxBytes else {
            throw APIError.invalidRequest(.invalidField("avatar"))
        }
        guard AvatarRules.mimes.contains(mime) else { throw APIError.invalidRequest(.invalidField("mime")) }
        let result = try await perform(
            .put, "/api/profile/avatar", body: data, headers: ["Content-Type": mime],
            timeout: configuration.transferTimeout)
        return try decode(result.body)
    }

    /// `DELETE /api/profile/avatar`.
    public func removeAvatar() async throws -> WireProfile {
        try await json(.delete, "/api/profile/avatar")
    }

    /// `POST /api/auth/password`. This session stays; the server ends the others.
    public func changePassword(_ change: WirePasswordChange) async throws {
        _ = try await perform(.post, "/api/auth/password", body: try JSONEncoder().encode(change))
    }

    /// A person's picture from its same-origin `avatarUrl` (`/api/users/<id>/avatar?v=<n>`),
    /// sent with this session. Anything else is refused before sending, so the token never goes
    /// to another path or host. A 404 (no picture, or one this account may not see) throws
    /// `notFound`: show initials.
    public func avatar(_ path: String) async throws -> Data {
        guard let (path, query) = AvatarRules.split(path) else {
            throw APIError.invalidRequest(.invalidField("avatarUrl"))
        }
        let result = try await perform(.get, path, query: query, timeout: configuration.transferTimeout)
        guard !result.body.isEmpty else { throw APIError.malformedResponse }
        return result.body
    }
}

/// Limits for the picture upload (the same as the API's).
public enum AvatarRules {
    public static let maxBytes = 10 * 1024 * 1024
    public static let mimes: Set<String> = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]
    /// The side of the square JPEG the crop sends (the server keeps at most 512 px).
    public static let uploadSide = 1024

    /// Splits `/api/users/<id>/avatar?v=<n>` into its path and query, or nil for anything else
    /// (another path, a host, a fragment, dot segments, or characters outside the id's set).
    static func split(_ text: String) -> (String, [URLQueryItem])? {
        guard text.hasPrefix("/api/users/"), !text.contains("#"), !text.contains("//"),
            let components = URLComponents(string: text), components.host == nil, components.scheme == nil
        else { return nil }
        let parts = components.percentEncodedPath.split(separator: "/", omittingEmptySubsequences: false)
        guard parts.count == 5, parts[0].isEmpty, parts[1] == "api", parts[2] == "users", parts[4] == "avatar",
            !parts[3].isEmpty, parts[3].utf8.count <= 100,
            parts[3].allSatisfy({ $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" }),
            parts[3].unicodeScalars.allSatisfy(\.isASCII)
        else { return nil }
        return (components.percentEncodedPath, components.queryItems ?? [])
    }
}

/// The display name rule the server applies (MAZ-171): trimmed, 1 to 60 UTF-16 units, no control
/// characters and no line or paragraph separators. Blank counts as none.
public enum DisplayName {
    public static let maxLength = 60

    public enum Verdict: Equatable, Sendable {
        case valid(String)
        case empty
        case invalid(String)
    }

    public static func validate(_ text: String) -> Verdict {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return .empty }
        if trimmed.utf16.count > maxLength { return .invalid("Use a name of up to \(maxLength) characters.") }
        let forbidden = trimmed.unicodeScalars.contains { scalar in
            scalar.properties.generalCategory == .control || scalar == "\u{2028}" || scalar == "\u{2029}"
        }
        if forbidden { return .invalid("Use a name without line breaks or control characters.") }
        return .valid(trimmed)
    }
}
