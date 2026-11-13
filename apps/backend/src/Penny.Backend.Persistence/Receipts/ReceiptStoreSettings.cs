namespace Penny.Backend.Persistence.Receipts;

public sealed class ReceiptStoreSettings
{
    public const int MasterKeyBytes = 32;

    private ReceiptStoreSettings(string root, byte[] masterKey)
    {
        Root = root;
        MasterKey = masterKey;
    }

    public string Root { get; }
    internal byte[] MasterKey { get; }

    public static ReceiptStoreSettings Create(string? root, string? masterKey)
    {
        if (string.IsNullOrWhiteSpace(root) || !Path.IsPathFullyQualified(root))
            throw new InvalidOperationException(
                "Set Receipts__Root to an absolute directory for encrypted receipt files."
            );
        byte[] key;
        try
        {
            key = Convert.FromBase64String(masterKey ?? "");
        }
        catch (FormatException)
        {
            key = [];
        }
        if (key.Length != MasterKeyBytes)
            throw new InvalidOperationException(
                "Set Receipts__MasterKey to a base64-encoded 32-byte key."
            );
        return new ReceiptStoreSettings(Path.GetFullPath(root), key);
    }

    public override string ToString() => "Receipt store settings (key redacted)";
}
