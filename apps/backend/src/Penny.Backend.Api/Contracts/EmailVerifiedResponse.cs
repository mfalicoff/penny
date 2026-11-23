namespace Penny.Backend.Api.Contracts;

// Contract schema `EmailVerified` (MAZ-172): the address an emailed link just verified.
public sealed record EmailVerifiedResponse(string Email);
