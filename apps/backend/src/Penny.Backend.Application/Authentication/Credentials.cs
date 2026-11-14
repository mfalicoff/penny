using System.Diagnostics.CodeAnalysis;
using System.Text.RegularExpressions;

namespace Penny.Backend.Application.Authentication;

// Sign-in credentials: the email is trimmed, lowercased, checked against the email
// pattern below and at most 254 characters; the password has 10-256 characters. Trimming and
// lowercasing make each spelling of an email resolve to the same stored (bytewise)
// email. Lengths are UTF-16 code units, as in JavaScript.
public sealed partial record Credentials(string Email, string Password)
{
    public const int MaxEmailLength = 254;
    public const int MinPasswordLength = 10;
    public const int MaxPasswordLength = 256;

    // JavaScript String.prototype.trim: WhiteSpace plus LineTerminator code points.
    private static readonly char[] JavaScriptWhitespace =
    [
        (char)0x0009,
        (char)0x000A,
        (char)0x000B,
        (char)0x000C,
        (char)0x000D,
        (char)0x0020,
        (char)0x00A0,
        (char)0x1680,
        (char)0x2000,
        (char)0x2001,
        (char)0x2002,
        (char)0x2003,
        (char)0x2004,
        (char)0x2005,
        (char)0x2006,
        (char)0x2007,
        (char)0x2008,
        (char)0x2009,
        (char)0x200A,
        (char)0x2028,
        (char)0x2029,
        (char)0x202F,
        (char)0x205F,
        (char)0x3000,
        (char)0xFEFF,
    ];

    public override string ToString() => $"Credentials for {Email} (password redacted)";

    public static Credentials? Normalize(string? email, string? password)
    {
        if (email is null || !IsValidPassword(password))
            return null;
        var normalized = NormalizeEmail(email);
        return normalized is null ? null : new(normalized, password);
    }

    // The login email rule on its own: password resets find accounts exactly as
    // sign-in does.
    public static string? NormalizeEmail(string? email)
    {
        if (email is null)
            return null;
        var normalized = LowerCase(email.Trim(JavaScriptWhitespace));
        return EmailPattern().IsMatch(normalized) && normalized.Length <= MaxEmailLength
            ? normalized
            : null;
    }

    public static bool IsValidPassword([NotNullWhen(true)] string? password) =>
        password is { Length: >= MinPasswordLength and <= MaxPasswordLength };

    // Provider (OIDC) emails: at most 254 characters and the email pattern, validated
    // as sent (no trimming), then lowercased. The pattern is ASCII-only, so ASCII
    // lowercasing equals JavaScript's toLowerCase here.
    public static string? NormalizeProviderEmail(string? email) =>
        email is null || email.Length > MaxEmailLength || !EmailPattern().IsMatch(email)
            ? null
            : LowerCase(email);

    // The email pattern only accepts ASCII, and the only non-ASCII code point whose
    // JavaScript lowercase is ASCII is KELVIN SIGN (U+212A -> "k"). Every other
    // non-ASCII character fails the pattern either way, so this matches toLowerCase().
    private static string LowerCase(string value) =>
        string.Create(
            value.Length,
            value,
            static (target, source) =>
            {
                for (var i = 0; i < source.Length; i++)
                    target[i] = source[i] switch
                    {
                        >= 'A' and <= 'Z' => (char)(source[i] + 32),
                        (char)0x212A => 'k',
                        var other => other,
                    };
            }
        );

    // The email pattern every client applies.
    [GeneratedRegex(
        @"^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}\z",
        RegexOptions.CultureInvariant,
        matchTimeoutMilliseconds: 1000
    )]
    private static partial Regex EmailPattern();
}
