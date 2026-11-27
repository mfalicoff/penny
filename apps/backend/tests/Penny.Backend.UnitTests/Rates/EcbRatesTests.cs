using System.IO.Compression;
using System.Text;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Application.Rates;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Rates;

// The ECB file formats (MAZ-151), with tiny synthetic files in the shapes the ECB publishes.
public sealed class EcbRatesTests
{
    // Newest first, a retired currency (CYP), "N/A", a trailing comma and a 1999 row.
    private const string HistoryCsv =
        "Date,USD,JPY,CYP,ISK,CAD,\n"
        + "2026-11-03,1.0812,161.23,N/A,N/A,1.4612,\n"
        + "2026-11-02,1.0800,160.5000,N/A,140.1,1.4600,\n"
        + "1999-01-04,1.1789,133.73,0.58231,N/A,1.8004,\n";

    private const string DailyXml = """
        <?xml version="1.0" encoding="UTF-8"?>
        <gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
          <gesmes:subject>Reference rates</gesmes:subject>
          <gesmes:Sender><gesmes:name>European Central Bank</gesmes:name></gesmes:Sender>
          <Cube>
            <Cube time="2026-11-04">
              <Cube currency="USD" rate="1.0825"/>
              <Cube currency="JPY" rate="162.10"/>
              <Cube currency="XYZ" rate="2.5"/>
            </Cube>
            <Cube time="2026-11-03">
              <Cube currency="USD" rate="1.0812"/>
              <Cube currency="CAD" rate="1.4612"/>
            </Cube>
          </Cube>
        </gesmes:Envelope>
        """;

    [Fact]
    public void whenHistoryZipRead_ReadHistoryZip_ShouldKeepListedCurrenciesCanonically()
    {
        using var zip = new MemoryStream();
        using (var archive = new ZipArchive(zip, ZipArchiveMode.Create, leaveOpen: true))
        {
            using var writer = new StreamWriter(
                archive.CreateEntry("eurofxref-hist.csv").Open(),
                Encoding.UTF8
            );
            writer.Write(HistoryCsv);
        }
        zip.Position = 0;
        EcbRates
            .ReadHistoryZip(zip)
            .ShouldBe([
                new StoredRate(new(2026, 11, 3), "USD", "1.0812"),
                new StoredRate(new(2026, 11, 3), "JPY", "161.23"),
                new StoredRate(new(2026, 11, 3), "CAD", "1.4612"),
                new StoredRate(new(2026, 11, 2), "USD", "1.08"),
                new StoredRate(new(2026, 11, 2), "JPY", "160.5"),
                new StoredRate(new(2026, 11, 2), "ISK", "140.1"),
                new StoredRate(new(2026, 11, 2), "CAD", "1.46"),
            ]);
    }

    [Fact]
    public void whenDailyXmlRead_ReadDaily_ShouldReadEveryPublication()
    {
        using var xml = new MemoryStream(Encoding.UTF8.GetBytes(DailyXml));
        EcbRates
            .ReadDaily(xml)
            .ShouldBe([
                new StoredRate(new(2026, 11, 4), "USD", "1.0825"),
                new StoredRate(new(2026, 11, 4), "JPY", "162.1"),
                new StoredRate(new(2026, 11, 3), "USD", "1.0812"),
                new StoredRate(new(2026, 11, 3), "CAD", "1.4612"),
            ]);
    }

    [Fact]
    public void whenXmlHasDocumentType_ReadDaily_ShouldRefuseIt()
    {
        using var xml = new MemoryStream(
            Encoding.UTF8.GetBytes(
                """<?xml version="1.0"?><!DOCTYPE Cube [<!ENTITY a "1.5">]><Cube><Cube time="2026-11-04"><Cube currency="USD" rate="&a;"/></Cube></Cube>"""
            )
        );
        Should.Throw<System.Xml.XmlException>(() => EcbRates.ReadDaily(xml));
    }

    [Fact]
    public void whenCsvHasNoDateColumn_ReadHistoryCsv_ShouldRefuseIt()
    {
        Should.Throw<InvalidDataException>(() =>
            EcbRates.ReadHistoryCsv(new StringReader("Day,USD\n2026-11-03,1.08\n"))
        );
    }
}
