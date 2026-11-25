using System.Text.Json.Serialization;

namespace Penny.Backend.Api.Contracts;

// `{enabled, label, providers}` (MAZ-170). `providers` lists every configured sign-in
// provider in display order, empty when OIDC is off; clients show one button per entry
// and nothing else. `label` is the first provider's label, kept for clients from before
// MAZ-170, and omitted when OIDC is not configured.
public sealed record OidcConfigResponse(
    bool Enabled,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Label,
    IReadOnlyList<OidcProviderResponse> Providers
);
