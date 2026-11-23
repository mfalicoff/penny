using System.Security.Cryptography;
using System.Text;

namespace Penny.Backend.Application.Mail;

// Rate limits count messages per recipient by SHA-256 of the normalized address, so the
// outbox never needs to keep the address itself.
public static class MailRecipients
{
    public static string Hash(string normalizedEmail) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(normalizedEmail)));
}
