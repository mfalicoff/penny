using System.Globalization;
using System.Text;
using Penny.Backend.Application.Receipts;
using Penny.Backend.Domain.Ledgers;

namespace Penny.Backend.Persistence.InboundMail;

// Display text taken from untrusted mail headers (MAZ-184): control, format (bidi
// overrides, zero-width) and unpaired surrogate characters are removed, whitespace is
// collapsed and the result is bounded. Clients show it as plain text only.
public static class MailText
{
    public static string Clean(string? value, int maxLength = 300)
    {
        if (string.IsNullOrEmpty(value))
            return "";
        var builder = new StringBuilder(Math.Min(value.Length, maxLength * 2));
        var space = false;
        foreach (var rune in value.EnumerateRunes())
        {
            var category = Rune.GetUnicodeCategory(rune);
            if (Rune.IsWhiteSpace(rune) || category is UnicodeCategory.Control)
            {
                space = builder.Length > 0;
                continue;
            }
            if (
                category
                is UnicodeCategory.Format
                    or UnicodeCategory.Surrogate
                    or UnicodeCategory.PrivateUse
                    or UnicodeCategory.OtherNotAssigned
            )
                continue;
            if (space)
                builder.Append(' ');
            space = false;
            builder.Append(rune.ToString());
            if (builder.Length >= maxLength)
                break;
        }
        var text = builder.ToString();
        return LedgerText.IsStorable(text) ? text : "";
    }

    // A display-only file name: cleaned, path separators removed, at most 255
    // characters with the extension kept, never empty.
    public static string FileName(string? name, string fallbackExtension)
    {
        var cleaned = Clean(name, 1000)
            .Replace('/', '_')
            .Replace('\\', '_')
            .Replace(':', '_')
            .Trim(' ', '.');
        if (cleaned.Length == 0)
            cleaned = "attachment" + fallbackExtension;
        if (cleaned.Length <= ReceiptFormat.MaxNameLength)
            return cleaned;
        var extension = Path.GetExtension(cleaned);
        if (extension.Length > 16)
            extension = "";
        return cleaned[..(ReceiptFormat.MaxNameLength - extension.Length)] + extension;
    }

    public static string Extension(string mime) =>
        mime switch
        {
            "application/pdf" => ".pdf",
            "image/jpeg" => ".jpg",
            "image/png" => ".png",
            "image/webp" => ".webp",
            "image/gif" => ".gif",
            "image/heic" => ".heic",
            "image/heif" => ".heif",
            _ => "",
        };
}
