namespace Penny.Backend.Api.Contracts;

// The lowercase `{household}` envelope of create, join, rename and trip updates.
public sealed record HouseholdEnvelopeResponse(HouseholdResponse Household);
