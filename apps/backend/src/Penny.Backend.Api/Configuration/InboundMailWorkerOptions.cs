using Penny.Backend.Application.InboundMail;
using Penny.Backend.Persistence.InboundMail;

namespace Penny.Backend.Api.Configuration;

// The inbound mail worker (MAZ-184). `InboundMail__Worker=false` stops this process from
// converting messages (another process may; leases keep them apart). The worker calls
// penny-render at `InboundMail__RendererUrl` (internal network only, default
// http://penny-render:3000) and trusts sender authentication results only from the
// ARC-Authentication-Results set added by `InboundMail__AuthServId`
// (default mx.cloudflare.net, Cloudflare Email Routing).
public sealed record InboundMailWorkerOptions(
    bool Worker,
    int PollSeconds,
    Uri RendererUrl,
    int RenderTimeoutSeconds,
    string AuthServId,
    InboundMailProcessingSettings Processing,
    MailLimits Limits
)
{
    public static InboundMailWorkerOptions Read(IConfiguration configuration)
    {
        var worker = configuration["InboundMail:Worker"] switch
        {
            null => true,
            "true" => true,
            "false" => false,
            _ => throw new InvalidOperationException("InboundMail:Worker must be true or false."),
        };
        var rendererText = configuration["InboundMail:RendererUrl"] ?? "http://penny-render:3000";
        if (
            !Uri.TryCreate(rendererText, UriKind.Absolute, out var renderer)
            || renderer.Scheme is not ("http" or "https")
            || !string.IsNullOrEmpty(renderer.UserInfo)
        )
            throw new InvalidOperationException(
                "InboundMail:RendererUrl must be an absolute http(s) URL, for example http://penny-render:3000."
            );
        if (!renderer.AbsoluteUri.EndsWith('/'))
            renderer = new Uri(renderer.AbsoluteUri + "/");
        var authServId = (
            configuration["InboundMail:AuthServId"] ?? MailAuthenticationReader.DefaultAuthServId
        ).Trim();
        if (
            authServId.Length is 0 or > 253
            || authServId.Any(character => char.IsWhiteSpace(character) || character == ';')
        )
            throw new InvalidOperationException("InboundMail:AuthServId must be a host name.");
        var defaults = InboundMailProcessingSettings.Default;
        return new(
            worker,
            BackendOptions.ReadBounded(configuration, "InboundMail:PollSeconds", 5, 1, 3600),
            renderer,
            BackendOptions.ReadBounded(
                configuration,
                "InboundMail:RenderTimeoutSeconds",
                30,
                1,
                120
            ),
            authServId,
            defaults with
            {
                Concurrency = BackendOptions.ReadBounded(
                    configuration,
                    "InboundMail:Concurrency",
                    1,
                    1,
                    8
                ),
                MaxAttempts = BackendOptions.ReadBounded(
                    configuration,
                    "InboundMail:MaxAttempts",
                    4,
                    1,
                    20
                ),
            },
            MailLimits.Default with
            {
                MaxPages = BackendOptions.ReadBounded(
                    configuration,
                    "InboundMail:MaxPages",
                    50,
                    1,
                    500
                ),
            }
        );
    }
}
