using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Schema.Mappings;

internal sealed class LedgerAccountMapping : IEntityTypeConfiguration<LedgerAccount>
{
    public void Configure(EntityTypeBuilder<LedgerAccount> builder)
    {
        builder.ToTable(
            "ledger_accounts",
            table =>
            {
                table.HasCheckConstraint("ck_ledger_accounts_id", Checks.Length("id", 1, 100));
                table.HasCheckConstraint("ck_ledger_accounts_name", Checks.Length("name", 1, 50));
                table.HasCheckConstraint(
                    "ck_ledger_accounts_type",
                    Checks.In("type", "('bank','credit','cash','other')")
                );
            }
        );
        builder.HasKey(account => new { account.UserId, account.Id });
        builder.HasOne<Ledger>().WithMany().HasForeignKey(account => account.UserId);
    }
}
