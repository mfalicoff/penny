using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Penny.Backend.Persistence.Schema;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Architecture;

public sealed class MigrationModelTests
{
    [Fact]
    public void whenModelComparedToSnapshot_PendingModelChanges_ShouldBeNone()
    {
        // Fails when a mapping changed without `dotnet ef migrations add`.
        using var context = new PennyDesignTimeFactory().CreateDbContext([]);
        context.Database.HasPendingModelChanges().ShouldBeFalse();
    }

    [Fact]
    public void whenModelBuilt_TextColumns_ShouldUseBytewiseCollationOrJsonb()
    {
        using var context = new PennyDesignTimeFactory().CreateDbContext([]);
        var text = context
            .GetService<IDesignTimeModel>()
            .Model.GetEntityTypes()
            .SelectMany(entity => entity.GetProperties())
            .Where(property => property.ClrType == typeof(string))
            .ToList();
        text.ShouldNotBeEmpty();
        text.ShouldAllBe(property =>
            property.GetCollation() == "C" || property.GetColumnType() == "jsonb"
        );
    }
}
