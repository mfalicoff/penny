namespace Penny.Backend.UnitTests.Push;

// Records requests (with their bodies) and answers each with the scripted response.
internal sealed class StubHandler(Func<HttpRequestMessage, string, HttpResponseMessage> respond)
    : HttpMessageHandler
{
    public List<(HttpRequestMessage Request, string Body)> Requests { get; } = [];

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken
    )
    {
        var body = request.Content is null
            ? ""
            : await request.Content.ReadAsStringAsync(cancellationToken);
        lock (Requests)
            Requests.Add((request, body));
        return respond(request, body);
    }
}
