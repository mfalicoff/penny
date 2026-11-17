namespace Penny.Backend.AppHost;

// penny-render (emailed receipts, MAZ-184) as deployed: the image and command of the
// `penny-render` service in deploy/compose.yaml, so local development runs exactly the
// pinned Gotenberg and hardening flags production does.
public sealed record RenderService(PinnedImage Image, IReadOnlyList<string> Command)
{
    public static RenderService Read(string repository)
    {
        var lines = File.ReadAllLines(Path.Combine(repository, "deploy/compose.yaml"));
        var start = Array.IndexOf(lines, "  penny-render:");
        if (start < 0)
            throw new InvalidOperationException(
                "deploy/compose.yaml defines no penny-render service."
            );
        string? image = null;
        var command = new List<string>();
        var inCommand = false;
        for (
            var index = start + 1;
            index < lines.Length
                && (
                    lines[index].Length == 0
                    || lines[index].StartsWith("    ", StringComparison.Ordinal)
                );
            index++
        )
        {
            var line = lines[index];
            if (line.StartsWith("    image: ", StringComparison.Ordinal))
                image = line["    image: ".Length..].Trim();
            else if (line == "    command:")
                inCommand = true;
            else if (inCommand && line.StartsWith("      - ", StringComparison.Ordinal))
                command.Add(line["      - ".Length..].Trim());
            else
                inCommand = false;
        }
        if (image is null || !command.Contains("--chromium-disable-javascript"))
            throw new InvalidOperationException(
                "penny-render in deploy/compose.yaml is incomplete."
            );
        return new(PinnedImage.Parse(image), command);
    }
}
