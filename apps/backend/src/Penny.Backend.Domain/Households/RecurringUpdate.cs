namespace Penny.Backend.Domain.Households;

// The legacy shared rule update body: the rule fields, whether it is active and the
// revision the client edited.
public sealed record RecurringUpdate(RecurringInput Input, bool Active, long Revision);
