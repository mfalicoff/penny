using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Schema.Mappings;

internal sealed class MailOutboxMessageMapping : IEntityTypeConfiguration<MailOutboxMessage>
{
    public void Configure(EntityTypeBuilder<MailOutboxMessage> builder)
    {
        builder.ToTable("mail_outbox", table =>
        {
            table.HasCheckConstraint("ck_mail_outbox_attempts", "attempts >= 0");
            table.HasCheckConstraint("ck_mail_outbox_lease", Checks.Lease);
            table.HasCheckConstraint(
                "ck_mail_outbox_kind",
                "(kind IN ('password-reset', 'email-verification') AND user_id IS NOT NULL AND email_invite_id IS NULL) OR (kind = 'household-invite' AND email_invite_id IS NOT NULL AND user_id IS NULL)"
            );
            table.HasCheckConstraint("ck_mail_outbox_locale", Checks.In("locale", "('en','fr')"));
            table.HasCheckConstraint(
                "ck_mail_outbox_recipient_hash",
                "recipient_hash ~ '^[0-9a-f]{64}$'"
            );
            table.HasCheckConstraint(
                "ck_mail_outbox_sent",
                "sent_at IS NULL OR finished_at IS NOT NULL"
            );
        });
        builder.HasKey(message => message.Id);
        builder.HasOne<User>().WithMany().HasForeignKey(message => message.UserId);
        builder.HasOne<User>().WithMany().HasForeignKey(message => message.AccountId);
        builder
            .HasOne<HouseholdEmailInvite>()
            .WithMany()
            .HasForeignKey(message => message.EmailInviteId);
        builder
            .HasIndex(message => message.NextAttemptAt)
            .HasFilter("finished_at IS NULL")
            .HasDatabaseName("ix_mail_outbox_due");
        // Rate limits count a recipient's and an account's recent messages.
        builder
            .HasIndex(message => new { message.RecipientHash, message.CreatedAt })
            .HasDatabaseName("ix_mail_outbox_recipient");
        builder
            .HasIndex(message => new { message.AccountId, message.CreatedAt })
            .HasDatabaseName("ix_mail_outbox_account");
        builder.HasIndex(message => message.EmailInviteId);
        builder.HasIndex(message => message.UserId);
        builder.HasIndex(message => message.CreatedAt);
    }
}
