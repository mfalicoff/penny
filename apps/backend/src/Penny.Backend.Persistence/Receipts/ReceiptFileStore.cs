using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Receipts;

// AES-256-GCM with a per-file key derived (HKDF-SHA256) from the master service key
// and a random per-file salt. The file body and the original filename are sealed
// with the same key, separate nonces and associated data binding them to the owner
// and the receipt id. `receipts.encryption_version` names the scheme; only 1 exists.
public sealed partial class ReceiptFileStore(ReceiptStoreSettings settings)
{
    public const short CurrentVersion = 1;
    private const int TagBytes = 16;
    private const int NonceBytes = 12;
    private const int SaltBytes = 32;
    private static readonly byte[] KeyInfo = "penny/receipt/v1"u8.ToArray();

    public EncryptedReceipt Encrypt(
        string userId,
        string receiptId,
        string name,
        string mime,
        ReadOnlySpan<byte> content,
        DateTimeOffset createdAt
    )
    {
        var salt = RandomNumberGenerator.GetBytes(SaltBytes);
        var fileNonce = RandomNumberGenerator.GetBytes(NonceBytes);
        var nameNonce = RandomNumberGenerator.GetBytes(NonceBytes);
        var file = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(16));
        var key = DeriveKey(salt);
        try
        {
            var row = new Receipt
            {
                Id = receiptId,
                UserId = userId,
                StoragePath = file[..2] + "/" + file,
                EncryptionVersion = CurrentVersion,
                KeySalt = salt,
                FileNonce = fileNonce,
                NameNonce = nameNonce,
                NameEncrypted = Seal(
                    key,
                    nameNonce,
                    Encoding.UTF8.GetBytes(name),
                    Context("name", userId, receiptId)
                ),
                Mime = mime,
                SizeBytes = content.Length,
                CreatedAt = createdAt,
            };
            return new(row, Seal(key, fileNonce, content, Context("file", userId, receiptId)));
        }
        finally
        {
            CryptographicOperations.ZeroMemory(key);
        }
    }

    public async Task WriteAsync(EncryptedReceipt receipt, CancellationToken cancellationToken)
    {
        var path = FullPath(receipt.Row.StoragePath);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
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
                await stream.WriteAsync(receipt.Ciphertext, cancellationToken);
                stream.Flush(flushToDisk: true);
            }
            // Never replace an existing file; storage paths are unique and random.
            File.Move(temporary, path, overwrite: false);
        }
        catch
        {
            File.Delete(temporary);
            throw;
        }
    }

    public async Task<byte[]> ReadContentAsync(Receipt row, CancellationToken cancellationToken)
    {
        var ciphertext = await File.ReadAllBytesAsync(FullPath(row.StoragePath), cancellationToken);
        return Open(row, row.FileNonce, ciphertext, "file");
    }

    public string ReadName(Receipt row) =>
        Encoding.UTF8.GetString(Open(row, row.NameNonce, row.NameEncrypted, "name"));

    public void Delete(string storagePath) => File.Delete(FullPath(storagePath));

    // Every file in the two-level layout: stored receipts (`xx/<32 hex>`) and
    // temporary files a crash left behind (`xx/<32 hex>.tmp-<16 hex>`). Anything else
    // under the root is not the store's and is never listed or touched.
    public IEnumerable<ReceiptStoreFile> ListFiles()
    {
        if (!Directory.Exists(settings.Root))
            yield break;
        foreach (var directory in Directory.EnumerateDirectories(settings.Root))
        {
            var prefix = Path.GetFileName(directory);
            foreach (var path in Directory.EnumerateFiles(directory))
            {
                var relative = prefix + "/" + Path.GetFileName(path);
                var temporary = TemporaryPathPattern().IsMatch(relative);
                if (temporary || StoragePathPattern().IsMatch(relative))
                    yield return new(
                        relative,
                        temporary,
                        new DateTimeOffset(File.GetLastWriteTimeUtc(path), TimeSpan.Zero)
                    );
            }
        }
    }

    public void Delete(ReceiptStoreFile file)
    {
        if (
            !(file.Temporary ? TemporaryPathPattern() : StoragePathPattern()).IsMatch(
                file.StoragePath
            )
        )
            throw new InvalidOperationException("Receipt storage path is invalid.");
        File.Delete(Path.Combine(settings.Root, file.StoragePath));
    }

    private byte[] Open(Receipt row, byte[] nonce, byte[] sealedBytes, string part)
    {
        // Defense in depth: `ck_receipts_encryption_version` only admits 1 today, and a future
        // scheme relaxes that check in its migration. Never guess at a version this build lacks.
        if (row.EncryptionVersion != CurrentVersion)
            throw new CryptographicException("Receipt encryption version is not supported.");
        if (sealedBytes.Length < TagBytes)
            throw new CryptographicException("Receipt ciphertext is truncated.");
        var key = DeriveKey(row.KeySalt);
        try
        {
            var plain = new byte[sealedBytes.Length - TagBytes];
            using var aes = new AesGcm(key, TagBytes);
            aes.Decrypt(
                nonce,
                sealedBytes.AsSpan(0, plain.Length),
                sealedBytes.AsSpan(plain.Length),
                plain,
                Context(part, row.UserId, row.Id)
            );
            return plain;
        }
        finally
        {
            CryptographicOperations.ZeroMemory(key);
        }
    }

    private static byte[] Seal(byte[] key, byte[] nonce, ReadOnlySpan<byte> plain, byte[] context)
    {
        var output = new byte[plain.Length + TagBytes];
        using var aes = new AesGcm(key, TagBytes);
        aes.Encrypt(
            nonce,
            plain,
            output.AsSpan(0, plain.Length),
            output.AsSpan(plain.Length),
            context
        );
        return output;
    }

    private byte[] DeriveKey(byte[] salt) =>
        HKDF.DeriveKey(HashAlgorithmName.SHA256, settings.MasterKey, 32, salt, KeyInfo);

    // IDs never contain NUL (API validation), so the encoding is unambiguous.
    private static byte[] Context(string part, string userId, string receiptId) =>
        Encoding.UTF8.GetBytes($"penny/receipt/v1\0{part}\0{userId}\0{receiptId}");

    private string FullPath(string storagePath)
    {
        if (!StoragePathPattern().IsMatch(storagePath))
            throw new InvalidOperationException("Receipt storage path is invalid.");
        return Path.Combine(settings.Root, storagePath);
    }

    [GeneratedRegex("^[0-9a-f]{2}/[0-9a-f]{32}$", RegexOptions.CultureInvariant)]
    private static partial Regex StoragePathPattern();

    [GeneratedRegex(
        "^([0-9a-f]{2})/\\1[0-9a-f]{30}\\.tmp-[0-9a-f]{16}$",
        RegexOptions.CultureInvariant
    )]
    private static partial Regex TemporaryPathPattern();
}
