-- Run as schema owner/admin after every `migrate`, with psql --set=ON_ERROR_STOP=1.
-- Idempotent: grants cover tables added by new migrations without editing this file.
GRANT USAGE ON SCHEMA penny TO penny_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA penny TO penny_runtime;
-- Migration history and import checkpoints stay read-only for the runtime role.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON penny."__EFMigrationsHistory", penny.sqlite_import FROM penny_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA penny TO penny_runtime;
