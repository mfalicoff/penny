using System.Text.Json;

namespace Penny.Backend.UnitTests.Contracts;

// Consumers per language: a list of suite paths, or a sentence naming why not (yet).
public sealed record FixtureManifestEntry(
    string File,
    string Sha256,
    string? GeneratedBy,
    IReadOnlyDictionary<string, JsonElement> Consumers
);
