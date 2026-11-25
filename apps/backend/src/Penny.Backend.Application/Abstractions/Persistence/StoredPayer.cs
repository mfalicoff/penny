namespace Penny.Backend.Application.Abstractions.Persistence;

// Who paid a shared expense or rule, as the household's members see them (MAZ-171):
// their email and display name (when they set one). `Deleted` (MAZ-152): the person
// deleted their account, so clients show "Former member" and nothing else.
public sealed record StoredPayer(string Email, string? DisplayName, bool Deleted);
