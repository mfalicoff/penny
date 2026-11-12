using System.Diagnostics;
using System.Globalization;
using System.Text;

namespace Penny.Backend.IntegrationTests.Infrastructure;

// Synthetic receipts for the OCR suites (MAZ-125), generated per test: a PDF with an
// embedded text layer (standard Helvetica, WinAnsi, so French accents survive), photos
// of it rendered by poppler's pdftoppm (the same engine the server uses, which must be
// installed), and a "scanned" PDF that holds only such a photo. No real receipts.
public static class SyntheticReceipts
{
    private const int Dpi = 200;
    private const int PageWidth = 612;
    private const int PageHeight = 792;

    public static byte[] TextPdf(params string[] lines) => Pdf([Page(lines)]);

    // Several pages, each with the given lines.
    public static byte[] TextPdfPages(params string[][] pages) => Pdf([.. pages.Select(Page)]);

    public static byte[] Jpeg(params string[] lines) => Render(TextPdf(lines), "-jpeg");

    public static byte[] Png(params string[] lines) => Render(TextPdf(lines), "-png");

    // A PDF whose only content is a photo of the lines (no text layer). pdftoppm writes
    // three-component JPEGs even for gray renders.
    public static byte[] ScannedPdf(params string[] lines)
    {
        var jpeg = Render(TextPdf(lines), "-jpeg");
        var width = PageWidth * Dpi / 72;
        var height = PageHeight * Dpi / 72;
        var content = Encoding.ASCII.GetBytes($"q {PageWidth} 0 0 {PageHeight} 0 0 cm /Im0 Do Q");
        return Assemble([
            "<< /Type /Catalog /Pages 2 0 R >>"u8.ToArray(),
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"u8.ToArray(),
            Encoding.ASCII.GetBytes(
                $"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PageWidth} {PageHeight}] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>"
            ),
            Stream("", content),
            Stream(
                $"/Type /XObject /Subtype /Image /Width {width} /Height {height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode",
                jpeg
            ),
        ]);
    }

    private static byte[] Page(string[] lines)
    {
        var text = new StringBuilder("BT /F1 22 Tf 30 TL 60 720 Td\n");
        foreach (var line in lines)
            text.Append('(').Append(Escape(line)).Append(") Tj T*\n");
        text.Append("ET");
        return Encoding.Latin1.GetBytes(text.ToString());
    }

    private static byte[] Pdf(IReadOnlyList<byte[]> contents)
    {
        // 1 catalog, 2 pages, 3 font, then a page and its content stream per page.
        var objects = new List<byte[]>
        {
            "<< /Type /Catalog /Pages 2 0 R >>"u8.ToArray(),
            Encoding.ASCII.GetBytes(
                $"<< /Type /Pages /Kids [{string.Join(' ', contents.Select((_, index) => $"{4 + (index * 2)} 0 R"))}] /Count {contents.Count} >>"
            ),
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"u8.ToArray(),
        };
        for (var index = 0; index < contents.Count; index++)
        {
            objects.Add(
                Encoding.ASCII.GetBytes(
                    $"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PageWidth} {PageHeight}] /Contents {5 + (index * 2)} 0 R /Resources << /Font << /F1 3 0 R >> >> >>"
                )
            );
            objects.Add(Stream("", contents[index]));
        }
        return Assemble(objects);
    }

    private static byte[] Stream(string dictionary, byte[] data)
    {
        using var stream = new MemoryStream();
        stream.Write(
            Encoding.ASCII.GetBytes(
                $"<< {dictionary} /Length {data.Length.ToString(CultureInfo.InvariantCulture)} >>\nstream\n"
            )
        );
        stream.Write(data);
        stream.Write("\nendstream"u8);
        return stream.ToArray();
    }

    // Objects numbered from 1, with a correct cross-reference table.
    private static byte[] Assemble(IReadOnlyList<byte[]> objects)
    {
        using var pdf = new MemoryStream();
        pdf.Write("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"u8);
        var offsets = new List<long>();
        for (var index = 0; index < objects.Count; index++)
        {
            offsets.Add(pdf.Position);
            pdf.Write(Encoding.ASCII.GetBytes($"{index + 1} 0 obj\n"));
            pdf.Write(objects[index]);
            pdf.Write("\nendobj\n"u8);
        }
        var xref = pdf.Position;
        var table = new StringBuilder($"xref\n0 {objects.Count + 1}\n0000000000 65535 f \n");
        foreach (var offset in offsets)
            table
                .Append(offset.ToString("D10", CultureInfo.InvariantCulture))
                .Append(" 00000 n \n");
        table.Append(
            CultureInfo.InvariantCulture,
            $"trailer\n<< /Size {objects.Count + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"
        );
        pdf.Write(Encoding.ASCII.GetBytes(table.ToString()));
        return pdf.ToArray();
    }

    private static string Escape(string line) =>
        line.Replace("\\", "\\\\", StringComparison.Ordinal)
            .Replace("(", "\\(", StringComparison.Ordinal)
            .Replace(")", "\\)", StringComparison.Ordinal);

    // pdftoppm from standard input to standard output, like the server.
    private static byte[] Render(byte[] pdf, string format)
    {
        var start = new ProcessStartInfo("pdftoppm")
        {
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        foreach (
            var argument in new[]
            {
                "-r",
                Dpi.ToString(CultureInfo.InvariantCulture),
                "-gray",
                format,
                "-singlefile",
                "-",
            }
        )
            start.ArgumentList.Add(argument);
        using var process =
            Process.Start(start)
            ?? throw new InvalidOperationException("pdftoppm could not be started.");
        var error = process.StandardError.ReadToEndAsync();
        using var output = new MemoryStream();
        var copy = process.StandardOutput.BaseStream.CopyToAsync(output);
        process.StandardInput.BaseStream.Write(pdf);
        process.StandardInput.Close();
        copy.GetAwaiter().GetResult();
        process.WaitForExit();
        if (process.ExitCode != 0)
            throw new InvalidOperationException(
                "pdftoppm failed: " + error.GetAwaiter().GetResult()
            );
        return output.ToArray();
    }
}
