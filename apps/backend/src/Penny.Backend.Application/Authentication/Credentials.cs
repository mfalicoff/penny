using System.Text.RegularExpressions;

namespace Penny.Backend.Application.Authentication;

// Mirrors the legacy zod schema `{ email: string().trim().toLowerCase().email().max(254),
// password: string().min(10).max(256) }` so existing accounts resolve to the same
// stored (bytewise) email. Lengths are UTF-16 code units, as in JavaScript.
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
        if (email is null || password is null)
            return null;
        var normalized = LowerCase(email.Trim(JavaScriptWhitespace));
        if (
            !EmailPattern().IsMatch(normalized)
            || normalized.Length > MaxEmailLength
            || password.Length is < MinPasswordLength or > MaxPasswordLength
        )
            return null;
        return new(normalized, password);
    }

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

    // zod 4 `z.email()` default pattern.
    [GeneratedRegex(
        @"^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}\z",
        RegexOptions.CultureInvariant,
        matchTimeoutMilliseconds: 1000
    )]
    private static partial Regex EmailPattern();
}
