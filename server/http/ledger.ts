import { Router } from "express";
import type { LedgerService } from "../application/ledger.ts";
import { currentSession } from "./middleware.ts";

export function createLedgerRoutes(ledger: LedgerService) {
  const router = Router();
  router.get("/", (_req, res) => {
    res.json(ledger.read(currentSession(res).userId));
  });
  router.put("/", (req, res) => {
    res.json(ledger.save(currentSession(res).userId, req.body));
  });
  return router;
}
