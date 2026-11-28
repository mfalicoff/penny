namespace Penny.Backend.Api.Contracts;

// Contract schema `CardAccounts` (2.5.0): the whole card mapping, by card name.
public sealed record CardAccountsResponse(IReadOnlyList<CardAccountResponse> Cards);
