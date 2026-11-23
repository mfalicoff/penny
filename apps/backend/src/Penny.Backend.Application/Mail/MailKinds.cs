namespace Penny.Backend.Application.Mail;

// The emails Penny sends (MAZ-124); stored in `mail_outbox.kind`.
public static class MailKinds
{
    public const string PasswordReset = "password-reset";
    public const string HouseholdInvite = "household-invite";
}
