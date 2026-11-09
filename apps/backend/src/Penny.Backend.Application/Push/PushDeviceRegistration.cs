namespace Penny.Backend.Application.Push;

// A validated device: Expo tokens have no environment; APNs tokens are lower-case hex.
public sealed record PushDeviceRegistration(
    string Token,
    string Platform,
    string Provider,
    string? Environment
);
