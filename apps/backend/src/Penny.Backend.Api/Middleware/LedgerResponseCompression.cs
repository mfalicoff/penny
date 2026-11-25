using System.IO.Compression;
using Microsoft.AspNetCore.ResponseCompression;

namespace Penny.Backend.Api.Middleware;

/// <summary>
/// Compresses the personal ledger's <c>GET</c> and <c>PUT /api/ledger</c> responses (MAZ-186):
/// Brotli or gzip, whichever the client's <c>Accept-Encoding</c> prefers, and nothing without it.
/// The ledger is the whole document on every sync (about 180 bytes per entry), and it shrinks
/// about six times. Every other route stays uncompressed: compressing a response that holds a
/// secret next to text an attacker controls (sign-in, sessions, tokens) would expose it to BREACH.
/// The ledger body holds no credentials. Docs: docs/reference/ledger-sync-baseline.md.
/// </summary>
public static class LedgerResponseCompression
{
    public static void AddLedgerResponseCompression(this IServiceCollection services)
    {
        services.AddResponseCompression(options =>
        {
            // Only the ledger routes reach the middleware (UseLedgerResponseCompression), so
            // HTTPS is safe to enable here.
            options.EnableForHttps = true;
            options.MimeTypes = ["application/json"];
            options.Providers.Add<BrotliCompressionProvider>();
            options.Providers.Add<GzipCompressionProvider>();
        });
        // Optimal (Brotli quality 4, gzip level 6): about six times smaller. Fastest served a
        // 2,000-entry ledger at 98 KiB instead of 57 KiB, for no measurable server time.
        services.Configure<BrotliCompressionProviderOptions>(options =>
            options.Level = CompressionLevel.Optimal
        );
        services.Configure<GzipCompressionProviderOptions>(options =>
            options.Level = CompressionLevel.Optimal
        );
    }

    public static void UseLedgerResponseCompression(this IApplicationBuilder app) =>
        app.UseWhen(Applies, branch => branch.UseResponseCompression());

    internal static bool Applies(HttpContext context) =>
        (HttpMethods.IsGet(context.Request.Method) || HttpMethods.IsPut(context.Request.Method))
        && string.Equals(
            context.Request.Path.Value?.TrimEnd('/'),
            "/api/ledger",
            StringComparison.OrdinalIgnoreCase
        );
}
