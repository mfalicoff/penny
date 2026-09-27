import express from "express";
import cors from "cors";
import { rateLimit } from "express-rate-limit";
import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";
import { emptyLedger, validDate } from "../src/model.ts";
const scrypt = promisify(scryptCallback);
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const id = z.string().min(1).max(100);
const date = z.string().refine(validDate, "Invalid calendar date");
const amount = z.number().int().nonnegative().max(99999999999);
const entry = z.object({
  id,
  title: z.string().min(1).max(100),
  kind: z.enum(["income", "expense"]),
  total: amount.positive(),
  share: amount,
  categoryId: id,
  date,
  note: z.string().max(1000),
});
const receipt = z.object({
  id,
  name: z.string().max(255),
  mime: z.string().max(100),
  uri: z.string().max(500),
});
const ledgerSchema = z
  .object({
    version: z.literal(1),
    currency: z.enum(["CAD", "USD", "EUR", "GBP"]),
    categories: z
      .array(
        z.object({
          id,
          name: z.string().min(1).max(50),
          icon: z.string().max(80),
          color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
          kind: z.enum(["income", "expense"]),
        }),
      )
      .max(300),
    transactions: z
      .array(
        entry.extend({
          receipt: receipt.optional(),
          recurringId: id.optional(),
        }),
      )
      .max(100000),
    recurring: z
      .array(
        entry.extend({
          frequency: z.enum(["weekly", "monthly", "yearly"]),
          nextDate: date,
          anchorDay: z.number().int().min(1).max(31),
          active: z.boolean(),
        }),
      )
      .max(1000),
  })
  .superRefine((data, ctx) => {
    const categories = new Map(data.categories.map((c) => [c.id, c]));
    for (const list of [data.categories, data.transactions, data.recurring])
      if (new Set(list.map((i) => i.id)).size !== list.length)
        ctx.addIssue({ code: "custom", message: "Duplicate identifiers" });
    for (const t of [...data.transactions, ...data.recurring]) {
      if (t.share > t.total || (t.kind === "income" && t.share !== t.total))
        ctx.addIssue({ code: "custom", message: "Invalid personal share" });
      if (categories.get(t.categoryId)?.kind !== t.kind)
        ctx.addIssue({ code: "custom", message: "Invalid category" });
    }
  });
const credentials = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(10).max(256),
});

