namespace Penny.Backend.Api.Contracts;

// Contract schema `CardAccount` (2.5.0): a Wallet card name and the personal account its
// purchases are added to.
public sealed record CardAccountResponse(string Card, string AccountId);
