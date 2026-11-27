using System.IO.Compression;
using System.Net;
using System.Text;

namespace Penny.Backend.IntegrationTests.Infrastructure;

// Stands in for the ECB (MAZ-151): answers the history and 90-day URLs with tiny synthetic
// files in the ECB's formats, or with a scripted status. Records every URL requested;
// nothing leaves the process.
public sealed class FakeRateSource : HttpMessageHandler
{
    public static readonly Uri History = new("https://rates.example.test/eurofxref-hist.zip");
    public static readonly Uri Recent = new("https://rates.example.test/eurofxref-hist-90d.xml");

    public List<Uri> Requests { get; } = [];
    public HttpStatusCode Status { get; set; } = HttpStatusCode.OK;
    public string HistoryCsv { get; set; } = "";
    public string RecentXml { get; set; } = "";

    protected override Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken
    )
    {
        lock (Requests)
            Requests.Add(request.RequestUri!);
        if (Status != HttpStatusCode.OK)
            return Task.FromResult(new HttpResponseMessage(Status));
        if (request.RequestUri == History)
            return Task.FromResult(
                new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new ByteArrayContent(Zip(HistoryCsv)),
                }
            );
        if (request.RequestUri == Recent)
            return Task.FromResult(
                new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(RecentXml, Encoding.UTF8, "text/xml"),
                }
            );
        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
    }

    // The ECB's daily XML shape: `<Cube time>` holding `<Cube currency rate/>`.
    public static string Xml(params (string Date, (string Currency, string Rate)[] Quotes)[] days)
    {
        var xml = new StringBuilder(
            """
            <?xml version="1.0" encoding="UTF-8"?>
            <gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
            <gesmes:subject>Reference rates</gesmes:subject>
            <gesmes:Sender><gesmes:name>European Central Bank</gesmes:name></gesmes:Sender>
            <Cube>
            """
        );
        foreach (var (date, quotes) in days)
        {
            xml.Append("<Cube time=\"").Append(date).Append("\">");
            foreach (var (currency, rate) in quotes)
                xml.Append("<Cube currency=\"")
                    .Append(currency)
                    .Append("\" rate=\"")
                    .Append(rate)
                    .Append("\"/>");
            xml.Append("</Cube>");
        }
        return xml.Append("</Cube></gesmes:Envelope>").ToString();
    }

    private static byte[] Zip(string csv)
    {
        using var zip = new MemoryStream();
        using (var archive = new ZipArchive(zip, ZipArchiveMode.Create, leaveOpen: true))
        using (var writer = new StreamWriter(archive.CreateEntry("eurofxref-hist.csv").Open()))
            writer.Write(csv);
        return zip.ToArray();
    }
}
