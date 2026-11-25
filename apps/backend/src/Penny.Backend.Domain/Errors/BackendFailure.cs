namespace Penny.Backend.Domain.Errors;

// Only intentional, public messages belong here. Never wrap database exceptions.
// `Code` is the stable machine-readable name from `ErrorCodes` (MAZ-187); `Message`
// stays the English text older clients show.
public sealed class BackendFailure(FailureKind kind, string code, string message)
    : Exception(message)
{
    public FailureKind Kind { get; } = kind;

    public string Code { get; } = code;
}
