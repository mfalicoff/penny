namespace Penny.Backend.Persistence.Schema.Entities;

// A session-scoped push registration. `Provider` is `expo` (legacy Expo push token,
// `Environment` null) or `apns` (native hex device token; `Environment` is `sandbox`
// or `production`, the APNs gateway that issued it). MAZ-61.
public sealed class PushDevice
{
    public required string Token { get; set; }
    public required string UserId { get; set; }
    public required string SessionHash { get; set; }
    public required string Platform { get; set; }
    public string Provider { get; set; } = "expo";
    public string? Environment { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
