using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Schema.Mappings;

internal sealed class LedgerCategoryMapping : IEntityTypeConfiguration<LedgerCategory>
{
    public void Configure(EntityTypeBuilder<LedgerCategory> builder)
    {
        builder.ToTable(
            "ledger_categories",
            table =>
            {
                table.HasCheckConstraint("ck_ledger_categories_id", Checks.Length("id", 1, 100));
                table.HasCheckConstraint("ck_ledger_categories_name", Checks.Length("name", 0, 50));
                table.HasCheckConstraint("ck_ledger_categories_icon", Checks.Length("icon", 0, 80));
                table.HasCheckConstraint("ck_ledger_categories_color", Checks.Color("color"));
                table.HasCheckConstraint(
                    "ck_ledger_categories_kind",
                    Checks.In("kind", Checks.Kinds)
                );
            }
        );
        builder.HasKey(category => new { category.UserId, category.Id });
        builder.HasOne<Ledger>().WithMany().HasForeignKey(category => category.UserId);
    }
}
