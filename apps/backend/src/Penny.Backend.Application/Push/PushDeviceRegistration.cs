namespace Penny.Backend.Application.Push;

// A validated device: a lower-case hex APNs token and the APNs `Environment`
// (`sandbox` or `production`) that issued it.
public sealed record PushDeviceRegistration(
    string Token,
    string Platform,
    string Provider,
    string Environment
);
