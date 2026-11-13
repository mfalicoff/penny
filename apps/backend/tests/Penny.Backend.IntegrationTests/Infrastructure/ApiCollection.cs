using Xunit;

namespace Penny.Backend.IntegrationTests.Infrastructure;

[CollectionDefinition(Name)]
public sealed class ApiCollection : ICollectionFixture<ApiFixture>
{
    public const string Name = "postgres-api";
}
