namespace Penny.Backend.Api.Authentication;

// Reads `{email, password}` with the legacy express.json() semantics.
public static class CredentialsBody
{
    private static readonly string[] Names = ["email", "password"];

    public static async Task<(string? Email, string? Password)> ReadAsync(
        HttpRequest request,
        CancellationToken cancellationToken
    )
    {
        var values = await JsonStringFields.ReadAsync(request, Names, cancellationToken);
        return (values[0], values[1]);
    }
}
