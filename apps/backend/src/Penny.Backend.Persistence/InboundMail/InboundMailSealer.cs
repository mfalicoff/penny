using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Penny.Backend.Persistence.Receipts;

namespace Penny.Backend.Persistence.InboundMail;

// Emailed receipts (MAZ-184): the receipt encryption scheme (AES-256-GCM, a per-row key
// derived with HKDF-SHA256 from the receipt master key and a random salt) with its own
// HKDF `info`, so a key for inbound mail never opens a receipt and the reverse. Sealed
// values are bound to their part, owner and row by the associated data. Raw messages
// are written below the receipt root's `inbound/` directory, which the receipt store
// never lists.
public sealed partial class InboundMailSealer(ReceiptStoreSettings settings)
{
    public const short CurrentVersion = 1;
    public const string Directory = "inbound";
    private const int TagBytes = 16;
    private const int NonceBytes = 12;
    private const int SaltBytes = 32;
    private const string Scheme = "penny/inbound-mail/v1";
    private static readonly byte[] KeyInfo = Encoding.UTF8.GetBytes(Scheme);

    public static byte[] NewSalt() => RandomNumberGenerator.GetBytes(SaltBytes);

    public static byte[] NewNonce() => RandomNumberGenerator.GetBytes(NonceBytes);

    public static string NewStoragePath()
    {
        var file = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(16));
        return $"{Directory}/{file[..2]}/{file}";
    }

    public byte[] Seal(
        byte[] salt,
        byte[] nonce,
        ReadOnlySpan<byte> plain,
        string part,
        string userId,
        string rowId
    )
    {
        var key = DeriveKey(salt);
        try
        {
            var output = new byte[plain.Length + TagBytes];
            using var aes = new AesGcm(key, TagBytes);
            aes.Encrypt(
                nonce,
                plain,
                output.AsSpan(0, plain.Length),
                output.AsSpan(plain.Length),
                Context(part, userId, rowId)
            );
            return output;
        }
        finally
        {
            CryptographicOperations.ZeroMemory(key);
        }
    }

    public byte[] SealText(
        byte[] salt,
        byte[] nonce,
        string plain,
        string part,
        string userId,
        string rowId
    ) => Seal(salt, nonce, Encoding.UTF8.GetBytes(plain), part, userId, rowId);

    public byte[] Open(
        short version,
        byte[] salt,
        byte[] nonce,
        byte[] sealedBytes,
        string part,
        string userId,
        string rowId
    )
    {
        if (version != CurrentVersion)
            throw new CryptographicException("Inbound mail encryption version is not supported.");
        if (sealedBytes.Length < TagBytes)
            throw new CryptographicException("Inbound mail ciphertext is truncated.");
        var key = DeriveKey(salt);
        try
        {
            var plain = new byte[sealedBytes.Length - TagBytes];
            using var aes = new AesGcm(key, TagBytes);
            aes.Decrypt(
                nonce,
                sealedBytes.AsSpan(0, plain.Length),
                sealedBytes.AsSpan(plain.Length),
                plain,
                Context(part, userId, rowId)
            );
            return plain;
        }
        finally
        {
            CryptographicOperations.ZeroMemory(key);
        }
    }

    public string OpenText(
        short version,
        byte[] salt,
        byte[] nonce,
        byte[] sealedBytes,
        string part,
        string userId,
        string rowId
    ) => Encoding.UTF8.GetString(Open(version, salt, nonce, sealedBytes, part, userId, rowId));

    // Temp file, fsync, then a no-overwrite rename, as the receipt store does.
    public async Task WriteAsync(
        string storagePath,
        byte[] ciphertext,
        CancellationToken cancellationToken
    )
    {
        var path = FullPath(storagePath);
        System.IO.Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temporary =
            path + ".tmp-" + Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(8));
        var options = new FileStreamOptions
        {
            Mode = FileMode.CreateNew,
            Access = FileAccess.Write,
            Share = FileShare.None,
        };
        if (!OperatingSystem.IsWindows())
            options.UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite;
        try
        {
            await using (var stream = new FileStream(temporary, options))
            {
                await stream.WriteAsync(ciphertext, cancellationToken);
                stream.Flush(flushToDisk: true);
            }
            File.Move(temporary, path, overwrite: false);
        }
        catch
        {
            File.Delete(temporary);
            throw;
        }
    }

    public Task<byte[]> ReadAsync(string storagePath, CancellationToken cancellationToken) =>
        File.ReadAllBytesAsync(FullPath(storagePath), cancellationToken);

    public void Delete(string storagePath) => File.Delete(FullPath(storagePath));

    private byte[] DeriveKey(byte[] salt) =>
        HKDF.DeriveKey(HashAlgorithmName.SHA256, settings.MasterKey, 32, salt, KeyInfo);

    // Ids never contain NUL, so the encoding is unambiguous.
    private static byte[] Context(string part, string userId, string rowId) =>
        Encoding.UTF8.GetBytes($"{Scheme}\0{part}\0{userId}\0{rowId}");

    private string FullPath(string storagePath)
    {
        if (!StoragePathPattern().IsMatch(storagePath))
            throw new InvalidOperationException("Inbound mail storage path is invalid.");
        return Path.Combine(settings.Root, storagePath);
    }

    [GeneratedRegex("^inbound/[0-9a-f]{2}/[0-9a-f]{32}$", RegexOptions.CultureInvariant)]
    private static partial Regex StoragePathPattern();
}
