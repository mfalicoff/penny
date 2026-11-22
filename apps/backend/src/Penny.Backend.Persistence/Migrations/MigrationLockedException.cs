namespace Penny.Backend.Persistence.Migrations;

// Another process (a second API replica, or the `migrate` command) is migrating.
public sealed class MigrationLockedException()
    : DatabaseSetupException(
        "Another database migration holds the lock. Retry after it completes."
    );
