using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Schema.Mappings;

internal sealed class HouseholdReimbursementMapping
    : IEntityTypeConfiguration<HouseholdReimbursement>
{
    public void Configure(EntityTypeBuilder<HouseholdReimbursement> builder)
    {
        builder.ToTable(
            "household_reimbursements",
            table =>
            {
                table.HasCheckConstraint(
                    "ck_household_reimbursements_month",
                    "month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'"
                );
                table.HasCheckConstraint(
                    "ck_household_reimbursements_amount",
                    Checks.Cents("amount_cents")
                );
            }
        );
        builder.HasKey(payment => payment.Id);
        builder.HasOne<Household>().WithMany().HasForeignKey(payment => payment.HouseholdId);
        builder.HasOne<User>().WithMany().HasForeignKey(payment => payment.FromUserId);
        builder.HasOne<User>().WithMany().HasForeignKey(payment => payment.ToUserId);
        builder.HasOne<User>().WithMany().HasForeignKey(payment => payment.CreatedBy);
        builder.HasOne<HouseholdExpense>().WithMany().HasForeignKey(payment => payment.ExpenseId);
        builder.HasIndex(payment => new { payment.HouseholdId, payment.Month });
        builder
            .HasIndex(payment => new { payment.ExpenseId, payment.FromUserId })
            .IsUnique()
            .HasFilter("expense_id IS NOT NULL")
            .HasDatabaseName("ix_household_reimbursements_expense_payment");
    }
}
