using System.Text.Json;
using System.Text.Json.Serialization;
using Penny.Backend.UnitTests.Ledgers;

namespace Penny.Backend.UnitTests.Contracts;

// Typed fixture decoding that fails on unknown, missing or null-for-non-null members,
// matching the strict zod (TypeScript) and Codable (Swift) fixture models.
public static class StrictJson
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        RespectRequiredConstructorParameters = true,
        RespectNullableAnnotations = true,
    };

    public static T Read<T>(string fixture) =>
        JsonSerializer.Deserialize<T>(ContractFixtures.Text(fixture), Options)
        ?? throw new JsonException($"{fixture} is empty.");
}
