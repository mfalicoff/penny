using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace Penny.Backend.IntegrationTests.Infrastructure;

// Shared OIDC flow helpers. Each test class gets one fake provider, reset per test.
public abstract class OidcTestBase : IntegrationTestBase, IClassFixture<FakeOidcProvider>
{
    protected OidcTestBase(ApiFixture fixture, FakeOidcProvider provider)
        : base(fixture)
    {
        Provider = provider;
        provider.Reset();
    }

    protected FakeOidcProvider Provider { get; }

    protected static async Task<JsonElement> StartAsync(
        HttpClient client,
        string redirectUri = FakeOidcProvider.WebRedirect
    )
    {
        using var response = await client.PostAsJsonAsync(
            "/api/auth/oidc/start",
            new { redirectUri },
            Ct
        );
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<JsonElement>(Ct);
    }

    protected static Task<HttpResponseMessage> CompleteAsync(
        HttpClient client,
        string transaction,
        string callbackUrl
    ) => client.PostAsJsonAsync("/api/auth/oidc/complete", new { transaction, callbackUrl }, Ct);

    // Starts an attempt and returns its transaction and the provider's callback.
    protected async Task<(string Transaction, string CallbackUrl)> BeginAsync(
        HttpClient client,
        FakeOidcGrant? grant = null,
        string redirectUri = FakeOidcProvider.WebRedirect
    )
    {
        var challenge = await StartAsync(client, redirectUri);
        return (
            challenge.GetProperty("transaction").GetString()!,
            Provider.Authorize(challenge.GetProperty("authorizationUrl").GetString()!, grant)
        );
    }

    protected async Task<HttpResponseMessage> SignInAsync(
        HttpClient client,
        FakeOidcGrant? grant = null,
        string redirectUri = FakeOidcProvider.WebRedirect
    )
    {
        var (transaction, callbackUrl) = await BeginAsync(client, grant, redirectUri);
        return await CompleteAsync(client, transaction, callbackUrl);
    }

    protected async Task<object?> ScalarAsync(string sql)
    {
        await using var command = Fixture.Admin.CreateCommand(sql);
        return await command.ExecuteScalarAsync(Ct);
    }
}
