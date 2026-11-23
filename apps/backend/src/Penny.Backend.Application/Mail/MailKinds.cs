namespace Penny.Backend.Application.Mail;

// The emails Penny sends (MAZ-124); stored in `mail_outbox.kind`.
public static class MailKinds
{
    public const string PasswordReset = "password-reset";
    public const string HouseholdInvite = "household-invite";

    // MAZ-172: a link that proves the account's email address.
    public const string EmailVerification = "email-verification";
}
