namespace Penny.Backend.IntegrationTests.Infrastructure;

// The pinned search model downloaded by apps/backend/development/download-model.mjs
// into the repository's ignored .cache (CI caches it). `Search__ModelDirectory`
// overrides the location. A missing model fails the host; nothing is faked.
public static class SearchModel
{
    public static string Directory { get; } = Locate();

    private static string Locate()
    {
        if (
            Environment.GetEnvironmentVariable("Search__ModelDirectory") is
            { Length: > 0 } configured
        )
            return configured;
        for (
            var directory = new DirectoryInfo(AppContext.BaseDirectory);
            directory is not null;
            directory = directory.Parent
        )
            if (File.Exists(Path.Combine(directory.FullName, "contracts", "openapi.json")))
                return Path.Combine(
                    directory.FullName,
                    ".cache",
                    "backend",
                    "models",
                    "multilingual-e5-small"
                );
        throw new DirectoryNotFoundException("Repository root not found for the search model.");
    }
}
