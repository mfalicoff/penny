using System.Security.Cryptography;
using Penny.Backend.Api.Push;
using Penny.Backend.Application.Push;

namespace Penny.Backend.UnitTests.Push;

// Synthetic tokens, messages and a throwaway APNs key; no real credentials.
internal static class PushSamples
{
    public const string ApnsToken =
        "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
    public static readonly DateTimeOffset Now = new(2026, 9, 28, 12, 0, 0, TimeSpan.Zero);

    public static PushMessage Message(
        string token = ApnsToken,
        string environment = PushProviders.Production,
        string outboxId = "0123456789abcdef0123456789abcdef"
    ) =>
        new(
            outboxId,
            token,
            environment,
            "New household expense",
            "A member added an expense. Open Penny to see your share.",
            new PushPayload("home", "2026-09", "expense-1", "event-1"),
            Now.AddHours(24)
        );

    public static ApnsCredentials Credentials(out ECDsa publicKey)
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        publicKey = ECDsa.Create(key.ExportParameters(false));
        return ApnsCredentials.Create(
            "TEAM123456",
            "KEY1234567",
            "org.example.penny",
            key.ExportPkcs8PrivateKeyPem()
        );
    }
}
