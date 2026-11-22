namespace Penny.Backend.Persistence.Migrations;

// A database setup problem described in Penny's own words: a missing or invalid connection
// setting, the wrong PostgreSQL version, missing extensions, a newer schema or the migration
// lock. The message names no credential, host or row value, so it is safe to log as is
// (MigrationFailure.Describe).
public class DatabaseSetupException(string message) : InvalidOperationException(message);
