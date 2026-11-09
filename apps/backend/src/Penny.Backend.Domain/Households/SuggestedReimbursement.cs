namespace Penny.Backend.Domain.Households;

// One full transfer that settles part of a month: the debtor pays the creditor.
public sealed record SuggestedReimbursement(string FromUserId, string ToUserId, long AmountCents);
