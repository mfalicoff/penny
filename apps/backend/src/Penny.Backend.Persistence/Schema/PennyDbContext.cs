using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Conventions;
using Npgsql;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Schema;

public sealed class PennyDbContext(DbContextOptions<PennyDbContext> options) : DbContext(options)
{
    public const string SchemaName = "penny";
    public const string HistoryTable = "__EFMigrationsHistory";

    public DbSet<User> Users => Set<User>();
    public DbSet<OidcIdentity> OidcIdentities => Set<OidcIdentity>();
    public DbSet<Session> Sessions => Set<Session>();
    public DbSet<Receipt> Receipts => Set<Receipt>();
    public DbSet<Household> Households => Set<Household>();
    public DbSet<HouseholdMemberPeriod> HouseholdMemberPeriods => Set<HouseholdMemberPeriod>();
    public DbSet<HouseholdInvite> HouseholdInvites => Set<HouseholdInvite>();
    public DbSet<Ledger> Ledgers => Set<Ledger>();
    public DbSet<LedgerAccount> LedgerAccounts => Set<LedgerAccount>();
    public DbSet<LedgerCategory> LedgerCategories => Set<LedgerCategory>();
    public DbSet<LedgerTrip> LedgerTrips => Set<LedgerTrip>();
    public DbSet<LedgerRecurring> LedgerRecurring => Set<LedgerRecurring>();
    public DbSet<LedgerEntry> LedgerEntries => Set<LedgerEntry>();
    public DbSet<HouseholdRecurring> HouseholdRecurring => Set<HouseholdRecurring>();
    public DbSet<HouseholdRecurringAllocation> HouseholdRecurringAllocations =>
        Set<HouseholdRecurringAllocation>();
    public DbSet<HouseholdExpense> HouseholdExpenses => Set<HouseholdExpense>();
    public DbSet<HouseholdSplit> HouseholdSplits => Set<HouseholdSplit>();
    public DbSet<HouseholdReimbursement> HouseholdReimbursements => Set<HouseholdReimbursement>();
    public DbSet<HouseholdAuditEntry> HouseholdAudit => Set<HouseholdAuditEntry>();
    public DbSet<PushDevice> PushDevices => Set<PushDevice>();
    public DbSet<PushOutboxMessage> PushOutbox => Set<PushOutboxMessage>();
    public DbSet<PushDelivery> PushDeliveries => Set<PushDelivery>();
    public DbSet<SqliteImportCheckpoint> SqliteImport => Set<SqliteImportCheckpoint>();

    public static PennyDbContext Create(NpgsqlDataSource source) =>
        new(Configure(new DbContextOptionsBuilder<PennyDbContext>(), source).Options);

    // Runs on a caller-owned open connection, e.g. one holding the migration lock.
    public static PennyDbContext Create(NpgsqlConnection connection) =>
        new(
            new DbContextOptionsBuilder<PennyDbContext>()
                .UseNpgsql(
                    connection,
                    npgsql => npgsql.MigrationsHistoryTable(HistoryTable, SchemaName)
                )
                .Options
        );

    public static DbContextOptionsBuilder<PennyDbContext> Configure(
        DbContextOptionsBuilder<PennyDbContext> builder,
        NpgsqlDataSource source
    ) =>
        builder.UseNpgsql(
            source,
            npgsql => npgsql.MigrationsHistoryTable(HistoryTable, SchemaName)
        );

    protected override void ConfigureConventions(ModelConfigurationBuilder configurationBuilder)
    {
        // Relationships never cascade unless a mapping opts in explicitly.
        configurationBuilder.Conventions.Remove(typeof(CascadeDeleteConvention));
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema(SchemaName);
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(PennyDbContext).Assembly);
        foreach (var entity in modelBuilder.Model.GetEntityTypes())
        foreach (var property in entity.GetProperties())
        {
            property.SetColumnName(SnakeCase(property.Name));
            // Bytewise ordering/equality, matching the legacy SQLite BINARY collation.
            if (property.ClrType == typeof(string) && property.GetColumnType() is null)
                property.SetCollation("C");
        }
    }

    internal static string SnakeCase(string name)
    {
        var builder = new StringBuilder(name.Length + 8);
        for (var index = 0; index < name.Length; index++)
        {
            if (char.IsUpper(name[index]) && index > 0)
                builder.Append('_');
            builder.Append(char.ToLowerInvariant(name[index]));
        }
        return builder.ToString();
    }
}
