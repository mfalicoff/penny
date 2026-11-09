namespace Penny.Backend.Application.Push;

// `ExpoEnabled=false` retires the legacy Expo transport: Expo registrations are
// refused and pending Expo deliveries finish undelivered (docs/migration/push.md).
public sealed record PushSettings(bool ExpoEnabled);
