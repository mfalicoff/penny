using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Contracts;

public sealed class DocumentationTests(ApiFixture fixture) : IntegrationTestBase(fixture)
{
    [Fact]
    public async Task whenDocumentationRequested_GenerateOpenApi_ShouldDescribeOnlyImplementedOperationsAndLegacyShapes()
    {
        var document = await Client.GetFromJsonAsync<JsonElement>("/openapi/v1.json", Ct);
        document.GetProperty("openapi").GetString().ShouldStartWith("3.");
        var paths = document.GetProperty("paths");
        paths
            .GetProperty("/api/health")
            .GetProperty("get")
            .GetProperty("operationId")
            .GetString()
            .ShouldBe("getApiHealth");
        paths
            .GetProperty("/api/info")
            .GetProperty("get")
            .GetProperty("operationId")
            .GetString()
            .ShouldBe("getApiInfo");
        paths
            .GetProperty("/api/ready")
            .GetProperty("get")
            .GetProperty("responses")
            .TryGetProperty("503", out _)
            .ShouldBeTrue();
        foreach (
            var (path, method, operationId) in new[]
            {
                ("/api/auth/register", "post", "postApiAuthRegister"),
                ("/api/auth/login", "post", "postApiAuthLogin"),
                ("/api/auth/me", "get", "getApiAuthMe"),
                ("/api/auth/logout", "post", "postApiAuthLogout"),
                ("/api/ledger", "get", "getApiLedger"),
                ("/api/ledger", "put", "putApiLedger"),
                ("/api/auth/oidc", "get", "getApiAuthOidc"),
                ("/api/auth/oidc/start", "post", "postApiAuthOidcStart"),
                ("/api/auth/oidc/complete", "post", "postApiAuthOidcComplete"),
            }
        )
            paths
                .GetProperty(path)
                .GetProperty(method)
                .GetProperty("operationId")
                .GetString()
                .ShouldBe(operationId);
        // Ledger operations keep the shared contract's operation IDs.
        var contract = ContractFixtures.OpenApi()["paths"]!["/api/ledger"]!;
        foreach (var method in new[] { "get", "put" })
            paths
                .GetProperty("/api/ledger")
                .GetProperty(method)
                .GetProperty("operationId")
                .GetString()
                .ShouldBe(contract[method]!["operationId"]!.GetValue<string>());
        using var scalar = await Client.GetAsync("/scalar/v1", Ct);
        scalar.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await scalar.Content.ReadAsStringAsync(Ct)).ShouldContain("scalar");
    }

    [Theory]
    [InlineData("/openapi/v1.json")]
    [InlineData("/scalar/v1")]
    public async Task whenEnvironmentIsProduction_DocumentationFlow_ShouldReturnNotFound(
        string path
    )
    {
        await using var production = Fixture.Factory.WithWebHostBuilder(builder =>
            builder.UseEnvironment("Production")
        );
        using var client = CreateClient(production);
        // Unmapped routes require a session first (as in the legacy server), then 404.
        using var anonymous = await client.GetAsync(path, Ct);
        anonymous.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        var token = await RegisterAsync("docs@example.test", client);
        using var request = Authorized(HttpMethod.Get, path, bearer: token);
        using var response = await client.SendAsync(request, Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }
}
