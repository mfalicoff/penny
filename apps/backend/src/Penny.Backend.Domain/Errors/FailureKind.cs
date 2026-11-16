namespace Penny.Backend.Domain.Errors;

public enum FailureKind
{
    Invalid,
    Unauthorized,
    Forbidden,
    NotFound,
    Conflict,

    // A dependency did not answer in time (search statement timeout): 503, retry.
    Unavailable,

    // A per-user limit was reached (receipt address creation): 429.
    RateLimited,
}
