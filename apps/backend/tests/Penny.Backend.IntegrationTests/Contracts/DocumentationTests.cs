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
                ("/api/auth/password-reset", "post", "postApiAuthPasswordReset"),
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
        // Household membership operations (MAZ-56) keep the shared contract's operation
        // IDs; Node still serves production, so the contract keeps them `legacy`.
        var openApi = ContractFixtures.OpenApi()["paths"]!;
        foreach (
            var (path, method) in new[]
            {
                ("/api/households", "get"),
                ("/api/households", "post"),
                ("/api/households/trips", "post"),
                ("/api/households/join", "post"),
                ("/api/households/{id}", "get"),
                ("/api/households/{id}", "patch"),
                ("/api/households/{id}/trip", "patch"),
                ("/api/households/{id}/archive", "post"),
                ("/api/households/{id}/invites", "post"),
                ("/api/households/{id}/leave", "post"),
                ("/api/households/{id}/members/{userId}", "delete"),
                // Shared expenses, share payments and the projection (MAZ-57).
                ("/api/households/projection", "get"),
                ("/api/households/{id}/expenses", "get"),
                ("/api/households/{id}/expenses", "post"),
                ("/api/households/{id}/expenses/{expenseId}", "get"),
                ("/api/households/{id}/expenses/{expenseId}", "put"),
                ("/api/households/{id}/expenses/{expenseId}", "delete"),
                ("/api/households/{id}/expenses/{expenseId}/payments", "post"),
                // Shared recurring rules (MAZ-59).
                ("/api/households/{id}/recurring", "get"),
                ("/api/households/{id}/recurring", "post"),
                ("/api/households/{id}/recurring/{ruleId}", "put"),
                ("/api/households/{id}/recurring/{ruleId}", "delete"),
                // Month recaps, monthly reimbursements and audit history (MAZ-58).
                ("/api/households/{id}/months/{month}", "get"),
                ("/api/households/{id}/months/{month}/reimbursements", "post"),
                ("/api/households/{id}/audit", "get"),
                // Receipt upload and download (MAZ-60).
                ("/api/receipts", "post"),
                ("/api/receipts/{id}", "get"),
            }
        )
        {
            var operation = openApi[path]![method]!;
            paths
                .GetProperty(path)
                .GetProperty(method)
                .GetProperty("operationId")
                .GetString()
                .ShouldBe(operation["operationId"]!.GetValue<string>());
            operation["x-implementation"]!.GetValue<string>().ShouldBe("legacy");
        }
        // The .NET-only password reset (MAZ-123) is in the shared contract too.
        var reset = ContractFixtures.OpenApi()["paths"]!["/api/auth/password-reset"]!["post"]!;
        reset["operationId"]!.GetValue<string>().ShouldBe("postApiAuthPasswordReset");
        reset["x-implementation"]!.GetValue<string>().ShouldBe("backend");
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
