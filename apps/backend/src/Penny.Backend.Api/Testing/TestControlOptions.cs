using Npgsql;

namespace Penny.Backend.Api.Testing;

// Full-stack test controls (MAZ-62). Off unless `TestControls__Enabled=true`; then the
// host refuses to start in Production, without a 32+ character `TestControls__Token`,
// or with a `ConnectionStrings__Postgres` database outside the test prefix
// (`TestControls__DatabasePrefix`, default `penny_test`). When off, the control
// controller and the fault middleware are not registered at all.
//
// `TestControls__OidcCertificate` (optional) is the PEM path of the local test OIDC
// provider's throwaway certificate; the provider HttpClient then also accepts exactly
// that certificate (by SHA-256), so a self-signed local issuer works.
public sealed record TestControlOptions(
    bool Enabled,
    string Token,
    string DatabasePrefix,
    string? OidcCertificateHash = null
)
{
    public const string DefaultPrefix = "penny_test";
    public const int MinimumTokenLength = 32;
    public static readonly TestControlOptions Disabled = new(false, "", DefaultPrefix);

    public static TestControlOptions Read(
        IConfiguration configuration,
        IHostEnvironment environment
    )
    {
        var enabled = configuration["TestControls:Enabled"] switch
        {
            null or "false" => false,
            "true" => true,
            _ => throw new InvalidOperationException("TestControls:Enabled must be true or false."),
        };
        if (!enabled)
            return Disabled;
        if (environment.IsProduction())
            throw new InvalidOperationException(
                "TestControls:Enabled is not allowed in the Production environment."
            );
        var token = configuration["TestControls:Token"] ?? "";
        if (token.Length < MinimumTokenLength)
            throw new InvalidOperationException(
                $"TestControls:Token must have at least {MinimumTokenLength} characters."
            );
        var prefix = configuration["TestControls:DatabasePrefix"] ?? DefaultPrefix;
        if (!prefix.StartsWith(DefaultPrefix, StringComparison.Ordinal))
            throw new InvalidOperationException(
                $"TestControls:DatabasePrefix must start with {DefaultPrefix}."
            );
        string? database;
        try
        {
            database = new NpgsqlConnectionStringBuilder(
                configuration.GetConnectionString("Postgres")
            ).Database;
        }
        catch (ArgumentException)
        {
            database = null;
        }
        if (database is null || !database.StartsWith(prefix, StringComparison.Ordinal))
            throw new InvalidOperationException(
                "TestControls:Enabled requires a ConnectionStrings:Postgres database named with the test prefix."
            );
        var certificate = configuration["TestControls:OidcCertificate"];
        var hash = string.IsNullOrEmpty(certificate) ? null : CertificateHash(certificate);
        return new(true, token, prefix, hash);
    }

    // SHA-256 of the certificate's DER bytes, as X509Certificate.GetCertHashString(SHA256).
    public static string CertificateHash(string pemPath)
    {
        var pem = File.ReadAllText(pemPath);
        var fields = System.Security.Cryptography.PemEncoding.Find(pem);
        if (!pem[fields.Label].SequenceEqual("CERTIFICATE"))
            throw new InvalidOperationException(
                "TestControls:OidcCertificate must be a PEM certificate."
            );
        using var parsed =
            System.Security.Cryptography.X509Certificates.X509CertificateLoader.LoadCertificate(
                Convert.FromBase64String(pem[fields.Base64Data])
            );
        return Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(parsed.RawData));
    }
}
