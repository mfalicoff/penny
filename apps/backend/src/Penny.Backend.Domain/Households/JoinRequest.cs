namespace Penny.Backend.Domain.Households;

// `Code` is already upper-cased: invite codes are hashed in their upper-case form.
public sealed record JoinRequest(string Code, int? TimezoneOffsetMinutes);
