import Foundation

/// What asking for a reset email did (MAZ-124).
public enum PasswordResetRequestOutcome: Equatable, Sendable {
    /// Accepted. An email is on its way if the address has an account; the answer is the same
    /// either way, so the screen says "if".
    case sent
    /// The server no longer sends email: the person needs a reset code from its administrator.
    case emailOff
}

/// A password reset code (MAZ-123, MAZ-124): 64 lowercase hex characters, from the server's
/// administrator or from a reset email. People paste it with spaces, line breaks or capitals.
public enum PasswordResetCode {
    public static let invalidFormat =
        "A reset code is 64 letters and numbers. Copy it exactly as your administrator sent it."

    public static func normalized(_ text: String) -> String {
        String(text.unicodeScalars.filter { !CharacterSet.whitespacesAndNewlines.contains($0) }).lowercased()
    }

    /// 64 lowercase hex characters once spaces are dropped and capitals lowered.
    public static func looksValid(_ text: String) -> Bool {
        let code = normalized(text)
        return code.utf8.count == 64 && code.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }
}

/// The light email check the screens run before asking the server (`Enter a valid email
/// address.`): the server's own check is the rule.
public enum EmailAddress {
    public static func looksValid(_ text: String) -> Bool {
        guard (3...254).contains(text.utf16.count), !text.contains(where: \.isWhitespace) else { return false }
        let parts = text.split(separator: "@", omittingEmptySubsequences: false)
        guard parts.count == 2, !parts[0].isEmpty else { return false }
        let domain = parts[1]
        return domain.contains(".") && !domain.hasPrefix(".") && !domain.hasSuffix(".")
    }
}
