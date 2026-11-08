using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Penny.Backend.IntegrationTests.Infrastructure;

[Collection(ApiCollection.Name)]
public abstract class IntegrationTestBase(ApiFixture fixture) : IAsyncLifetime
{
    protected const string TestPassword = "a secure test password";
    protected ApiFixture Fixture { get; } = fixture;

    // Never stores cookies: tests send session cookies and bearer tokens explicitly.
    protected HttpClient Client { get; private set; } = null!;
    protected static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async ValueTask InitializeAsync()
    {
        await Fixture.ResetAsync(Ct);
        Client = CreateClient(Fixture.Factory);
    }

    public ValueTask DisposeAsync()
    {
        Client.Dispose();
        return ValueTask.CompletedTask;
    }

    protected static HttpClient CreateClient(WebApplicationFactory<Program> factory)
    {
        // Starting first lets a Kestrel host publish its real address to ClientOptions.
        factory.StartServer();
        return factory.CreateClient(
            new WebApplicationFactoryClientOptions
            {
                HandleCookies = false,
                BaseAddress = factory.ClientOptions.BaseAddress,
            }
        );
    }

    // Registers a synthetic account and returns its bearer token.
    protected async Task<string> RegisterAsync(string email, HttpClient? client = null)
    {
        using var response = await (client ?? Client).PostAsJsonAsync(
            "/api/auth/register",
            new { email, password = TestPassword },
            Ct
        );
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<JsonElement>(Ct))
            .GetProperty("token")
            .GetString()!;
    }

    protected static HttpRequestMessage Authorized(
        HttpMethod method,
        string path,
        string? bearer = null,
        string? cookie = null
    )
    {
        var request = new HttpRequestMessage(method, path);
        if (bearer is not null)
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
        if (cookie is not null)
            request.Headers.Add("Cookie", cookie);
        return request;
    }
}
