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
    public static byte[] ScannedPdf(params string[] lines) =>
        ScannedPdfPage(PageWidth, PageHeight, (0, 0, PageWidth, PageHeight, lines));

    // One scanned page `width` × `height` points: each block is a photo of its lines
    // drawn at (x, y) with the given size in points (y from the bottom). A huge page is
    // a few hundred bytes: its size is only declared.
    public static byte[] ScannedPdfPage(
        double width,
        double height,
        params (double X, double Y, double Width, double Height, string[] Lines)[] blocks
    )
    {
        var photoWidth = PageWidth * Dpi / 72;
        var photoHeight = PageHeight * Dpi / 72;
        var content = new StringBuilder();
        var resources = new StringBuilder();
        var objects = new List<byte[]>
        {
            "<< /Type /Catalog /Pages 2 0 R >>"u8.ToArray(),
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"u8.ToArray(),
        };
        for (var index = 0; index < blocks.Length; index++)
        {
            var (x, y, w, h, _) = blocks[index];
            content.Append(
                CultureInfo.InvariantCulture,
                $"q {w} 0 0 {h} {x} {y} cm /Im{index} Do Q\n"
            );
            resources.Append(CultureInfo.InvariantCulture, $"/Im{index} {5 + index} 0 R ");
        }
        objects.Add(
            Encoding.ASCII.GetBytes(
                string.Create(
                    CultureInfo.InvariantCulture,
                    $"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width} {height}] /Contents 4 0 R /Resources << /XObject << {resources}>> >> >>"
                )
            )
        );
        objects.Add(Stream("", Encoding.ASCII.GetBytes(content.ToString())));
        foreach (var block in blocks)
            objects.Add(
                Stream(
                    $"/Type /XObject /Subtype /Image /Width {photoWidth} /Height {photoHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode",
                    Render(TextPdf(block.Lines), "-jpeg")
                )
            );
        return Assemble(objects);
    }

    // A gray PNG `width` × `height` pixels, white, with a photo of each block's lines
    // pasted at its top row (left aligned). Mostly white rows compress to almost
    // nothing, so a 30000 × 30000 pixel image is well under a megabyte.
    public static byte[] Png(int width, int height, params (int Top, string[] Lines)[] blocks)
    {
        var photos = blocks
            .Select(block => (block.Top, Image: Gray(TextPdf(block.Lines))))
            .ToList();
        using var png = new MemoryStream();
        png.Write([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        var header = new byte[13];
        System.Buffers.Binary.BinaryPrimitives.WriteInt32BigEndian(header, width);
        System.Buffers.Binary.BinaryPrimitives.WriteInt32BigEndian(header.AsSpan(4), height);
        header[8] = 8; // bit depth; color type 0 (gray), default compression and filter
        Chunk(png, "IHDR", header);
        using (var data = new MemoryStream())
        {
            using (
                var zlib = new System.IO.Compression.ZLibStream(
                    data,
                    System.IO.Compression.CompressionLevel.Optimal,
                    leaveOpen: true
                )
            )
            {
                var row = new byte[width + 1];
                var white = new byte[width + 1];
                Array.Fill(white, (byte)0xFF);
                white[0] = 0;
                for (var y = 0; y < height; y++)
                {
                    var photo = photos.FirstOrDefault(item =>
                        y >= item.Top && y < item.Top + item.Image.Height
                    );
                    if (photo.Image is null)
                    {
                        zlib.Write(white);
                        continue;
                    }
                    white.CopyTo(row, 0);
                    var source = photo.Image.Pixels.AsSpan(
                        (y - photo.Top) * photo.Image.Width,
                        Math.Min(photo.Image.Width, width)
                    );
                    source.CopyTo(row.AsSpan(1));
                    zlib.Write(row);
                }
            }
            Chunk(png, "IDAT", data.ToArray());
        }
        Chunk(png, "IEND", []);
        return png.ToArray();
    }

    private sealed record GrayPhoto(int Width, int Height, byte[] Pixels);

    // pdftoppm's 8-bit gray PGM of the first page.
    private static GrayPhoto Gray(byte[] pdf)
    {
        var pgm = Render(pdf, "-gray");
        var fields = new List<string>();
        var position = 0;
        while (fields.Count < 4)
        {
            while (char.IsWhiteSpace((char)pgm[position]))
                position++;
            var start = position;
            while (!char.IsWhiteSpace((char)pgm[position]))
                position++;
            fields.Add(Encoding.ASCII.GetString(pgm, start, position - start));
        }
        var width = int.Parse(fields[1], CultureInfo.InvariantCulture);
        var height = int.Parse(fields[2], CultureInfo.InvariantCulture);
        return new(width, height, pgm[(position + 1)..]);
    }

    private static void Chunk(Stream png, string type, byte[] data)
    {
        var length = new byte[4];
        System.Buffers.Binary.BinaryPrimitives.WriteInt32BigEndian(length, data.Length);
        png.Write(length);
        var typed = new byte[4 + data.Length];
        Encoding.ASCII.GetBytes(type).CopyTo(typed, 0);
        data.CopyTo(typed, 4);
        png.Write(typed);
        var crc = new byte[4];
        System.Buffers.Binary.BinaryPrimitives.WriteUInt32BigEndian(crc, Crc32(typed));
        png.Write(crc);
    }

    private static uint Crc32(byte[] data)
    {
        var crc = 0xFFFFFFFFu;
        foreach (var value in data)
        {
            crc ^= value;
            for (var bit = 0; bit < 8; bit++)
                crc = (crc & 1) != 0 ? (crc >> 1) ^ 0xEDB88320u : crc >> 1;
        }
        return ~crc;
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
