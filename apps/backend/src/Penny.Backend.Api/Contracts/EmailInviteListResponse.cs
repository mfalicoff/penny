namespace Penny.Backend.Api.Contracts;

// Contract schema `EmailInviteList`: newest request first.
public sealed record EmailInviteListResponse(IReadOnlyList<EmailInviteResponse> Items);
