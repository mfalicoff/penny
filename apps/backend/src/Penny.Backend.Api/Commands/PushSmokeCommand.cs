using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging.Abstractions;
using Penny.Backend.Api.Push;
using Penny.Backend.Application.Push;

namespace Penny.Backend.Api.Commands;

// `push-smoke-apns TOKEN sandbox|production` (MAZ-61): the physical-device APNs smoke
// test. Sends one synthetic household notification to a device token with the
// configured `Push__Apns__*` credentials, without the database or HTTP host, and
// prints the redacted outcome (`accepted` or a reason code such as
// `apns:400:BadDeviceToken`). Exit 0 when APNs accepted it, 2 when it refused, 1 on
// usage or configuration errors. The token is never printed. See
// docs/reference/push.md#physical-device-smoke-test.
internal static partial class PushSmokeCommand
{
    public const string Name = "push-smoke-apns";

    public static async Task<int> RunAsync(string[] args, IConfiguration configuration)
    {
        if (
            args is not [Name, var token, var environment]
            || !Token().IsMatch(token)
            || environment is not (PushProviders.Sandbox or PushProviders.Production)
        )
        {
            Console.Error.WriteLine(
                "Usage: push-smoke-apns DEVICE_TOKEN_HEX sandbox|production. See docs/reference/push.md."
            );
            return 1;
        }
        ApnsCredentials? credentials;
        try
        {
            credentials = ApnsCredentials.Read(configuration);
        }
        catch (InvalidOperationException error)
        {
            Console.Error.WriteLine(error.Message);
            return 1;
        }
        if (credentials is null)
        {
            Console.Error.WriteLine("Set Push__Apns__TeamId, KeyId, Topic and PrivateKeyPath.");
            return 1;
        }
        using (credentials)
        using (
            var http = new HttpClient(new SocketsHttpHandler { AllowAutoRedirect = false })
            {
                Timeout = TimeSpan.FromSeconds(10),
                DefaultRequestVersion = System.Net.HttpVersion.Version20,
                DefaultVersionPolicy = HttpVersionPolicy.RequestVersionExact,
            }
        )
        {
            var transport = new ApnsTransport(
                http,
                credentials,
                new ApnsProviderToken(credentials, TimeProvider.System),
                NullLogger<ApnsTransport>.Instance
            );
            var now = DateTimeOffset.UtcNow;
            var smoke = Guid.NewGuid().ToString("N");
            var outcome = (
                await transport.SendAsync(
                    [
                        new PushMessage(
                            smoke,
                            token.ToLowerInvariant(),
                            environment,
                            "Penny push test",
                            "If you can read this, APNs delivery works.",
                            new PushPayload(
                                "smoke-test",
                                now.ToString(
                                    "yyyy-MM",
                                    System.Globalization.CultureInfo.InvariantCulture
                                ),
                                null,
                                smoke
                            ),
                            now.AddMinutes(10)
                        ),
                    ],
                    CancellationToken.None
                )
            )[0];
            Console.WriteLine(
                outcome.Kind == PushOutcomeKind.Accepted ? "accepted" : outcome.Reason
            );
            return outcome.Kind == PushOutcomeKind.Accepted ? 0 : 2;
        }
    }

    [GeneratedRegex("^(?:[0-9A-Fa-f]{2}){32,100}$")]
    private static partial Regex Token();
}
