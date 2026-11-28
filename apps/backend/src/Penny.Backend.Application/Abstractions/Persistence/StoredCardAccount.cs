namespace Penny.Backend.Application.Abstractions.Persistence;

// A Wallet card name and the personal account its purchases are added to (MAZ-291).
public sealed record StoredCardAccount(string Card, string AccountId);
