using System.IO.Compression;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json.Nodes;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Http;

// MAZ-186: the ledger document is served compressed when the client accepts it; nothing
// else is (BREACH: sign-in and session answers hold secrets next to request input).
public sealed class CompressionTests(ApiFixture fixture) : IntegrationTestBase(fixture)
{
    [Theory]
    [InlineData("br", "br")]
    [InlineData("gzip", "gzip")]
    [InlineData("gzip, deflate, br", "br")]
    public async Task whenClientAcceptsEncoding_GetLedger_ShouldCompressTheSameDocument(
        string accept,
        string expected
    )
    {
        var token = await RegisterAsync("compressed-read@example.test");
        var plain = await SendAsync(HttpMethod.Get, token, null, null);
        plain.Encoding.ShouldBeNull();

        var compressed = await SendAsync(HttpMethod.Get, token, accept, null);

        compressed.Status.ShouldBe(HttpStatusCode.OK);
        compressed.Encoding.ShouldBe(expected);
        compressed.Vary.ShouldContain("Accept-Encoding");
        compressed.Body.ShouldBe(plain.Body);
        compressed.WireBytes.ShouldBeLessThan(Encoding.UTF8.GetByteCount(plain.Body));
    }

    [Fact]
    public async Task whenClientAcceptsGzip_PutLedger_ShouldCompressTheSavedDocument()
    {
        var token = await RegisterAsync("compressed-write@example.test");
        var snapshot = JsonNode.Parse((await SendAsync(HttpMethod.Get, token, null, null)).Body)!;
        snapshot["ledger"]!["currency"] = "EUR";

        var saved = await SendAsync(HttpMethod.Put, token, "gzip", snapshot);

        saved.Status.ShouldBe(HttpStatusCode.OK);
        saved.Encoding.ShouldBe("gzip");
        var body = JsonNode.Parse(saved.Body)!;
        body["revision"]!.GetValue<long>().ShouldBe(1);
        body["ledger"]!["currency"]!.GetValue<string>().ShouldBe("EUR");
    }

    [Fact]
    public async Task whenClientAcceptsGzip_SignIn_ShouldNotCompress()
    {
        await RegisterAsync("plain-auth@example.test");
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/login")
        {
            Content = JsonContent.Create(
                new { email = "plain-auth@example.test", password = TestPassword }
            ),
        };
        request.Headers.TryAddWithoutValidation("Accept-Encoding", "gzip, br");

        using var response = await Client.SendAsync(request, Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        response.Content.Headers.ContentEncoding.ShouldBeEmpty();
        (await response.Content.ReadFromJsonAsync<JsonObject>(Ct))!["token"].ShouldNotBeNull();
    }

    private sealed record Answer(
        HttpStatusCode Status,
        string? Encoding,
        IReadOnlyCollection<string> Vary,
        string Body,
        int WireBytes
    );

    private async Task<Answer> SendAsync(
        HttpMethod method,
        string token,
        string? acceptEncoding,
        JsonNode? body
    )
    {
        using var request = Authorized(method, "/api/ledger", bearer: token);
        if (acceptEncoding is not null)
            request.Headers.TryAddWithoutValidation("Accept-Encoding", acceptEncoding);
        if (body is not null)
            request.Content = new StringContent(
                body.ToJsonString(),
                System.Text.Encoding.UTF8,
                "application/json"
            );
        using var response = await Client.SendAsync(request, Ct);
        var wire = await response.Content.ReadAsByteArrayAsync(Ct);
        var encoding = response.Content.Headers.ContentEncoding.SingleOrDefault();
        return new Answer(
            response.StatusCode,
            encoding,
            [.. response.Headers.Vary],
            Decode(wire, encoding),
            wire.Length
        );
    }

    private static string Decode(byte[] wire, string? encoding)
    {
        using var input = new MemoryStream(wire);
        using Stream decoded = encoding switch
        {
            null => input,
            "gzip" => new GZipStream(input, CompressionMode.Decompress),
            "br" => new BrotliStream(input, CompressionMode.Decompress),
            _ => throw new InvalidOperationException($"Unexpected encoding {encoding}"),
        };
        using var reader = new StreamReader(decoded, System.Text.Encoding.UTF8);
        return reader.ReadToEnd();
    }
}
