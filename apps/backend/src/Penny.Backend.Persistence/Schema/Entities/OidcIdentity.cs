namespace Penny.Backend.Persistence.Schema.Entities;

public sealed class OidcIdentity
{
    public required string Issuer { get; set; }
    public required string Subject { get; set; }
    public required string UserId { get; set; }
}
