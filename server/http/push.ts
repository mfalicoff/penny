import { Router } from "express";
import type { PushService } from "../application/push.ts";
import { currentSession } from "./middleware.ts";

export function createPushRoutes(push: PushService) {
  const router = Router();
  router.post("/devices", (req, res) => {
    res.status(201).json(push.register(currentSession(res), req.body));
  });
  router.delete("/devices", (req, res) => {
    res.json(push.remove(currentSession(res), req.body));
  });
  return router;
}
