import express from "express";
import cors from "cors";
import { createAuthService } from "./application/auth.ts";
import { createLedgerService } from "./application/ledger.ts";
import { createReceiptService } from "./application/receipts.ts";
import { openDatabase } from "./infrastructure/database.ts";
import { createRepositories } from "./infrastructure/repositories.ts";
import { security } from "./infrastructure/security.ts";
import { createAuthRoutes } from "./http/auth.ts";
import { createLedgerRoutes } from "./http/ledger.ts";
import { createReceiptRoutes } from "./http/receipts.ts";
import { apiPolicy, errorHandler, requireSession } from "./http/middleware.ts";

export interface AppOptions {
  databasePath: string;
  origins?: string[];
  secureCookies?: boolean;
  allowRegistration?: boolean;
}

/** Composition root: one database and one set of services/middleware per app. */
export function createApp({
  databasePath,
  origins = ["http://localhost:8081", "http://localhost:3001"],
  secureCookies = false,
  allowRegistration = true,
}: AppOptions) {
  const db = openDatabase(databasePath);
  try {
    const repositories = createRepositories(db);
    const auth = createAuthService({ ...repositories, security, allowRegistration });
    const ledger = createLedgerService(repositories.ledgers, repositories.receipts);
    const receipts = createReceiptService(repositories.receipts, security);
    const authRoutes = createAuthRoutes(auth, secureCookies);
    const app = express();
    app.disable("x-powered-by");
    app.use(cors({
      origin: (origin, callback) => callback(null, !origin || origins.includes(origin)),
      credentials: true,
    }));
    app.use("/api", apiPolicy(origins), express.json({ limit: "20mb" }));
    app.get("/api/health", (_req, res) => res.json({ ok: true }));
    app.use("/api/auth", authRoutes.publicRoutes);
    app.use("/api", requireSession(auth));
    app.use("/api/auth", authRoutes.protectedRoutes);
    app.use("/api/ledger", createLedgerRoutes(ledger));
    app.use("/api/receipts", createReceiptRoutes(receipts));
    app.use("/api", (_req, res) => res.status(404).json({ error: "API route not found." }));
    app.use(errorHandler);
    return { app, db };
  } catch (error) {
    db.close();
    throw error;
  }
}
