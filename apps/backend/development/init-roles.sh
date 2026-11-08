#!/usr/bin/env bash
set -euo pipefail
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 \
  --set=migration_password="$PENNY_MIGRATION_PASSWORD" \
  --set=runtime_password="$PENNY_RUNTIME_PASSWORD" <<'SQL'
CREATE ROLE penny_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'migration_password';
CREATE ROLE penny_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'runtime_password';
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT, CREATE ON DATABASE penny TO penny_migrator;
GRANT CREATE ON SCHEMA public TO penny_migrator;
GRANT CONNECT ON DATABASE penny TO penny_runtime;
CREATE SCHEMA penny AUTHORIZATION penny_migrator;
GRANT USAGE ON SCHEMA penny TO penny_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE penny_migrator IN SCHEMA penny GRANT SELECT ON TABLES TO penny_runtime;
SQL
