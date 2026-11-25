using System.Text.RegularExpressions;

namespace Penny.Backend.Api.Configuration;

// OpenID Connect sign-in providers (MAZ-170), configured as a dictionary keyed by provider id
// (`Oidc__Providers__<id>__*`). The single-provider settings from before (`Oidc__Issuer`,
// `Oidc__ClientId`, ...) still work: they are read as the provider `sso`. OIDC is off when no
// provider is configured; empty values count as unset.
public sealed partial record OidcOptions(IReadOnlyList<OidcProviderOptions> Providers)
{
    public const string LegacyProviderId = "sso";
    private const string ProvidersSection = "Oidc:Providers";

    public override string ToString() =>
        $"OIDC options ({Providers.Count} providers, client secrets redacted)";

    public static OidcOptions? Read(IConfiguration configuration)
    {
        var providers = new List<OidcProviderOptions>();
        if (
            OidcProviderOptions.Read(configuration.GetSection("Oidc"), "Oidc", LegacyProviderId) is
            { } legacy
        )
            providers.Add(legacy);
        foreach (var section in configuration.GetSection(ProvidersSection).GetChildren())
        {
            var id = section.Key.ToLowerInvariant();
            var prefix = $"{ProvidersSection}:{section.Key}";
            if (!ProviderId().IsMatch(id))
                throw new InvalidOperationException(
                    $"{prefix}: a provider id is 1 to 32 lowercase letters, digits, '-' or '_', starting with a letter or digit."
                );
            if (OidcProviderOptions.Read(section, prefix, id) is not { } provider)
                continue;
            if (providers.Any(existing => existing.Id == id))
                throw new InvalidOperationException(
                    id == LegacyProviderId
                        ? $"{prefix} and the single-provider Oidc:Issuer settings both configure the provider '{LegacyProviderId}'. Keep one of them."
                        : $"{prefix} is configured twice."
                );
            providers.Add(provider);
        }
        return providers.Count == 0
            ? null
            : new([
                .. providers
                    .OrderBy(provider => provider.Order)
                    .ThenBy(provider => provider.Id, StringComparer.Ordinal),
            ]);
    }

    public OidcProviderOptions? Find(string id) =>
        Providers.FirstOrDefault(provider => provider.Id == id);

    [GeneratedRegex("^[a-z0-9][a-z0-9_-]{0,31}$")]
    internal static partial Regex ProviderId();
}
