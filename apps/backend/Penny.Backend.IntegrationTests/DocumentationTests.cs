using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests;

public sealed class DocumentationTests(ApiFixture fixture) : IntegrationTestBase(fixture)
{
    [Fact]
    public async Task Generated_document_describes_only_implemented_operations_and_legacy_shapes()
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
        paths.TryGetProperty("/api/ledger", out _).ShouldBeFalse();
        using var scalar = await Client.GetAsync("/scalar/v1", Ct);
        scalar.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await scalar.Content.ReadAsStringAsync(Ct)).ShouldContain("scalar");
    }

    [Theory]
    [InlineData("/openapi/v1.json")]
    [InlineData("/scalar/v1")]
    public async Task Production_does_not_expose_development_documentation(string path)
    {
        await using var production = Fixture.Factory.WithWebHostBuilder(builder =>
            builder.UseEnvironment("Production")
        );
        using var client = production.CreateClient();
        using var response = await client.GetAsync(path, Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }
}
