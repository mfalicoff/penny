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
    // MAZ-187: the contract lists exactly the codes the API can send, each once.
    [Fact]
    public void whenContractRead_ErrorCodes_ShouldMatchTheServerCatalogue()
    {
        var error = ContractFixtures.OpenApi()["components"]!["schemas"]!["Error"]!;
        error["required"]!
            .AsArray()
            .Select(item => item!.GetValue<string>())
            .ShouldBe(["error", "code"], ignoreOrder: true);
        var contract = error["properties"]!["code"]!["enum"]!
            .AsArray()
            .Select(item => item!.GetValue<string>())
            .ToList();
        contract.Distinct(StringComparer.Ordinal).Count().ShouldBe(contract.Count);
        contract.ShouldBe(ErrorCodeCatalog.All, ignoreOrder: true);
        foreach (var code in contract)
            System
                .Text.RegularExpressions.Regex.IsMatch(
                    code,
                    "^[a-z]+(_[a-z]+)*\\.[a-z0-9]+(_[a-z0-9]+)*$"
                )
                .ShouldBeTrue(code);
    }

    [Fact]
    public async Task whenDocumentationRequested_GenerateOpenApi_ShouldDescribeOperationsWithContractIds()
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
                ("/api/push/devices", "post", "postApiPushDevices"),
                ("/api/push/devices", "delete", "deleteApiPushDevices"),
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
        // Household, shared expense, settlement and receipt operations keep the shared
        // contract's operation IDs.
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
                // Emailed receipts (MAZ-184).
                ("/api/receipt-email", "get"),
                ("/api/receipt-email", "post"),
                ("/api/receipt-email", "patch"),
                ("/api/receipt-email", "delete"),
                ("/api/inbound-mail", "post"),
                ("/api/inbound-mail/recipients", "get"),
                ("/api/receipt-inbox", "get"),
                ("/api/receipt-inbox/{id}", "delete"),
                ("/api/receipt-inbox/{id}/done", "post"),
                // Display names and pictures (MAZ-171).
                ("/api/profile", "get"),
                ("/api/profile", "patch"),
                ("/api/profile/avatar", "put"),
                ("/api/profile/avatar", "delete"),
                ("/api/users/{userId}/avatar", "get"),
                ("/api/auth/password", "post"),
                // Email delivery (MAZ-124).
                ("/api/auth/password-reset/request", "post"),
                ("/api/households/{id}/email-invites", "get"),
                ("/api/households/{id}/email-invites", "post"),
                ("/api/households/{id}/email-invites/{inviteId}/resend", "post"),
                ("/api/households/{id}/email-invites/{inviteId}", "delete"),
                // Email verification (MAZ-172).
                ("/api/auth/email-verification", "post"),
                ("/api/auth/email-verification/resend", "post"),
                ("/api/auth/email", "post"),
                // Account deletion and the full export (MAZ-152).
                ("/api/account/delete", "post"),
                ("/api/export", "get"),
                ("/api/export/entries", "get"),
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
        }
        // The password reset (MAZ-123) is in the shared contract too.
        ContractFixtures.OpenApi()["paths"]!["/api/auth/password-reset"]!["post"]!["operationId"]!
            .GetValue<string>()
            .ShouldBe("postApiAuthPasswordReset");
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
        // Unmapped routes require a session first, then 404.
        using var anonymous = await client.GetAsync(path, Ct);
        anonymous.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        var token = await RegisterAsync("docs@example.test", client);
        using var request = Authorized(HttpMethod.Get, path, bearer: token);
        using var response = await client.SendAsync(request, Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }
}
