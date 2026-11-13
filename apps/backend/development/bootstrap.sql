-- Database bootstrap, run as an administrator connected to the target database by
-- `migrate --bootstrap` (embedded verbatim) before migrating. Idempotent: it creates
-- what is missing and leaves existing roles, schema and extensions alone. The role
-- passwords are set separately by the command, as SCRAM verifiers, never in plain text.
DO $bootstrap$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'penny_migrator') THEN
    CREATE ROLE penny_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'penny_runtime') THEN
    CREATE ROLE penny_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
  EXECUTE format('GRANT CONNECT, CREATE ON DATABASE %I TO penny_migrator', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO penny_runtime', current_database());
END
$bootstrap$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CREATE ON SCHEMA public TO penny_migrator;
CREATE SCHEMA IF NOT EXISTS penny AUTHORIZATION penny_migrator;
GRANT USAGE ON SCHEMA penny TO penny_runtime;
-- Search (MAZ-121): the administrator creates the extensions, in public (vector is not
-- a trusted extension). Migrations require them and readiness checks them.
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public;
CREATE EXTENSION IF NOT EXISTS vector SCHEMA public;
-- Metadata stays read-only. Product grants are applied after migration by
-- development/grant-runtime.sql (`migrate --grant-runtime`).
