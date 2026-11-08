using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Schema.Mappings;

internal sealed class SqliteImportCheckpointMapping
    : IEntityTypeConfiguration<SqliteImportCheckpoint>
{
    public void Configure(EntityTypeBuilder<SqliteImportCheckpoint> builder)
    {
        builder.ToTable(
            "sqlite_import",
            table =>
            {
                table.HasCheckConstraint("ck_sqlite_import_singleton", "singleton");
                table.HasCheckConstraint(
                    "ck_sqlite_import_sha256",
                    "source_sha256 ~ '^[0-9A-F]{64}$'"
                );
                table.HasCheckConstraint("ck_sqlite_import_version", "source_version = 2");
                table.HasCheckConstraint(
                    "ck_sqlite_import_status",
                    "status IN ('pending','complete')"
                );
                table.HasCheckConstraint(
                    "ck_sqlite_import_manifest",
                    "(status = 'complete') = (manifest IS NOT NULL)"
                );
            }
        );
        builder.HasKey(checkpoint => checkpoint.Singleton);
        builder.Property(checkpoint => checkpoint.Singleton).ValueGeneratedNever();
        builder.Property(checkpoint => checkpoint.Manifest).HasColumnType("jsonb");
    }
}
