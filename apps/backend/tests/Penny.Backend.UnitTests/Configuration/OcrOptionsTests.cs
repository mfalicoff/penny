using Microsoft.Extensions.Configuration;
using Penny.Backend.Api.Configuration;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Configuration;

public sealed class OcrOptionsTests
{
    private static OcrOptions Read(params (string Key, string Value)[] values) =>
        OcrOptions.Read(
            new ConfigurationBuilder()
                .AddInMemoryCollection(
                    values.Select(pair => new KeyValuePair<string, string?>(pair.Key, pair.Value))
                )
                .Build()
        );

    [Fact]
    public void whenNothingConfigured_Read_ShouldUseEnglishAndFrenchWithModestBounds()
    {
        var options = Read();
        options.Worker.ShouldBeTrue();
        options.PollSeconds.ShouldBe(5);
        options.Engine.Languages.ShouldBe(["eng", "fra"]);
        options.Engine.Tesseract.ShouldBe("tesseract");
        options.Engine.PdfToText.ShouldBe("pdftotext");
        options.Engine.Tessdata.ShouldBeNull();
        options.Limits.MaxBytes.ShouldBe(10 * 1024 * 1024);
        options.Limits.MaxPages.ShouldBe(10);
        options.Limits.Timeout.ShouldBe(TimeSpan.FromMinutes(2));
        options.Limits.Concurrency.ShouldBe(1);
        options.Limits.MaxAttempts.ShouldBe(4);
        options.Limits.Lease.ShouldBeGreaterThan(options.Limits.Timeout);
        options.Engine.VipsThumbnail.ShouldBe("vipsthumbnail");
        if (OperatingSystem.IsLinux())
            options.Engine.Limits.ShouldBe(new("prlimit", 1024L * 1024 * 1024, 120));
    }

    [Fact]
    public void whenValuesConfigured_Read_ShouldParseLanguagesPathsAndBounds()
    {
        var options = Read(
            ("Ocr:Worker", "false"),
            ("Ocr:Languages", "eng, fra+deu,eng"),
            ("Ocr:Tesseract", "/opt/ocr/bin/tesseract"),
            ("Ocr:PopplerDirectory", "/opt/poppler/bin"),
            ("Ocr:TessdataDirectory", "/opt/tessdata"),
            ("Ocr:MaxPages", "3"),
            ("Ocr:Concurrency", "2"),
            ("Ocr:TimeoutSeconds", "30"),
            ("Ocr:VipsDirectory", "/opt/vips/bin"),
            ("Ocr:Prlimit", "/usr/bin/prlimit"),
            ("Ocr:EngineLimits", "true"),
            ("Ocr:EngineMemoryMegabytes", "2048")
        );
        options.Worker.ShouldBeFalse();
        options.Engine.Languages.ShouldBe(["eng", "fra", "deu"]);
        options.Engine.Tesseract.ShouldBe("/opt/ocr/bin/tesseract");
        options.Engine.PdfToPpm.ShouldBe("/opt/poppler/bin/pdftoppm");
        options.Engine.Tessdata.ShouldBe("/opt/tessdata");
        options.Limits.MaxPages.ShouldBe(3);
        options.Limits.Concurrency.ShouldBe(2);
        options.Limits.Timeout.ShouldBe(TimeSpan.FromSeconds(30));
        options.Engine.VipsHeader.ShouldBe("/opt/vips/bin/vipsheader");
        options.Engine.PdfInfo.ShouldBe("/opt/poppler/bin/pdfinfo");
        options.Engine.Limits.ShouldBe(new("/usr/bin/prlimit", 2048L * 1024 * 1024, 30));
    }

    [Theory]
    [InlineData("Ocr:Worker", "yes")]
    [InlineData("Ocr:Languages", "eng+../../etc")]
    [InlineData("Ocr:Languages", "+")]
    [InlineData("Ocr:TessdataDirectory", "tessdata")]
    [InlineData("Ocr:PopplerDirectory", "bin")]
    [InlineData("Ocr:Concurrency", "9")]
    [InlineData("Ocr:MaxFileMegabytes", "11")]
    [InlineData("Ocr:VipsDirectory", "vips")]
    [InlineData("Ocr:EngineLimits", "on")]
    [InlineData("Ocr:EngineMemoryMegabytes", "128")]
    public void whenValueInvalid_Read_ShouldFailWithTheSettingName(string key, string value)
    {
        Should
            .Throw<InvalidOperationException>(() => Read((key, value)))
            .Message.ShouldContain(key.Split(':')[1]);
    }
}
