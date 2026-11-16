using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace Penny.Backend.Application.InboundMail;

// The HMAC that authenticates the Email Worker (MAZ-184). The signed string is
//
//   penny/inbound-mail/v1 \n <purpose> \n <timestamp> \n <subject> \n <sha256(body) hex>
//
// where the purpose is `message` (subject: the recipient local part, body: the raw
// MIME) or `recipients` (subject: the request path, body: empty). The purpose label
// keeps a signature for one call from being replayed as the other. The signature is
// lowercase hex HMAC-SHA256 with the shared secret. apps/email-worker builds the same
// string; both test suites pin the same vectors.
public static class InboundMailSignature
{
    public const string Version = "penny/inbound-mail/v1";
    public const string MessagePurpose = "message";
    public const string RecipientsPurpose = "recipients";
    public const string RecipientsPath = "/api/inbound-mail/recipients";

    public static string Compute(
        ReadOnlySpan<byte> secret,
        string purpose,
        string timestamp,
        string subject,
        ReadOnlySpan<byte> body
    )
    {
        var canonical =
            $"{Version}\n{purpose}\n{timestamp}\n{subject}\n{Convert.ToHexStringLower(SHA256.HashData(body))}";
        return Convert.ToHexStringLower(
            HMACSHA256.HashData(secret, Encoding.UTF8.GetBytes(canonical))
        );
    }

    public static bool Verify(
        ReadOnlySpan<byte> secret,
        string purpose,
        string timestamp,
        string subject,
        ReadOnlySpan<byte> body,
        string? signature
    )
    {
        if (secret.IsEmpty || signature is null || signature.Length != 64)
            return false;
        var expected = Compute(secret, purpose, timestamp, subject, body);
        return CryptographicOperations.FixedTimeEquals(
            Encoding.ASCII.GetBytes(expected),
            Encoding.ASCII.GetBytes(signature)
        );
    }

    // Unix seconds, at most 12 digits, within the window of `now`.
    public static bool IsFresh(string? timestamp, DateTimeOffset now)
    {
        if (
            timestamp is null
            || timestamp.Length is 0 or > 12
            || !timestamp.All(char.IsAsciiDigit)
            || !long.TryParse(
                timestamp,
                NumberStyles.None,
                CultureInfo.InvariantCulture,
                out var seconds
            )
        )
            return false;
        var skew = Math.Abs(now.ToUnixTimeSeconds() - seconds);
        return skew <= (long)InboundMailSettings.SignatureWindow.TotalSeconds;
    }
}
