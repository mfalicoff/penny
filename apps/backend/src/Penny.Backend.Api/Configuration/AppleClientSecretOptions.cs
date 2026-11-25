using System.Security.Cryptography;

namespace Penny.Backend.Api.Configuration;

// Sign in with Apple has no fixed client secret: the server signs a short-lived ES256 JWT with
// the operator's private key (MAZ-170). `TeamId` and `KeyId` come from the Apple developer
// account; the key is the `.p8` file's PEM text, given inline (`PrivateKey`) or as a path
// (`PrivateKeyFile`, for container or systemd secrets). The key text is never logged.
public sealed record AppleClientSecretOptions(
    string TeamId,
    string KeyId,
    string ClientId,
    string PrivateKeyPem
)
{
    public override string ToString() => "Apple client secret options (private key redacted)";

    public static AppleClientSecretOptions? Read(
        IConfiguration section,
        string prefix,
        string clientId
    )
    {
        var teamId = OidcProviderOptions.Value(section, "TeamId");
        var keyId = OidcProviderOptions.Value(section, "KeyId");
        var inline = OidcProviderOptions.Value(section, "PrivateKey");
        var file = OidcProviderOptions.Value(section, "PrivateKeyFile");
        if (teamId is null && keyId is null && inline is null && file is null)
            return null;
        if (teamId is null || keyId is null || (inline is null) == (file is null))
            throw new InvalidOperationException(
                $"{prefix}:TeamId, {prefix}:KeyId and one of {prefix}:PrivateKey or {prefix}:PrivateKeyFile are required to generate the Apple client secret."
            );
        if (!IsAppleId(teamId) || !IsAppleId(keyId))
            throw new InvalidOperationException(
                $"{prefix}:TeamId and {prefix}:KeyId must be the 10-character identifiers from the Apple developer account."
            );
        string pem;
        try
        {
            pem = inline ?? File.ReadAllText(file!);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            throw new InvalidOperationException($"{prefix}:PrivateKeyFile could not be read.");
        }
        // Environment variables often carry the PEM on one line with literal \n.
        pem = pem.Replace("\\n", "\n", StringComparison.Ordinal);
        try
        {
            using var key = ECDsa.Create();
            key.ImportFromPem(pem);
            if (key.KeySize != 256)
                throw new CryptographicException();
        }
        catch (Exception error) when (error is CryptographicException or ArgumentException)
        {
            throw new InvalidOperationException(
                $"{prefix}:PrivateKey must be the PEM text of an Apple P-256 private key (.p8)."
            );
        }
        return new(teamId, keyId, clientId, pem);
    }

    private static bool IsAppleId(string value) =>
        value.Length == 10 && value.All(char.IsAsciiLetterOrDigit);
}
