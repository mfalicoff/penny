namespace Penny.Backend.Persistence.Schema.Entities;

public sealed class User
{
    public required string Id { get; set; }
    public required string Email { get; set; }
    public required string Password { get; set; }

    // Profile (MAZ-171). Display only: identity stays the id (and issuer plus subject).
    public string? DisplayName { get; set; }

    // A sign-in provider sends the name or the picture, so the person can't change it.
    public bool NameFromProvider { get; set; }
    public bool AvatarFromProvider { get; set; }

    // The person skipped the apps' "What should people call you?" prompt.
    public bool NamePromptDismissed { get; set; }

    // Changes with every picture (null: no picture), so picture URLs can be cached.
    public string? AvatarVersion { get; set; }

    // SHA-256 of the provider picture URL the stored picture was copied from.
    public byte[]? AvatarSourceHash { get; set; }

    // When the password last changed (signed-in change or operator reset); null before the
    // first change.
    public DateTimeOffset? PasswordChangedAt { get; set; }

    // When the account's current email was proven (MAZ-172): an emailed link was opened, the
    // sign-in provider said so, or an operator marked it. Null while unverified; an email
    // change clears it.
    public DateTimeOffset? EmailVerifiedAt { get; set; }

    // When the person deleted their account (MAZ-152). The row stays as a tombstone so
    // shared expenses, splits and payments keep their member: its email is replaced, its
    // password and profile cleared, and every personal row is deleted.
    public DateTimeOffset? DeletedAt { get; set; }
}
