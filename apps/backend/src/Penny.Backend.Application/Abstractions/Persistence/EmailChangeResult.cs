namespace Penny.Backend.Application.Abstractions.Persistence;

// The outcome of IAccountRepository.TryChangeEmailAsync (MAZ-172).
public enum EmailChangeResult
{
    Changed,

    // The password hash changed meanwhile (a concurrent password change won).
    Stale,

    // Another account already uses the new email.
    Duplicate,
}
