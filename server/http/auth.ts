import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { SESSION_DURATION_MS, type AuthService } from "../application/auth.ts";
import { currentSession } from "./middleware.ts";

export function createAuthRoutes(auth: AuthService, secureCookies: boolean) {
  const publicRoutes = Router();
  const protectedRoutes = Router();
  const cookieOptions = { httpOnly: true, secure: secureCookies, sameSite: "lax" as const, path: "/api" };
  const authLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 40,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many attempts. Please try again in 15 minutes." },
  });
  publicRoutes.post("/register", authLimit, async (req, res) => {
    const session = await auth.register(req.body);
    res.cookie("penny_session", session.token, { ...cookieOptions, maxAge: SESSION_DURATION_MS });
    res.status(201).json(session);
  });
  publicRoutes.post("/login", authLimit, async (req, res) => {
    const session = await auth.login(req.body);
    res.cookie("penny_session", session.token, { ...cookieOptions, maxAge: SESSION_DURATION_MS });
    res.json(session);
  });
  protectedRoutes.get("/me", (_req, res) => {
    res.json(auth.me(currentSession(res).userId));
  });
  protectedRoutes.post("/logout", (_req, res) => {
    auth.logout(currentSession(res).tokenHash);
    res.clearCookie("penny_session", cookieOptions);
    res.json({ ok: true });
  });
  return { publicRoutes, protectedRoutes };
}
