using System.Net;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Penny.Backend.Api.Middleware;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Http;

public sealed class ObservabilityTests(ApiFixture fixture) : IntegrationTestBase(fixture)
{
    [Fact]
    public async Task whenProxySendsWellFormedRequestId_RequestCorrelation_ShouldEchoSameId()
    {
        const string id = "0f8fad5bd9cb469fa165-70867728950e";
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/health");
        request.Headers.Add(RequestCorrelationMiddleware.Header, id);
        using var response = await Client.SendAsync(request, Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        response.Headers.GetValues(RequestCorrelationMiddleware.Header).Single().ShouldBe(id);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("has spaces")]
    [InlineData("<script>")]
    [InlineData("0123456789012345678901234567890123456789012345678901234567890123456789")]
    public async Task whenRequestIdMissingOrMalformed_RequestCorrelation_ShouldIssueFreshId(
        string? supplied
    )
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/health");
        if (supplied is not null)
            request.Headers.TryAddWithoutValidation(RequestCorrelationMiddleware.Header, supplied);
        using var response = await Client.SendAsync(request, Ct);
        var issued = response.Headers.GetValues(RequestCorrelationMiddleware.Header).Single();
        issued.ShouldNotBe(supplied);
        issued.Length.ShouldBe(32);
        RequestCorrelationMiddleware.IsWellFormed(issued).ShouldBeTrue();
    }

    [Fact]
    public async Task whenRequestCompletes_AccessLog_ShouldRecordRouteTemplateWithoutPathQueryOrCredentials()
    {
        var logs = new CapturingLoggerProvider();
        await using var factory = new TestApiFactory(
            Fixture.RuntimeConnection,
            new Dictionary<string, string>
            {
                ["Logging:LogLevel:Default"] = "Information",
                ["Logging:LogLevel:Microsoft.AspNetCore"] = "Warning",
            },
            services =>
            {
                services.RemoveAll<ILoggerProvider>();
                services.AddSingleton<ILoggerProvider>(logs);
            }
        );
        using var client = CreateClient(factory);
        var token = await RegisterAsync("observed@example.test", client);
        const string household = "hh-0000-private-identifier";
        using var request = Authorized(
            HttpMethod.Get,
            $"/api/households/{household}?note=Zanzibarquokka",
            bearer: token
        );
        using var response = await client.SendAsync(request, Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        var access = logs
            .Messages.Where(message =>
                message.StartsWith(
                    typeof(RequestCorrelationMiddleware).FullName!,
                    StringComparison.Ordinal
                )
            )
            .ToList();
        access.ShouldContain(message =>
            message.Contains("HTTP GET api/households/{id} responded 404", StringComparison.Ordinal)
        );
        access.ShouldContain(message =>
            message.Contains("HTTP POST api/auth/register responded", StringComparison.Ordinal)
        );
        logs.Messages.ShouldAllBe(message =>
            !message.Contains(household, StringComparison.Ordinal)
            && !message.Contains("Zanzibarquokka", StringComparison.Ordinal)
            && !message.Contains(token, StringComparison.Ordinal)
            && !message.Contains(TestPassword, StringComparison.Ordinal)
            && !message.Contains("observed@example.test", StringComparison.Ordinal)
        );
    }
}
