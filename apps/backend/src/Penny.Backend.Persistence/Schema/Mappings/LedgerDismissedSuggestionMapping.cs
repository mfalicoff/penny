using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Schema.Mappings;

internal sealed class LedgerDismissedSuggestionMapping
    : IEntityTypeConfiguration<LedgerDismissedSuggestion>
{
    public void Configure(EntityTypeBuilder<LedgerDismissedSuggestion> builder)
    {
        builder.ToTable("ledger_dismissed_suggestions", table =>
        {
            table.HasCheckConstraint(
                "ck_ledger_dismissed_suggestions_value",
                Checks.Length("value", 1, 200)
            );
            table.HasCheckConstraint(
                "ck_ledger_dismissed_suggestions_position",
                "position BETWEEN 0 AND 499"
            );
        });
        // Keyed by value: the strings are unique per ledger, and a save that reorders
        // them only updates positions (a unique position would collide mid-update).
        builder.HasKey(suggestion => new { suggestion.UserId, suggestion.Value });
        builder.HasOne<Ledger>().WithMany().HasForeignKey(suggestion => suggestion.UserId);
    }
}
