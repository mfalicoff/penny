using System.Text.Json.Nodes;

namespace Penny.Backend.UnitTests.Ledgers;

// Reads the language-neutral fixtures shared with the legacy Node tests.
public static class ContractFixtures
{
    public static JsonNode Read(string name) => JsonNode.Parse(Text(name))!;

    // The raw fixture text, for strict typed decoding and manifest hashes.
    public static string Text(string name)
    {
        for (
            var directory = new DirectoryInfo(AppContext.BaseDirectory);
            directory is not null;
            directory = directory.Parent
        )
        {
            var path = Path.Combine(directory.FullName, "contracts", "fixtures", name);
            if (File.Exists(path))
                return File.ReadAllText(path);
        }
        throw new FileNotFoundException("Contract fixture not found.", name);
    }
}
