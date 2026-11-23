namespace Penny.Backend.Application.Profiles;

// What a sign-in provider says about the person at one sign-in. A null field means the
// provider sent nothing for it (Apple after the first sign-in, or a provider without
// pictures): Penny then keeps what it has, and a field no provider ever sent stays the
// person's to set.
public sealed record ProviderProfile(string? Name, string? PictureUrl)
{
    public static readonly ProviderProfile None = new(null, null);

    public override string ToString() => "Provider profile (details redacted)";
}
