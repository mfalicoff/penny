using System.Text;

namespace Penny.Backend.Application.Mail;

// Plain-text templates in English and French (MAZ-124). They carry no financial data:
// a password reset names only the server; an invitation names the household or trip
// and the inviter's display name. Links are built from the configured app origin only,
// and codes travel in the URL fragment, which browsers never send to a server or put in
// a Referer header.
public static class MailTemplates
{
    public const string ResetPath = "/reset-password#code=";
    public const string JoinPath = "/join#code=";
    public const string VerifyPath = "/verify-email#code=";

    public static (string Subject, string Text) PasswordReset(
        string locale,
        string appUrl,
        string token,
        TimeSpan lifetime
    )
    {
        var host = Host(appUrl);
        var link = appUrl + ResetPath + token;
        var hours = Hours(lifetime);
        return locale == MailLocales.French
            ? (
                "Réinitialiser votre mot de passe Penny",
                Lines(
                    $"Quelqu'un a demandé à réinitialiser le mot de passe de votre compte Penny sur {host}.",
                    "",
                    $"Choisissez un nouveau mot de passe avec ce lien. Il fonctionne une seule fois, pendant {hours} {Plural(hours, "heure", "heures")} :",
                    link,
                    "",
                    "Vous serez ensuite déconnecté de tous vos appareils.",
                    "Si vous n'avez rien demandé, ignorez ce courriel : votre mot de passe ne change pas.",
                    "",
                    $"Penny · {host}"
                )
            )
            : (
                "Reset your Penny password",
                Lines(
                    $"Someone asked to reset the password of your Penny account on {host}.",
                    "",
                    $"Choose a new password with this link. It works once, for {hours} {Plural(hours, "hour", "hours")}:",
                    link,
                    "",
                    "Every device signed in to your account is then signed out.",
                    "If you didn't ask, ignore this email. Your password stays the same.",
                    "",
                    $"Penny · {host}"
                )
            );
    }

    // MAZ-172: proves the address. It names only the server, like a password reset.
    public static (string Subject, string Text) EmailVerification(
        string locale,
        string appUrl,
        string token,
        TimeSpan lifetime
    )
    {
        var host = Host(appUrl);
        var link = appUrl + VerifyPath + token;
        var hours = Hours(lifetime);
        return locale == MailLocales.French
            ? (
                "Confirmez votre adresse courriel pour Penny",
                Lines(
                    $"Confirmez que cette adresse est bien la vôtre pour votre compte Penny sur {host}.",
                    "",
                    $"Ouvrez ce lien pour la confirmer. Il fonctionne une seule fois, pendant {hours} {Plural(hours, "heure", "heures")} :",
                    link,
                    "",
                    "Si vous n'avez pas créé de compte Penny, ignorez ce courriel.",
                    "",
                    $"Penny · {host}"
                )
            )
            : (
                "Verify your email for Penny",
                Lines(
                    $"Confirm that this address is yours for your Penny account on {host}.",
                    "",
                    $"Open this link to verify it. It works once, for {hours} {Plural(hours, "hour", "hours")}:",
                    link,
                    "",
                    "If you didn't create a Penny account, ignore this email.",
                    "",
                    $"Penny · {host}"
                )
            );
    }

    public static (string Subject, string Text) HouseholdInvite(
        string locale,
        string appUrl,
        string code,
        TimeSpan lifetime,
        string householdName,
        bool trip,
        string? inviterName
    )
    {
        var host = Host(appUrl);
        var link = appUrl + JoinPath + code;
        var name = OneLine(householdName);
        var inviter = inviterName is { Length: > 0 } ? OneLine(inviterName) : null;
        var days = Math.Max(1, (int)Math.Round(lifetime.TotalDays));
        var formatted = $"{code[..5]} {code[5..]}";
        if (locale == MailLocales.French)
        {
            var what = trip ? $"au voyage « {name} »" : $"au foyer « {name} »";
            return (
                inviter is null
                    ? $"Invitation {what} sur Penny"
                    : $"{inviter} vous invite {what} sur Penny",
                Lines(
                    inviter is null
                        ? $"Vous êtes invité {what} sur Penny ({host})."
                        : $"{inviter} vous invite {what} sur Penny ({host}).",
                    "",
                    "Ouvrez ce lien pour rejoindre. Connectez-vous ou créez un compte, puis acceptez l'invitation :",
                    link,
                    "",
                    $"Ou entrez ce code d'invitation dans Penny : {formatted}. Il fonctionne une seule fois, pendant {days} {Plural(days, "jour", "jours")}.",
                    "",
                    "Si vous ne connaissez pas la personne qui vous invite, ignorez ce courriel.",
                    "",
                    $"Penny · {host}"
                )
            );
        }
        var target = trip ? $"the trip \"{name}\"" : $"the household \"{name}\"";
        return (
            inviter is null
                ? $"You're invited to {name} on Penny"
                : $"{inviter} invited you to {name} on Penny",
            Lines(
                inviter is null
                    ? $"You're invited to join {target} on Penny ({host})."
                    : $"{inviter} invited you to join {target} on Penny ({host}).",
                "",
                "Open this link to join. Sign in or create an account, then accept the invitation:",
                link,
                "",
                $"Or enter this invite code in Penny: {formatted}. It works once, for {days} {Plural(days, "day", "days")}.",
                "",
                "If you don't know who invited you, ignore this email.",
                "",
                $"Penny · {host}"
            )
        );
    }

    // Names come from users; a line break or control character could forge headers or
    // lines, so each becomes a space.
    public static string OneLine(string value)
    {
        var builder = new StringBuilder(value.Length);
        foreach (var character in value)
            builder.Append(char.IsControl(character) ? ' ' : character);
        return builder.ToString().Trim();
    }

    private static string Host(string appUrl) => new Uri(appUrl).Authority;

    private static int Hours(TimeSpan lifetime) =>
        Math.Max(1, (int)Math.Round(lifetime.TotalHours));

    private static string Plural(int count, string one, string many) => count == 1 ? one : many;

    private static string Lines(params string[] lines) => string.Join("\n", lines) + "\n";
}
