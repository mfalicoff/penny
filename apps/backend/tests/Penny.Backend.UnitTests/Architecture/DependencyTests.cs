using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Architecture;

public sealed class DependencyTests
{
    [Fact]
    public void whenLayerReferencesInspected_GetReferencedAssemblies_ShouldContainOnlyInwardDependencies()
    {
        var domain =
            typeof(Penny.Backend.Domain.Errors.BackendFailure).Assembly.GetReferencedAssemblies();
        domain.ShouldNotContain(reference =>
            reference.Name!.StartsWith("Microsoft.AspNetCore", StringComparison.Ordinal)
            || reference.Name.StartsWith("Npgsql", StringComparison.Ordinal)
            || reference.Name.StartsWith("Penny.Backend.", StringComparison.Ordinal)
        );
        var application =
            typeof(Penny.Backend.Application.Abstractions.Persistence.IStorageReadiness).Assembly.GetReferencedAssemblies();
        application.ShouldNotContain(reference =>
            reference.Name!.Contains("Persistence", StringComparison.Ordinal)
            || reference.Name.Contains("Api", StringComparison.Ordinal)
            || reference.Name.StartsWith("Npgsql", StringComparison.Ordinal)
        );
    }
}
