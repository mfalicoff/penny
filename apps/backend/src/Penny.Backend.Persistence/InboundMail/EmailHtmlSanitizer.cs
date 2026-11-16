using AngleSharp.Css.Dom;
using AngleSharp.Dom;
using AngleSharp.Html.Dom;
using Ganss.Xss;

namespace Penny.Backend.Persistence.InboundMail;

// Allowlist sanitizing of untrusted email HTML before it is rendered (MAZ-184,
// docs/plans/email-receipts.md#2-parsing-inbound-mail-worker):
// - No scripts, frames, objects, forms, SVG, MathML, base, link or meta; no event
//   handler attributes.
// - No URLs at all except `cid:` image sources, which become the `data:` PNGs libvips
//   re-encoded. Remote images are never fetched (SSRF, tracking pixels): they become a
//   "remote image not loaded" note. Links keep their text and lose `href`. CSS `url()`,
//   `@import` and `@font-face` are removed.
// The document is also rendered under a CSP that allows only `data:` images and inline
// styles, with JavaScript off, in a container with no network.
public static class EmailHtmlSanitizer
{
    public const string RemoteImageNote = "[remote image not loaded]";

    private static readonly string[] RemovedTags =
    [
        "form",
        "input",
        "button",
        "select",
        "textarea",
        "option",
        "optgroup",
        "label",
        "fieldset",
        "legend",
        "datalist",
        "output",
        "audio",
        "video",
        "source",
        "track",
        "picture",
        "map",
        "area",
        "iframe",
        "object",
        "embed",
        "svg",
        "math",
        "base",
        "link",
        "meta",
        "script",
        "noscript",
        "template",
        "slot",
        "dialog",
    ];

    private static readonly string[] RemovedAttributes =
    [
        "href",
        "action",
        "formaction",
        "srcset",
        "background",
        "ping",
        "poster",
        "usemap",
        "longdesc",
        "cite",
        "dynsrc",
        "lowsrc",
        "srcdoc",
        "xmlns",
    ];

    // `inlineImages` maps a Content-ID (without angle brackets) to its data URL.
    public static string Sanitize(string html, IReadOnlyDictionary<string, string> inlineImages)
    {
        var sanitizer = new HtmlSanitizer { KeepChildNodes = false, AllowDataAttributes = false };
        foreach (var tag in RemovedTags)
            sanitizer.AllowedTags.Remove(tag);
        foreach (var tag in new[] { "style", "center", "font" })
            sanitizer.AllowedTags.Add(tag);
        foreach (var attribute in RemovedAttributes)
            sanitizer.AllowedAttributes.Remove(attribute);
        foreach (var attribute in new[] { "bgcolor", "color", "face", "size", "valign", "align" })
            sanitizer.AllowedAttributes.Add(attribute);
        sanitizer.AllowedSchemes.Clear();
        sanitizer.AllowedSchemes.Add("cid");
        sanitizer.AllowedAtRules.Clear();
        sanitizer.AllowedAtRules.Add(CssRuleType.Media);
        sanitizer.AllowedAtRules.Add(CssRuleType.Style);
        sanitizer.FilterUrl += (_, args) =>
            args.SanitizedUrl =
                args.Tag is IHtmlImageElement image
                && string.Equals(
                    image.GetAttribute("src"),
                    args.OriginalUrl,
                    StringComparison.Ordinal
                )
                && InlineImage(args.OriginalUrl, inlineImages) is { } data
                    ? data
                    : null;
        sanitizer.PostProcessNode += (_, args) =>
        {
            if (args.Node is IHtmlImageElement image && !image.HasAttribute("src"))
            {
                var note = args.Document.CreateElement("span");
                note.SetAttribute("class", "penny-remote-image");
                note.TextContent = RemoteImageNote;
                args.ReplacementNodes.Add(note);
            }
        };
        return sanitizer.Sanitize(html);
    }

    private static string? InlineImage(string url, IReadOnlyDictionary<string, string> images)
    {
        if (!url.StartsWith("cid:", StringComparison.OrdinalIgnoreCase))
            return null;
        var id = Uri.UnescapeDataString(url[4..]).Trim().Trim('<', '>');
        return images.GetValueOrDefault(id);
    }
}
