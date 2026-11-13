namespace Penny.Backend.Application.Push;

// Stored provider and environment names (`push_devices.provider/environment`).
public static class PushProviders
{
    // Native Apple Push Notification service, the only provider.
    public const string Apns = "apns";

    public const string Sandbox = "sandbox";
    public const string Production = "production";
}
