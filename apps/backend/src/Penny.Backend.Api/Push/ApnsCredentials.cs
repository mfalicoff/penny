using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace Penny.Backend.Api.Push;

// APNs token-based authentication (MAZ-61): the team id, the key id and the `.p8`
// ECDSA P-256 signing key from the Apple Developer account, and the app's bundle id
// as the topic. Set all of `Push__Apns__TeamId`, `Push__Apns__KeyId`,
// `Push__Apns__Topic` and exactly one of `Push__Apns__PrivateKeyPath` (a file, mode
// 0600) or `Push__Apns__PrivateKey` (the PEM text from a secret manager), or none of
// them (APNs deliveries then wait, as `apns:not-configured`, until they expire). The
// key is loaded and checked at startup and never logged; ToString hides it.
public sealed partial class ApnsCredentials : IDisposable
{
    private ApnsCredentials(string teamId, string keyId, string topic, ECDsa key)
    {
        TeamId = teamId;
        KeyId = keyId;
        Topic = topic;
        Key = key;
    }

    public string TeamId { get; }
    public string KeyId { get; }
    public string Topic { get; }
    internal ECDsa Key { get; }

    public static ApnsCredentials? Read(IConfiguration configuration)
    {
        var teamId = configuration["Push:Apns:TeamId"];
        var keyId = configuration["Push:Apns:KeyId"];
        var topic = configuration["Push:Apns:Topic"];
        var path = configuration["Push:Apns:PrivateKeyPath"];
        var pem = configuration["Push:Apns:PrivateKey"];
        if (teamId is null && keyId is null && topic is null && path is null && pem is null)
            return null;
        if (teamId is null || !AppleId().IsMatch(teamId))
            throw new InvalidOperationException(
                "Push:Apns:TeamId must be the 10-character Apple team id."
            );
        if (keyId is null || !AppleId().IsMatch(keyId))
            throw new InvalidOperationException(
                "Push:Apns:KeyId must be the 10-character APNs key id."
            );
        if (topic is null || !BundleId().IsMatch(topic))
            throw new InvalidOperationException("Push:Apns:Topic must be the iOS app's bundle id.");
        if ((path is null) == (pem is null))
            throw new InvalidOperationException(
                "Set exactly one of Push:Apns:PrivateKeyPath and Push:Apns:PrivateKey."
            );
        return Create(teamId, keyId, topic, path is null ? pem! : ReadKeyFile(path));
    }

    public static ApnsCredentials Create(string teamId, string keyId, string topic, string pem)
    {
        var key = ECDsa.Create();
        try
        {
            key.ImportFromPem(pem);
            if (key.KeySize != 256)
                throw new CryptographicException();
        }
        catch (Exception error) when (error is ArgumentException or CryptographicException)
        {
            key.Dispose();
            throw new InvalidOperationException(
                "The APNs private key must be the PEM text of an Apple .p8 (ECDSA P-256) key."
            );
        }
        return new(teamId, keyId, topic, key);
    }

    public void Dispose() => Key.Dispose();

    public override string ToString() => $"APNs key {KeyId} for team {TeamId}";

    private static string ReadKeyFile(string path)
    {
        if (!Path.IsPathFullyQualified(path))
            throw new InvalidOperationException(
                "Push:Apns:PrivateKeyPath must be an absolute path."
            );
        try
        {
            return File.ReadAllText(path);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            throw new InvalidOperationException(
                "Push:Apns:PrivateKeyPath cannot be read by this process."
            );
        }
    }

    [GeneratedRegex("^[A-Z0-9]{10}$")]
    private static partial Regex AppleId();

    [GeneratedRegex(@"^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$")]
    private static partial Regex BundleId();
}
