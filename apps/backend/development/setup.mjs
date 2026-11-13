import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const admin = randomBytes(24).toString("hex");
const migration = randomBytes(24).toString("hex");
const runtime = randomBytes(24).toString("hex");
const receiptKey = randomBytes(32).toString("base64");
// Encrypted receipt files for local imports; .cache/ is git-ignored.
// The pinned search model (download-model.mjs); .cache/ is git-ignored.
const modelDirectory = fileURLToPath(new URL("../../../.cache/backend/models/multilingual-e5-small", import.meta.url));
const receiptRoot = fileURLToPath(new URL("../../../.cache/backend/receipts", import.meta.url));
writeFileSync(new URL("../.env", import.meta.url), [
  `PENNY_ADMIN_PASSWORD=${admin}`,
  `PENNY_MIGRATION_PASSWORD=${migration}`,
  `PENNY_RUNTIME_PASSWORD=${runtime}`,
  `ConnectionStrings__Postgres='Host=127.0.0.1;Port=5433;Database=penny;Username=penny_runtime;Password=${runtime};SSL Mode=Disable'`,
  `ConnectionStrings__Migration='Host=127.0.0.1;Port=5433;Database=penny;Username=penny_migrator;Password=${migration};SSL Mode=Disable'`,
  `ConnectionStrings__Admin='Host=127.0.0.1;Port=5433;Database=penny;Username=postgres;Password=${admin};SSL Mode=Disable'`,
  `Receipts__Root='${receiptRoot}'`,
  `Receipts__MasterKey='${receiptKey}'`,
  `Search__ModelDirectory='${modelDirectory}'`,
  "ASPNETCORE_ENVIRONMENT=Development",
  "ASPNETCORE_URLS=http://127.0.0.1:5001",
  "",
].join("\n"), { flag: "wx", mode: 0o600 });
console.log("Created apps/backend/.env with unique local credentials. Existing files are never overwritten.");
