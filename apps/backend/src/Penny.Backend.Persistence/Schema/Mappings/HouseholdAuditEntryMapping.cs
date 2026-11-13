using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Schema.Mappings;

internal sealed class HouseholdAuditEntryMapping : IEntityTypeConfiguration<HouseholdAuditEntry>
{
    public void Configure(EntityTypeBuilder<HouseholdAuditEntry> builder)
    {
        builder.ToTable("household_audit");
        // sort_order is an identity; it breaks created_at ties like the legacy rowid.
        builder.HasKey(entry => entry.SortOrder);
        builder.Property(entry => entry.SortOrder).UseIdentityByDefaultColumn();
        builder.Property(entry => entry.Id).IsRequired();
        builder.HasIndex(entry => entry.Id).IsUnique();
        builder.Property(entry => entry.BeforeJson).HasColumnType("jsonb");
        builder.Property(entry => entry.AfterJson).HasColumnType("jsonb");
        builder.HasOne<Household>().WithMany().HasForeignKey(entry => entry.HouseholdId);
        builder.HasOne<User>().WithMany().HasForeignKey(entry => entry.ActorId);
        // expense_id is historical and has no foreign key.
        builder
            .HasIndex(entry => new
            {
                entry.HouseholdId,
                entry.CreatedAt,
                entry.SortOrder,
            })
            .IsDescending(false, true, true)
            .HasDatabaseName("ix_household_audit_history");
        builder
            .HasIndex(entry => new
            {
                entry.HouseholdId,
                entry.ExpenseId,
                entry.CreatedAt,
                entry.SortOrder,
            })
            .IsDescending(false, false, true, true)
            .HasDatabaseName("ix_household_audit_expense_history");
    }
}
