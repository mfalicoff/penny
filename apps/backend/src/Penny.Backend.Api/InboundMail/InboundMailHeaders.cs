namespace Penny.Backend.Api.InboundMail;

// Request headers of the signed ingress (MAZ-184), set by apps/email-worker.
public static class InboundMailHeaders
{
    public const string Recipient = "X-Penny-Recipient";
    public const string Timestamp = "X-Penny-Timestamp";
    public const string Signature = "X-Penny-Signature";
    public const string Path = "/api/inbound-mail";
}
