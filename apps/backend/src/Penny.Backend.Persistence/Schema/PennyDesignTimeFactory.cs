using Microsoft.EntityFrameworkCore.Design;
using Npgsql;

namespace Penny.Backend.Persistence.Schema;

// Used only by `dotnet ef migrations ...`; it never opens a connection.
public sealed class PennyDesignTimeFactory : IDesignTimeDbContextFactory<PennyDbContext>
{
    public PennyDbContext CreateDbContext(string[] args) =>
        PennyDbContext.Create(
            NpgsqlDataSource.Create("Host=design-time;Database=penny;Username=design-time")
        );
}
