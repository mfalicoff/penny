import { createOidcService } from "./application/oidc.ts";
import type { OidcOptions } from "./application/ports.ts";
import { createOidcProvider } from "./infrastructure/oidc.ts";
import express from "express";
import { readFileSync } from "node:fs";
import cors from "cors";
import { createAuthService } from "./application/auth.ts";
import { createLedgerService } from "./application/ledger.ts";
import { createReceiptService } from "./application/receipts.ts";
import { createHouseholdService } from "./infrastructure/households.ts";
import { createPushService } from "./application/push.ts";
import { createPushRepository } from "./infrastructure/push.ts";
import { openDatabase } from "./infrastructure/database.ts";
import { createRepositories } from "./infrastructure/repositories.ts";
import { security } from "./infrastructure/security.ts";
import { createAuthRoutes } from "./http/auth.ts";
import { createLedgerRoutes } from "./http/ledger.ts";
import { createReceiptRoutes } from "./http/receipts.ts";
import { createHouseholdRoutes } from "./http/households.ts";
import { createPushRoutes } from "./http/push.ts";
import { apiPolicy, errorHandler, requireSession } from "./http/middleware.ts";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

export interface AppOptions {
  databasePath: string;
  oidc?: OidcOptions;
  origins?: string[];
  secureCookies?: boolean;
  allowRegistration?: boolean;
}

/** Composition root: one database and one set of services/middleware per app. */
export function createApp({
  databasePath,
  oidc,
  origins = ["http://localhost:8081", "http://localhost:3001"],
  secureCookies = false,
  allowRegistration = true,
}: AppOptions) {
  const db = openDatabase(databasePath);
  try {
    const repositories = createRepositories(db);
    const auth = createAuthService({ ...repositories, security, allowRegistration });
    const ledger = createLedgerService(repositories.ledgers, repositories.receipts);
    const households = createHouseholdService(db, security);
    const push = createPushService(createPushRepository(db));
    const receipts = createReceiptService(repositories.receipts, security, households.canReadReceipt);
    const authRoutes = createAuthRoutes(auth, secureCookies, oidc ? createOidcService(oidc, createOidcProvider(oidc), auth, security) : undefined);
    const app = express();
    app.disable("x-powered-by");
    app.use(cors({
      origin: (origin, callback) => callback(null, !origin || origins.includes(origin)),
      credentials: true,
    }));
    app.use("/api", apiPolicy(origins), express.json({ limit: "20mb" }));
    app.get("/api/health", (_req, res) => res.json({ ok: true }));
    app.get("/api/info", (_req, res) => res.json({ name: "penny", version }));
    app.use("/api/auth", authRoutes.publicRoutes);
    app.use("/api", requireSession(auth));
    app.use("/api/auth", authRoutes.protectedRoutes);
    app.use("/api/ledger", createLedgerRoutes(ledger));
    app.use("/api/receipts", createReceiptRoutes(receipts));
    app.use("/api/households", createHouseholdRoutes(households));
    app.use("/api/push", createPushRoutes(push));
    app.use("/api", (_req, res) => res.status(404).json({ error: "API route not found." }));
    app.use(errorHandler);
    return { app, db, households, push };
  } catch (error) {
    db.close();
    throw error;
  }
}
