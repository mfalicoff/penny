namespace Penny.Backend.Application.Abstractions.InboundMail;

// SPF, DKIM and DMARC results recorded by Penny's own ingress (Cloudflare Email Routing
// or penny-mail): each is pass, fail, none or unknown. MAZ-184.
public sealed record MailAuthentication(string Spf, string Dkim, string Dmarc)
{
    public const string Pass = "pass";
    public const string Fail = "fail";
    public const string None = "none";
    public const string Unknown = "unknown";

    public static MailAuthentication Missing { get; } = new(Unknown, Unknown, Unknown);

    // The From domain passed DMARC (aligned SPF or DKIM).
    public bool Verified => Dmarc == Pass;
}
