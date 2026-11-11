using System.Security.Cryptography;
using System.Text;
using Penny.Backend.Persistence.Receipts;
using Penny.Backend.Persistence.Schema.Entities;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Receipts;

// The encrypted receipt store (MAZ-52, MAZ-94): AES-256-GCM under a per-file HKDF key,
// with associated data binding each file and name to its owner and receipt id.
public sealed class ReceiptFileStoreTests : IDisposable
{
    private static readonly byte[] Content = Encoding.ASCII.GetBytes(
        "%PDF-1.4\nsynthetic receipt for tests\n%%EOF\n"
    );

    private readonly string root = Path.Combine(
        Path.GetTempPath(),
        "penny-receipt-store-" + Guid.NewGuid().ToString("N")
    );
    private readonly ReceiptFileStore store;

    public ReceiptFileStoreTests()
    {
        store = new ReceiptFileStore(
            ReceiptStoreSettings.Create(root, Convert.ToBase64String(new byte[32]))
        );
    }

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public void Dispose()
    {
        if (Directory.Exists(root))
            Directory.Delete(root, recursive: true);
    }

    [Fact]
    public async Task whenReceiptWrittenAndRead_RoundTrip_ShouldReturnTheOriginalBytesAndName()
    {
        var sealedReceipt = Seal("user-1", "receipt-1");
        await store.WriteAsync(sealedReceipt, Ct);

        var row = sealedReceipt.Row;
        row.EncryptionVersion.ShouldBe(ReceiptFileStore.CurrentVersion);
        (await store.ReadContentAsync(row, Ct)).ShouldBe(Content);
        store.ReadName(row).ShouldBe("Café receipt.pdf");
        var onDisk = await File.ReadAllBytesAsync(Path.Combine(root, row.StoragePath), Ct);
        onDisk.Length.ShouldBe(Content.Length + 16);
        onDisk.AsSpan().IndexOf("synthetic"u8).ShouldBe(-1);
    }

    [Fact]
    public void whenSameBytesSealedTwice_Encrypt_ShouldUseFreshSaltsNoncesAndPaths()
    {
        var first = Seal("user-1", "receipt-1");
        var second = Seal("user-1", "receipt-1");

        second.Row.KeySalt.ShouldNotBe(first.Row.KeySalt);
        second.Row.FileNonce.ShouldNotBe(first.Row.FileNonce);
        second.Row.StoragePath.ShouldNotBe(first.Row.StoragePath);
        second.Ciphertext.ShouldNotBe(first.Ciphertext);
    }

    [Fact]
    public async Task whenCiphertextTampered_ReadContent_ShouldFailAuthentication()
    {
        var sealedReceipt = Seal("user-1", "receipt-1");
        await store.WriteAsync(sealedReceipt, Ct);
        var path = Path.Combine(root, sealedReceipt.Row.StoragePath);
        var bytes = await File.ReadAllBytesAsync(path, Ct);
        bytes[3] ^= 0x01;
        await File.WriteAllBytesAsync(path, bytes, Ct);

        await Should.ThrowAsync<CryptographicException>(() =>
            store.ReadContentAsync(sealedReceipt.Row, Ct)
        );
    }

    [Fact]
    public async Task whenRowClaimsAnotherOwnerOrId_ReadContent_ShouldFailAuthentication()
    {
        var sealedReceipt = Seal("user-1", "receipt-1");
        await store.WriteAsync(sealedReceipt, Ct);

        foreach (
            var row in new[]
            {
                With(sealedReceipt.Row, userId: "user-2"),
                With(sealedReceipt.Row, id: "receipt-2"),
            }
        )
        {
            await Should.ThrowAsync<CryptographicException>(() => store.ReadContentAsync(row, Ct));
            Should.Throw<CryptographicException>(() => store.ReadName(row));
        }
    }

    [Fact]
    public async Task whenFilesSwappedBetweenRows_ReadContent_ShouldFailAuthentication()
    {
        var mine = Seal("user-1", "receipt-1");
        var theirs = Seal("user-2", "receipt-2");
        await store.WriteAsync(mine, Ct);
        await store.WriteAsync(theirs, Ct);

        // Their file under my row, and their key material relabelled as mine: both fail.
        var swapped = With(mine.Row, storagePath: theirs.Row.StoragePath);
        var relabelled = With(theirs.Row, userId: "user-1", id: "receipt-1");
        await Should.ThrowAsync<CryptographicException>(() =>
            store.ReadContentAsync(relabelled, Ct)
        );
        await Should.ThrowAsync<CryptographicException>(() => store.ReadContentAsync(swapped, Ct));
    }

    [Fact]
    public async Task whenMasterKeyDiffers_ReadContent_ShouldFailAuthentication()
    {
        var sealedReceipt = Seal("user-1", "receipt-1");
        await store.WriteAsync(sealedReceipt, Ct);
        var other = new ReceiptFileStore(
            ReceiptStoreSettings.Create(
                root,
                Convert.ToBase64String(Enumerable.Repeat((byte)7, 32).ToArray())
            )
        );

        await Should.ThrowAsync<CryptographicException>(() =>
            other.ReadContentAsync(sealedReceipt.Row, Ct)
        );
    }

    [Fact]
    public async Task whenEncryptionVersionUnknown_ReadContent_ShouldRefuseToOpen()
    {
        var sealedReceipt = Seal("user-1", "receipt-1");
        await store.WriteAsync(sealedReceipt, Ct);
        var row = With(sealedReceipt.Row);
        row.EncryptionVersion = 2;

        await Should.ThrowAsync<CryptographicException>(() => store.ReadContentAsync(row, Ct));
        Should.Throw<CryptographicException>(() => store.ReadName(row));
    }

    private EncryptedReceipt Seal(string userId, string receiptId) =>
        store.Encrypt(
            userId,
            receiptId,
            "Café receipt.pdf",
            "application/pdf",
            Content,
            DateTimeOffset.UnixEpoch
        );

    private static Receipt With(
        Receipt row,
        string? userId = null,
        string? id = null,
        string? storagePath = null
    ) =>
        new()
        {
            Id = id ?? row.Id,
            UserId = userId ?? row.UserId,
            StoragePath = storagePath ?? row.StoragePath,
            EncryptionVersion = row.EncryptionVersion,
            KeySalt = row.KeySalt,
            FileNonce = row.FileNonce,
            NameNonce = row.NameNonce,
            NameEncrypted = row.NameEncrypted,
            Mime = row.Mime,
            SizeBytes = row.SizeBytes,
            CreatedAt = row.CreatedAt,
        };
}
