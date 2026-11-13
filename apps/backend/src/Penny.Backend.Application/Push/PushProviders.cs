namespace Penny.Backend.Application.Push;

// Stored provider and environment names (`push_devices.provider/environment`).
public static class PushProviders
{
    // The legacy Expo Push Service transport; retired only after the migration gates
    // in docs/migration/push.md.
    public const string Expo = "expo";

    // Native Apple Push Notification service.
    public const string Apns = "apns";

    public const string Sandbox = "sandbox";
    public const string Production = "production";
}
