using System.Security.Cryptography;
using System.Text;

namespace Penny.Backend.Application.Authentication;

// Hashes and verifies the stored legacy format: lowercase hex of a 64-byte scrypt
// key over (password, salt). Each derivation holds 16 MiB, so concurrent work is
// bounded like Node's default four-thread libuv pool.
public sealed class LegacyPasswordHasher : IDisposable
{
    public const int MaxConcurrentDerivations = 4;
    private readonly SemaphoreSlim slots = new(MaxConcurrentDerivations);

    public async Task<string> HashAsync(
        string password,
        string salt,
        CancellationToken cancellationToken
    ) => Convert.ToHexStringLower(await DeriveAsync(password, salt, cancellationToken));

    public async Task<bool> VerifyAsync(
        string password,
        string salt,
        string expected,
        CancellationToken cancellationToken
    )
    {
        // Always derive, so missing users and unusable hashes cost the same time.
        var candidate = await DeriveAsync(password, salt, cancellationToken);
        var stored = DecodeHexPrefix(expected);
        return candidate.Length == stored.Length
            && CryptographicOperations.FixedTimeEquals(candidate, stored);
    }

    public void Dispose() => slots.Dispose();

    private async Task<byte[]> DeriveAsync(
        string password,
        string salt,
        CancellationToken cancellationToken
    )
    {
        await slots.WaitAsync(cancellationToken);
        try
        {
            return await Task.Run(
                () =>
                    LegacyScrypt.Derive(
                        Encoding.UTF8.GetBytes(password),
                        Encoding.UTF8.GetBytes(salt)
                    ),
                cancellationToken
            );
        }
        finally
        {
            slots.Release();
        }
    }

    // Node's Buffer.from(value, "hex") decodes the leading run of valid hex pairs.
    public static byte[] DecodeHexPrefix(string value)
    {
        var length = 0;
        while (
            length + 1 < value.Length
            && char.IsAsciiHexDigit(value[length])
            && char.IsAsciiHexDigit(value[length + 1])
        )
            length += 2;
        return Convert.FromHexString(value.AsSpan(0, length));
    }
}
