using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Schema.Mappings;

internal sealed class LedgerMapping : IEntityTypeConfiguration<Ledger>
{
    public void Configure(EntityTypeBuilder<Ledger> builder)
    {
        builder.ToTable(
            "ledgers",
            table =>
            {
                table.HasCheckConstraint(
                    "ck_ledgers_currency",
                    Checks.In("currency", Checks.Currencies)
                );
                table.HasCheckConstraint("ck_ledgers_revision", Checks.Revision("revision"));
            }
        );
        builder.HasKey(ledger => ledger.UserId);
        builder.HasOne<User>().WithOne().HasForeignKey<Ledger>(ledger => ledger.UserId);
    }
}
