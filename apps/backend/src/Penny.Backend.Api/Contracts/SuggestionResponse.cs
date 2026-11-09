namespace Penny.Backend.Api.Contracts;

// Contract schema `Suggestion`: one full transfer from a debtor to a creditor.
public sealed record SuggestionResponse(string FromUserId, string ToUserId, long AmountCents);
