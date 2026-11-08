using System.Text.Json.Nodes;

namespace Penny.Backend.IntegrationTests.Infrastructure;

// Reads the shared contract and the language-neutral fixtures used by the legacy
// Node tests, from the repository's `contracts/` directory.
public static class ContractFixtures
{
    public static JsonNode Read(string name) => Load(Path.Combine("contracts", "fixtures", name));

    public static JsonNode OpenApi() => Load(Path.Combine("contracts", "openapi.json"));

    private static JsonNode Load(string relativePath)
    {
        for (
            var directory = new DirectoryInfo(AppContext.BaseDirectory);
            directory is not null;
            directory = directory.Parent
        )
        {
            var path = Path.Combine(directory.FullName, relativePath);
            if (File.Exists(path))
                return JsonNode.Parse(File.ReadAllText(path))!;
        }
        throw new FileNotFoundException("Contract file not found.", relativePath);
    }
}
