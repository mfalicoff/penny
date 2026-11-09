namespace Penny.Backend.Application.Push;

// One delivery taken for sending: the device's current transport and the attempt
// number this send counts as.
public sealed record PushDispatch(
    string OutboxId,
    string Token,
    string Provider,
    string? Environment,
    int Attempts
);
