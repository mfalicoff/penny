using System.Text.Json.Serialization;

namespace Penny.Backend.Api.Contracts;

// Legacy `{enabled, label}`; the label is omitted when OIDC is not configured.
public sealed record OidcConfigResponse(
    bool Enabled,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Label
);
