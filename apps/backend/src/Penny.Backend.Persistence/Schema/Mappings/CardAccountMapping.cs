using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Schema.Mappings;

internal sealed class CardAccountMapping : IEntityTypeConfiguration<CardAccount>
{
    public void Configure(EntityTypeBuilder<CardAccount> builder)
    {
        builder.ToTable("card_accounts", table =>
        {
            table.HasCheckConstraint("ck_card_accounts_card", Checks.Length("card", 1, 50));
            table.HasCheckConstraint(
                "ck_card_accounts_account_id",
                Checks.Length("account_id", 1, 100)
            );
        });
        // One account per card name, compared without case by the service.
        builder.HasKey(card => new { card.UserId, card.Card });
        builder.HasOne<User>().WithMany().HasForeignKey(card => card.UserId);
    }
}
