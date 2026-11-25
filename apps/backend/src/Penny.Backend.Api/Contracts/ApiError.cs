namespace Penny.Backend.Api.Contracts;

// Every API error (MAZ-187): `Error` is the English message clients have always shown,
// `Code` the stable machine-readable name from `ErrorCodes` to branch on.
public sealed record ApiError(string Error, string Code);
