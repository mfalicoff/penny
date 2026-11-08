import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const admin = randomBytes(24).toString("hex");
const migration = randomBytes(24).toString("hex");
const runtime = randomBytes(24).toString("hex");
writeFileSync(new URL("../.env", import.meta.url), [
  `PENNY_ADMIN_PASSWORD=${admin}`,
  `PENNY_MIGRATION_PASSWORD=${migration}`,
  `PENNY_RUNTIME_PASSWORD=${runtime}`,
  `ConnectionStrings__Postgres='Host=127.0.0.1;Port=5433;Database=penny;Username=penny_runtime;Password=${runtime};SSL Mode=Disable'`,
  `ConnectionStrings__Migration='Host=127.0.0.1;Port=5433;Database=penny;Username=penny_migrator;Password=${migration};SSL Mode=Disable'`,
  "ASPNETCORE_ENVIRONMENT=Development",
  "ASPNETCORE_URLS=http://127.0.0.1:5001",
  "",
].join("\n"), { flag: "wx", mode: 0o600 });
console.log("Created apps/backend/.env with unique local credentials. Existing files are never overwritten.");
