namespace Penny.Backend.Persistence.Schema.Entities;

// A session-scoped push registration: a native iOS hex device token (`Provider` is
// `apns`) and the APNs gateway that issued it (`Environment` is `sandbox` or
// `production`). MAZ-61.
public sealed class PushDevice
{
    public required string Token { get; set; }
    public required string UserId { get; set; }
    public required string SessionHash { get; set; }
    public required string Platform { get; set; }
    public required string Provider { get; set; }
    public required string Environment { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
