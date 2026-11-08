using System.Security.Cryptography;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;
using Penny.Backend.Application.Abstractions.Security;

namespace Penny.Backend.Api.Authentication;

// ASP.NET Core Identity's versioned PBKDF2 format (v3: HMAC-SHA512, salt embedded).
// Legacy scrypt hex hashes and empty OIDC-only passwords never verify.
public sealed class IdentityPasswordHasher : IPasswordHasher
{
    private const byte CurrentFormat = 0x01;
    private static readonly object Subject = new();
    private readonly PasswordHasher<object> hasher;
    private readonly string unusable;

    public IdentityPasswordHasher(PasswordHasherOptions? options = null)
    {
        hasher = new PasswordHasher<object>(Options.Create(options ?? new PasswordHasherOptions()));
        unusable = hasher.HashPassword(Subject, RandomNumberGenerator.GetHexString(32));
    }

    public string Hash(string password) => hasher.HashPassword(Subject, password);

    public PasswordCheck Verify(string? storedHash, string password)
    {
        if (!IsCurrentFormat(storedHash))
        {
            // Same cost as a real check, so unknown and legacy accounts are not distinguishable.
            hasher.VerifyHashedPassword(Subject, unusable, password);
            return PasswordCheck.Failed;
        }
        return hasher.VerifyHashedPassword(Subject, storedHash, password) switch
        {
            PasswordVerificationResult.Success => PasswordCheck.Success,
            PasswordVerificationResult.SuccessRehashNeeded => PasswordCheck.SuccessRehashNeeded,
            _ => PasswordCheck.Failed,
        };
    }

    private static bool IsCurrentFormat(
        [System.Diagnostics.CodeAnalysis.NotNullWhen(true)] string? value
    )
    {
        if (string.IsNullOrEmpty(value))
            return false;
        var bytes = new byte[value.Length];
        return Convert.TryFromBase64String(value, bytes, out var written)
            && written > 0
            && bytes[0] == CurrentFormat;
    }
}
