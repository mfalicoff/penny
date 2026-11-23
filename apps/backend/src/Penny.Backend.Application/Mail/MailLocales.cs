namespace Penny.Backend.Application.Mail;

// Templates exist in English and French. The request's preferred language picks one:
// the first `Accept-Language` tag that is English or French wins, otherwise English.
public static class MailLocales
{
    public const string English = "en";
    public const string French = "fr";

    public static string From(string? acceptLanguage)
    {
        if (string.IsNullOrWhiteSpace(acceptLanguage))
            return English;
        foreach (var part in acceptLanguage.Split(',', StringSplitOptions.TrimEntries))
        {
            var tag = part.Split(';', 2)[0].Trim();
            if (tag.StartsWith("fr", StringComparison.OrdinalIgnoreCase))
                return French;
            if (tag.StartsWith("en", StringComparison.OrdinalIgnoreCase))
                return English;
        }
        return English;
    }
}
