using System.Net;
using Penny.Backend.Api.Mail;
using Penny.Backend.Application.Authentication;
using Penny.Backend.Application.Mail;

namespace Penny.Backend.Api.Configuration;

// Optional email delivery (MAZ-124). Off unless `Email__Smtp__Host` is set; then the
// sender (`Email__From`) and the web app origin links point to (`Email__AppUrl`, one of
// `Auth__AllowedOrigins`) are required. Errors name the setting, never its value.
public sealed record EmailOptions(
    MailPolicy Policy,
    SmtpSettings? Smtp,
    bool Worker,
    int PollSeconds
)
{
    public static EmailOptions Read(IConfiguration configuration, AuthOptions auth)
    {
        var worker = configuration["Email:Worker"] switch
        {
            null or "true" => true,
            "false" => false,
            _ => throw new InvalidOperationException("Email__Worker must be true or false."),
        };
        var poll = BackendOptions.ReadBounded(configuration, "Email:PollSeconds", 10, 1, 3600);
        var host = configuration["Email:Smtp:Host"]?.Trim();
        if (string.IsNullOrEmpty(host))
        {
            foreach (var key in new[] { "Email:From", "Email:AppUrl", "Email:Smtp:Username", "Email:Smtp:Password" })
                if (!string.IsNullOrEmpty(configuration[key]))
                    throw new InvalidOperationException(
                        $"{Setting(key)} is set but Email__Smtp__Host is not. Set Email__Smtp__Host to turn email on, or remove the email settings."
                    );
            return new(MailPolicy.Off, null, worker, poll);
        }
        if (Uri.CheckHostName(host) == UriHostNameType.Unknown)
            throw new InvalidOperationException("Email__Smtp__Host must be a host name or IP address.");
        var security = configuration["Email:Smtp:Security"]?.Trim().ToLowerInvariant() switch
        {
            null or "" or "starttls" => SmtpSecurity.StartTls,
            "tls" => SmtpSecurity.Tls,
            "none" => SmtpSecurity.None,
            _ => throw new InvalidOperationException(
                "Email__Smtp__Security must be starttls, tls or none."
            ),
        };
        if (security == SmtpSecurity.None && !IsLoopback(host))
            throw new InvalidOperationException(
                "Email__Smtp__Security=none is only allowed for a loopback Email__Smtp__Host. Use starttls or tls."
            );
        var port = BackendOptions.ReadBounded(
            configuration,
            "Email:Smtp:Port",
            security switch
            {
                SmtpSecurity.Tls => 465,
                SmtpSecurity.None => 25,
                _ => 587,
            },
            1,
            65535
        );
        var username = Optional(configuration["Email:Smtp:Username"]);
        // Passwords are used exactly as given.
        var password = configuration["Email:Smtp:Password"] is { Length: > 0 } secret ? secret : null;
        if ((username is null) != (password is null))
            throw new InvalidOperationException(
                "Set both Email__Smtp__Username and Email__Smtp__Password, or neither."
            );
        var from = Credentials.NormalizeEmail(configuration["Email:From"])
            ?? throw new InvalidOperationException(
                "Email__From must be the sender's email address, such as penny@example.com."
            );
        var fromName = Optional(configuration["Email:FromName"]) ?? "Penny";
        if (fromName.Length > 100 || fromName.Any(char.IsControl))
            throw new InvalidOperationException(
                "Email__FromName must be at most 100 characters on one line."
            );
        var appUrl = Optional(configuration["Email:AppUrl"])?.TrimEnd('/')
            ?? throw new InvalidOperationException(
                "Email__AppUrl must be the web app's origin, such as https://penny.example.com."
            );
        if (!auth.AllowedOrigins.Contains(appUrl, StringComparer.Ordinal))
            throw new InvalidOperationException(
                "Email__AppUrl must be one of Auth__AllowedOrigins, so emailed links open the web app this server trusts."
            );
        var timeout = BackendOptions.ReadBounded(configuration, "Email:Smtp:TimeoutSeconds", 30, 5, 300);
        var policy = new MailPolicy(
            true,
            appUrl,
            TimeSpan.FromHours(BackendOptions.ReadBounded(configuration, "Email:InviteHours", 72, 1, 336)),
            BackendOptions.ReadBounded(configuration, "Email:RecipientMessagesPerDay", 5, 1, 1000),
            BackendOptions.ReadBounded(configuration, "Email:AccountMessagesPerDay", 20, 1, 10_000)
        );
        return new(
            policy,
            new SmtpSettings(
                host,
                port,
                security,
                username,
                password,
                from,
                fromName,
                TimeSpan.FromSeconds(timeout)
            ),
            worker,
            poll
        );
    }

    private static string? Optional(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static string Setting(string key) => key.Replace(":", "__", StringComparison.Ordinal);

    private static bool IsLoopback(string host) =>
        host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
        || (IPAddress.TryParse(host, out var address) && IPAddress.IsLoopback(address));
}
