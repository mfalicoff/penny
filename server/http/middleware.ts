import type { ErrorRequestHandler, RequestHandler, Response } from "express";
import { ApplicationError } from "../application/errors.ts";
import type { AuthService } from "../application/auth.ts";
import type { Session } from "../application/ports.ts";

export function apiPolicy(origins: string[]): RequestHandler {
  return (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method !== "GET" && req.headers.origin && !origins.includes(req.headers.origin)) {
      res.status(403).json({ error: "This origin is not allowed." });
      return;
    }
    next();
  };
}

export function requireSession(auth: AuthService): RequestHandler {
  return (req, res, next) => {
    const bearer = req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    const cookie = req.headers.cookie?.match(/(?:^|;\s*)penny_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    res.locals.session = auth.authenticate(bearer || cookie);
    next();
  };
}

/** Only call from routes mounted after requireSession. */
export function currentSession(res: Response): Session {
  const session = res.locals.session as Session | undefined;
  if (!session) throw new Error("Authenticated route is missing session middleware.");
  return session;
}

const failureStatus = { invalid: 400, unauthorized: 401, forbidden: 403, not_found: 404, conflict: 409 } as const;

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (error instanceof ApplicationError) {
    res.status(failureStatus[error.reason]).json({ error: error.message });
    return;
  }
  const type = error && typeof error === "object" && "type" in error ? error.type : undefined;
  const status = type === "entity.too.large" ? 413 : type === "entity.parse.failed" ? 400 : 500;
  if (status === 500) console.error("Request failed:", error instanceof Error ? error.message : error);
  res.status(status).json({ error: status === 413 ? "The upload is too large." : status === 400 ? "Invalid JSON." : "The server could not complete this request." });
};
