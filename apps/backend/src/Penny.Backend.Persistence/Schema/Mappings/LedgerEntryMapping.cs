using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Schema.Mappings;

internal sealed class LedgerEntryMapping : IEntityTypeConfiguration<LedgerEntry>
{
    public void Configure(EntityTypeBuilder<LedgerEntry> builder)
    {
        builder.ToTable("ledger_entries", table =>
        {
            table.HasCheckConstraint("ck_ledger_entries_id", Checks.Length("id", 1, 100));
            table.HasCheckConstraint("ck_ledger_entries_title", Checks.Length("title", 1, 100));
            table.HasCheckConstraint("ck_ledger_entries_kind", Checks.In("kind", Checks.Kinds));
            table.HasCheckConstraint("ck_ledger_entries_total", Checks.Cents("total_cents", 1));
            table.HasCheckConstraint(
                "ck_ledger_entries_share",
                "share_cents BETWEEN 0 AND total_cents"
            );
            table.HasCheckConstraint("ck_ledger_entries_note", Checks.Length("note", 0, 1000));
            table.HasCheckConstraint(
                "ck_ledger_entries_participants",
                Checks.Participants("participants")
            );
            table.HasCheckConstraint(
                "ck_ledger_entries_participants_kind",
                Checks.ParticipantsExpenseOnly("participants")
            );
            // Contract 2.4.0: the foreign-amount columns (the conversion itself is checked by
            // LedgerReader, which knows the ledger's currency).
            table.HasCheckConstraint(
                "ck_ledger_entries_original_amount",
                $"original_amount IS NULL OR {Checks.Cents("original_amount", 1)}"
            );
            table.HasCheckConstraint(
                "ck_ledger_entries_original_currency",
                "original_currency IS NULL OR original_currency ~ '^[A-Z]{3}$'"
            );
            table.HasCheckConstraint(
                "ck_ledger_entries_rate",
                $"rate IS NULL OR ({Checks.Rate("rate")})"
            );
            table.HasCheckConstraint(
                "ck_ledger_entries_rate_status",
                $"rate_status IS NULL OR {Checks.In("rate_status", Checks.RateStatuses)}"
            );
            table.HasCheckConstraint(
                "ck_ledger_entries_foreign",
                "(original_amount IS NULL) = (original_currency IS NULL) AND (original_currency IS NULL) = (rate IS NULL) AND (rate IS NULL) = (rate_status IS NULL)"
            );
            table.HasCheckConstraint(
                "ck_ledger_entries_rate_date",
                "(rate_date IS NULL) = (rate_status IS NULL OR rate_status = 'edited')"
            );
        });
        builder.HasKey(entry => new { entry.UserId, entry.Id });
        builder.HasOne<Ledger>().WithMany().HasForeignKey(entry => entry.UserId);
        builder
            .HasOne<LedgerCategory>()
            .WithMany()
            .HasForeignKey(entry => new { entry.UserId, entry.CategoryId });
        builder
            .HasOne<LedgerAccount>()
            .WithMany()
            .HasForeignKey(entry => new { entry.UserId, entry.AccountId });
        builder
            .HasOne<LedgerTrip>()
            .WithMany()
            .HasForeignKey(entry => new { entry.UserId, entry.TripId });
        // Composite key: an entry can only attach a receipt its owner uploaded.
        builder
            .HasOne<Receipt>()
            .WithMany()
            .HasForeignKey(entry => new { entry.UserId, entry.ReceiptId })
            .HasPrincipalKey(receipt => new { receipt.UserId, receipt.Id });
        builder.HasIndex(entry => new { entry.UserId, entry.EntryDate });
        // recurring_id deliberately has no foreign key: occurrences outlive their rule.
    }
}
