namespace Penny.Backend.UnitTests.Contracts;

public sealed record FixtureManifest(
    int Version,
    string Description,
    IReadOnlyList<FixtureManifestEntry> Fixtures
);
