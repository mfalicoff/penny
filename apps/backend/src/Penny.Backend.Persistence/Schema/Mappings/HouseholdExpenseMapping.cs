using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Schema.Mappings;

internal sealed class HouseholdExpenseMapping : IEntityTypeConfiguration<HouseholdExpense>
{
    public void Configure(EntityTypeBuilder<HouseholdExpense> builder)
    {
        builder.ToTable("household_expenses", table =>
        {
            table.HasCheckConstraint("ck_household_expenses_total", Checks.Cents("total_cents", 1));
            table.HasCheckConstraint(
                "ck_household_expenses_split_mode",
                Checks.In("split_mode", Checks.SplitModes)
            );
            table.HasCheckConstraint(
                "ck_household_expenses_category_name",
                Checks.Length("category_name", 1, 50)
            );
            table.HasCheckConstraint(
                "ck_household_expenses_category_icon",
                Checks.Length("category_icon", 0, 80)
            );
            table.HasCheckConstraint(
                "ck_household_expenses_category_color",
                Checks.Color("category_color")
            );
            table.HasCheckConstraint("ck_household_expenses_note", Checks.Length("note", 0, 1000));
            table.HasCheckConstraint("ck_household_expenses_revision", Checks.Revision("revision"));
            // Contract 2.5.0: the foreign-amount columns (the conversion itself is checked by
            // SharedExpenseService, which knows the household's currency).
            table.HasCheckConstraint(
                "ck_household_expenses_original_amount",
                $"original_amount IS NULL OR {Checks.Cents("original_amount", 1)}"
            );
            table.HasCheckConstraint(
                "ck_household_expenses_original_currency",
                $"original_currency IS NULL OR {Checks.CurrencyCode("original_currency")}"
            );
            table.HasCheckConstraint(
                "ck_household_expenses_rate",
                $"rate IS NULL OR ({Checks.Rate("rate")})"
            );
            table.HasCheckConstraint(
                "ck_household_expenses_rate_status",
                $"rate_status IS NULL OR {Checks.In("rate_status", Checks.RateStatuses)}"
            );
            table.HasCheckConstraint(
                "ck_household_expenses_foreign",
                "(original_amount IS NULL) = (original_currency IS NULL) AND (original_currency IS NULL) = (rate IS NULL) AND (rate IS NULL) = (rate_status IS NULL)"
            );
            table.HasCheckConstraint(
                "ck_household_expenses_rate_date",
                "(rate_date IS NULL) = (rate_status IS NULL OR rate_status = 'edited')"
            );
        });
        builder.HasKey(expense => expense.Id);
        builder.HasOne<Household>().WithMany().HasForeignKey(expense => expense.HouseholdId);
        builder.HasOne<User>().WithMany().HasForeignKey(expense => expense.PayerId);
        builder.HasOne<User>().WithMany().HasForeignKey(expense => expense.CreatedBy);
        builder.HasOne<User>().WithMany().HasForeignKey(expense => expense.UpdatedBy);
        builder.HasOne<Receipt>().WithMany().HasForeignKey(expense => expense.ReceiptId);
        // recurring_id has no foreign key: occurrences outlive their rule.
        builder
            .HasIndex(expense => new { expense.RecurringId, expense.ExpenseDate })
            .IsUnique()
            .HasFilter("recurring_id IS NOT NULL")
            .HasDatabaseName("ix_household_expenses_recurring_occurrence");
        builder
            .HasIndex(expense => new { expense.HouseholdId, expense.ExpenseDate })
            .HasFilter("deleted_at IS NULL")
            .HasDatabaseName("ix_household_expenses_live");
    }
}
