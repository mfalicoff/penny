namespace Penny.Backend.Domain;

public enum FailureKind
{
    Invalid,
    Unauthorized,
    Forbidden,
    NotFound,
    Conflict,
}

// Only intentional, public messages belong here. Never wrap database exceptions.
public sealed class BackendFailure(FailureKind kind, string message) : Exception(message)
{
    public FailureKind Kind { get; } = kind;
}
