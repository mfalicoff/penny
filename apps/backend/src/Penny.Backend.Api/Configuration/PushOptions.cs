using Penny.Backend.Api.Push;

namespace Penny.Backend.Api.Configuration;

// Push delivery settings (MAZ-61). `Push__Worker=false` stops this process from
// delivering the outbox (any number of processes may; leases keep them apart).
// `Push__PollSeconds` is the idle delay between passes (legacy: 15 seconds).
// `Push__Expo__Enabled=false` retires the legacy Expo transport after the migration
// gates. APNs is configured by `Push__Apns__*` (all or none; see ApnsCredentials).
public sealed record PushOptions(
    bool Worker,
    int PollSeconds,
    bool ExpoEnabled,
    ApnsCredentials? Apns
)
{
    public static PushOptions Read(IConfiguration configuration) =>
        new(
            Flag(configuration, "Push:Worker"),
            BackendOptions.ReadBounded(configuration, "Push:PollSeconds", 15, 1, 3600),
            Flag(configuration, "Push:Expo:Enabled"),
            ApnsCredentials.Read(configuration)
        );

    private static bool Flag(IConfiguration configuration, string key) =>
        configuration[key] switch
        {
            null => true,
            "true" => true,
            "false" => false,
            _ => throw new InvalidOperationException($"{key} must be true or false."),
        };
}
