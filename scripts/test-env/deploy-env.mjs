// deploy/.env contents for a throwaway stack: the settings from deploy/.env.example
// with fresh random secrets (hex passwords, since they go into connection strings).
import { randomBytes } from "node:crypto";

export function deployEnv(origin, extra = {}) {
  const settings = {
    PENNY_PUBLIC_ORIGIN: origin,
    PENNY_SECURE_COOKIES: String(origin.startsWith("https://")),
    COMPOSE_PROFILES: "bundled-postgres",
    PENNY_ADMIN_PASSWORD: randomBytes(24).toString("hex"),
    PENNY_MIGRATION_PASSWORD: randomBytes(24).toString("hex"),
    PENNY_RUNTIME_PASSWORD: randomBytes(24).toString("hex"),
    PENNY_RECEIPT_KEY: randomBytes(32).toString("base64"),
    ...extra,
  };
  return Object.entries(settings).map(([key, value]) => `${key}=${value}\n`).join("");
}
