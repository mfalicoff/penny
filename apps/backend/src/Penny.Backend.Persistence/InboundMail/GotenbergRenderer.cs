using System.Net;
using System.Net.Http.Headers;
using System.Text;
using Penny.Backend.Application.Abstractions.InboundMail;

namespace Penny.Backend.Persistence.InboundMail;

// Calls penny-render (Gotenberg, headless Chromium with JavaScript off) on the internal
// render network (MAZ-184). The document is sent as index.html; the PDF is read up to
// `maxBytes`. Connection failures and 5xx answers mean the renderer is unavailable (the
// message is retried); a 4xx means the document itself could not be converted.
public sealed class GotenbergRenderer(HttpClient client) : IEmailRenderer
{
    public const string HttpClientName = "penny-render";
    public const string Route = "forms/chromium/convert/html";

    public async Task<byte[]?> RenderAsync(
        string html,
        long maxBytes,
        CancellationToken cancellationToken
    )
    {
        using var form = new MultipartFormDataContent();
        var document = new ByteArrayContent(Encoding.UTF8.GetBytes(html));
        document.Headers.ContentType = new MediaTypeHeaderValue("text/html") { CharSet = "utf-8" };
        form.Add(document, "files", "index.html");
        form.Add(new StringContent("true"), "printBackground");
        form.Add(new StringContent("true"), "skipNetworkIdleEvent");
        form.Add(new StringContent("0.4"), "marginTop");
        form.Add(new StringContent("0.4"), "marginBottom");
        form.Add(new StringContent("0.4"), "marginLeft");
        form.Add(new StringContent("0.4"), "marginRight");
        HttpResponseMessage response;
        try
        {
            response = await client.PostAsync(Route, form, cancellationToken);
        }
        catch (HttpRequestException error)
        {
            throw new MailRendererUnavailableException(error);
        }
        catch (TaskCanceledException error) when (!cancellationToken.IsCancellationRequested)
        {
            throw new MailRendererUnavailableException(error);
        }
        using (response)
        {
            if (
                (int)response.StatusCode >= 500
                || response.StatusCode == HttpStatusCode.TooManyRequests
            )
                throw new MailRendererUnavailableException();
            if (!response.IsSuccessStatusCode)
                return [];
            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
            using var buffer = new MemoryStream();
            var chunk = new byte[81920];
            int read;
            while ((read = await stream.ReadAsync(chunk, cancellationToken)) > 0)
            {
                if (buffer.Length + read > maxBytes)
                    return null;
                buffer.Write(chunk, 0, read);
            }
            return buffer.ToArray();
        }
    }
}
