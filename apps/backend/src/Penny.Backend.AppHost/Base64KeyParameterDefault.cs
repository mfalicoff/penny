using System.Security.Cryptography;
using Aspire.Hosting.ApplicationModel;
using Aspire.Hosting.Publishing;

namespace Penny.Backend.AppHost;

// Generates a base64 key of random bytes (the receipt master key is 32 bytes). Aspire's own
// GenerateParameterDefault produces characters, not encoded bytes. Used only in run mode.
public sealed class Base64KeyParameterDefault(int bytes) : ParameterDefault
{
    public override string GetDefaultValue() =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(bytes));

    public override void WriteToManifest(ManifestPublishingContext context) =>
        throw new NotSupportedException("The AppHost is for local development only.");
}