export function createApp({
  databasePath,
  origins = ["http://localhost:8081", "http://localhost:3001"],
  secureCookies = false,
  allowRegistration = true,
}: {
  databasePath: string;
  origins?: string[];
  secureCookies?: boolean;
  allowRegistration?: boolean;
}) {
  const db = new DatabaseSync(databasePath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, salt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS ledgers (user_id TEXT PRIMARY KEY REFERENCES users(id), revision INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL);
  `);
  const app = express();
  app.disable("x-powered-by");
  app.use(
    cors({
      origin: (origin, callback) =>
        callback(null, !origin || origins.includes(origin)),
      credentials: true,
    }),
  );
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (
      req.method !== "GET" &&
      req.headers.origin &&
      !origins.includes(req.headers.origin)
    ) {
      res.status(403).json({ error: "This origin is not allowed." });
      return;
    }
    next();
  });
  app.use("/api", express.json({ limit: "20mb" }));
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  const authLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 40,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many attempts. Please try again in 15 minutes." },
  });
  function issueSession(userId: string, res: express.Response) {
    const token = randomBytes(32).toString("hex");
    db.prepare("DELETE FROM sessions WHERE expires < ?").run(Date.now());
    db.prepare("INSERT INTO sessions VALUES (?, ?, ?)").run(
      hash(token),
      userId,
      Date.now() + 30 * 86400000,
    );
    res.cookie("penny_session", token, {
      httpOnly: true,
      secure: secureCookies,
      sameSite: "lax",
      maxAge: 30 * 86400000,
      path: "/api",
    });
    return token;
  }
  app.post("/api/auth/register", authLimit, async (req, res, next) => {
    try {
      if (!allowRegistration) {
        res
          .status(403)
          .json({ error: "Account registration is disabled on this server." });
        return;
      }
      const input = credentials.safeParse(req.body);
      if (!input.success) {
        res.status(400).json({
          error: "Enter a valid email and a password of 10–256 characters.",
        });
        return;
      }
      const { email, password } = input.data;
      if (db.prepare("SELECT id FROM users WHERE email = ?").get(email)) {
        res.status(409).json({
          error: "An account with this email already exists. Please sign in.",
        });
        return;
      }
      const userId = randomBytes(16).toString("hex");
      const salt = randomBytes(16).toString("hex");
      const passwordHash = (
        (await scrypt(password, salt, 64)) as Buffer
      ).toString("hex");
      // A transaction keeps account and initial ledger creation atomic.
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("INSERT INTO users VALUES (?, ?, ?, ?)").run(
          userId,
          email,
          passwordHash,
          salt,
        );
        db.prepare("INSERT INTO ledgers VALUES (?, 0, ?)").run(
          userId,
          JSON.stringify(emptyLedger()),
        );
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      res.status(201).json({ token: issueSession(userId, res), email });
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/auth/login", authLimit, async (req, res, next) => {
    try {
      const input = credentials.safeParse(req.body);
      if (!input.success) {
        res.status(401).json({ error: "Email or password is incorrect." });
        return;
      }
      const user = db
        .prepare("SELECT * FROM users WHERE email = ?")
        .get(input.data.email) as
        | { id: string; password: string; salt: string; email: string }
        | undefined;
      const candidate = (await scrypt(
        input.data.password,
        user?.salt ?? "0".repeat(32),
        64,
      )) as Buffer;
      if (
        !user ||
        !timingSafeEqual(candidate, Buffer.from(user.password, "hex"))
      ) {
        res.status(401).json({ error: "Email or password is incorrect." });
        return;
      }
      res.json({ token: issueSession(user.id, res), email: user.email });
    } catch (error) {
      next(error);
    }
  });
  app.use("/api", (req, res, next) => {
    const bearer = req.headers.authorization?.match(
      /^Bearer ([a-f0-9]{64})$/,
    )?.[1];
    const cookie = req.headers.cookie?.match(
      /(?:^|;\s*)penny_session=([a-f0-9]{64})(?:;|$)/,
    )?.[1];
    const token = bearer || cookie;
    const session =
      token &&
      db
        .prepare(
          "SELECT user_id FROM sessions WHERE token_hash = ? AND expires > ?",
        )
        .get(hash(token), Date.now());
    if (!session) {
      res.status(401).json({ error: "Please sign in to continue." });
      return;
    }
    res.locals.userId = session.user_id;
    res.locals.tokenHash = hash(token!);
    next();
  });
  app.get("/api/auth/me", (_req, res) =>
    res.json(
      db.prepare("SELECT email FROM users WHERE id = ?").get(res.locals.userId),
    ),
  );
  app.post("/api/auth/logout", (_req, res) => {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(
      res.locals.tokenHash,
    );
    res.clearCookie("penny_session", {
      path: "/api",
      httpOnly: true,
      sameSite: "lax",
      secure: secureCookies,
    });
    res.json({ ok: true });
  });
  app.get("/api/ledger", (_req, res) => {
    const row = db
      .prepare("SELECT revision, data FROM ledgers WHERE user_id = ?")
      .get(res.locals.userId)!;
    res.json({
      revision: row.revision,
      ledger: JSON.parse(row.data as string),
    });
  });
  app.put("/api/ledger", (req, res) => {
    const input = z
      .object({
        revision: z.number().int().nonnegative(),
        ledger: ledgerSchema,
      })
      .safeParse(req.body);
    if (!input.success) {
      res.status(400).json({ error: "Invalid ledger data." });
      return;
    }
    for (const transaction of input.data.ledger.transactions)
      if (
        transaction.receipt &&
        !db
          .prepare("SELECT id FROM receipts WHERE id = ? AND user_id = ?")
          .get(transaction.receipt.id, res.locals.userId)
      ) {
        res
          .status(400)
          .json({ error: "Receipt does not belong to this account." });
        return;
      }
    const result = db
      .prepare(
        "UPDATE ledgers SET data = ?, revision = revision + 1 WHERE user_id = ? AND revision = ?",
      )
      .run(
        JSON.stringify(input.data.ledger),
        res.locals.userId,
        input.data.revision,
      );
    if (!result.changes) {
      res.status(409).json({
        error:
          "Your data changed on another device. Please refresh and try again.",
      });
      return;
    }
    res.json({ revision: input.data.revision + 1, ledger: input.data.ledger });
  });
  app.post("/api/receipts", (req, res) => {
    const input = z
      .object({
        name: z.string().min(1).max(255),
        mime: z.enum([
          "application/pdf",
          "image/jpeg",
          "image/png",
          "image/webp",
          "image/gif",
          "image/heic",
          "image/heif",
        ]),
        base64: z
          .string()
          .max(14 * 1024 * 1024)
          .regex(/^[A-Za-z0-9+/]+={0,2}$/),
      })
      .safeParse(req.body);
    if (!input.success) {
      res
        .status(400)
        .json({ error: "Choose a photo or PDF smaller than 10 MB." });
      return;
    }
    const bytes = Buffer.from(input.data.base64, "base64");
    const mime = input.data.mime;
    const header = bytes.subarray(0, 12);
    const signatureValid =
      mime === "application/pdf"
        ? header.toString().startsWith("%PDF-")
        : mime === "image/jpeg"
          ? header[0] === 255 && header[1] === 216 && header[2] === 255
          : mime === "image/png"
            ? header
                .subarray(0, 8)
                .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            : mime === "image/gif"
              ? /^GIF8[79]a/.test(header.toString())
              : mime === "image/webp"
                ? header.subarray(0, 4).toString() === "RIFF" &&
                  header.subarray(8, 12).toString() === "WEBP"
                : header.subarray(4, 8).toString() === "ftyp";
    if (!bytes.length || bytes.length > 10 * 1024 * 1024 || !signatureValid) {
      res.status(400).json({
        error: "This file is not a supported photo or PDF, or exceeds 10 MB.",
      });
      return;
    }
    const receiptId = randomBytes(16).toString("hex");
    db.prepare("INSERT INTO receipts VALUES (?, ?, ?, ?, ?)").run(
      receiptId,
      res.locals.userId,
      input.data.name,
      mime,
      bytes,
    );
    res.status(201).json({
      id: receiptId,
      name: input.data.name,
      mime,
      uri: `/api/receipts/${receiptId}`,
    });
  });
  app.get("/api/receipts/:id", (req, res) => {
    const file = db
      .prepare(
        "SELECT name, mime, data FROM receipts WHERE id = ? AND user_id = ?",
      )
      .get(req.params.id as string, res.locals.userId);
    if (!file) {
      res.status(404).json({ error: "Receipt not found." });
      return;
    }
    res.setHeader("Content-Type", file.mime as string);
    res.setHeader(
      "Content-Disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(file.name as string)}`,
    );
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.send(Buffer.from(file.data as Uint8Array));
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "API route not found." }),
  );
  app.use(
    (
      error: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const status =
        error.type === "entity.too.large"
          ? 413
          : error.type === "entity.parse.failed"
            ? 400
            : 500;
      if (status === 500) console.error("Request failed:", error.message);
      res.status(status).json({
        error:
          status === 413
            ? "The upload is too large."
            : status === 400
              ? "Invalid JSON."
              : "The server could not complete this request.",
      });
    },
  );
  return { app, db };
}
