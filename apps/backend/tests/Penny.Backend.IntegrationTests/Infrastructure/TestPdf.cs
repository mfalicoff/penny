using System.Globalization;
using System.Text;

namespace Penny.Backend.IntegrationTests.Infrastructure;

// A minimal valid PDF with `pages` blank pages (correct xref), for pdfinfo. Synthetic.
public static class TestPdf
{
    public static byte[] Create(int pages = 1)
    {
        var objects = new List<string>
        {
            "<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Kids ["
                + string.Join(' ', Enumerable.Range(0, pages).Select(index => $"{index + 3} 0 R"))
                + $"] /Count {pages} >>",
        };
        for (var index = 0; index < pages; index++)
            objects.Add("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>");
        var pdf = new StringBuilder("%PDF-1.7\n");
        var offsets = new List<int>();
        for (var index = 0; index < objects.Count; index++)
        {
            offsets.Add(Encoding.ASCII.GetByteCount(pdf.ToString()));
            pdf.Append(
                CultureInfo.InvariantCulture,
                $"{index + 1} 0 obj\n{objects[index]}\nendobj\n"
            );
        }
        var xref = Encoding.ASCII.GetByteCount(pdf.ToString());
        pdf.Append(
            CultureInfo.InvariantCulture,
            $"xref\n0 {objects.Count + 1}\n0000000000 65535 f \n"
        );
        foreach (var offset in offsets)
            pdf.Append(CultureInfo.InvariantCulture, $"{offset:D10} 00000 n \n");
        pdf.Append(
            CultureInfo.InvariantCulture,
            $"trailer\n<< /Size {objects.Count + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"
        );
        return Encoding.ASCII.GetBytes(pdf.ToString());
    }
}
