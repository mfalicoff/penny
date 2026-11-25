using System.Reflection;
using Penny.Backend.Domain.Errors;
using Shouldly;

namespace Penny.Backend.IntegrationTests.Infrastructure;

// Every value in `ErrorCodes` (MAZ-187), for checking the `code` of an error envelope.
public static class ErrorCodeCatalog
{
    public static IReadOnlySet<string> All { get; } =
        typeof(ErrorCodes)
            .GetFields(BindingFlags.Public | BindingFlags.Static)
            .Where(field => field.IsLiteral)
            .Select(field => (string)field.GetRawConstantValue()!)
            .ToHashSet(StringComparer.Ordinal);

    // A product error always names a code from the catalogue; test-only controls use `test.`.
    public static void ShouldBeKnown(string? code)
    {
        code.ShouldNotBeNullOrEmpty();
        if (!code.StartsWith("test.", StringComparison.Ordinal))
            All.ShouldContain(code, $"'{code}' is not in ErrorCodes.");
    }
}
