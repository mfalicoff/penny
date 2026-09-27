import { Router } from "express";
import type { ReceiptService } from "../application/receipts.ts";
import { currentSession } from "./middleware.ts";

export function createReceiptRoutes(receipts: ReceiptService) {
  const router = Router();
  router.post("/", (req, res) => {
    const receipt = receipts.upload(currentSession(res).userId, req.body);
    res.status(201).json({ ...receipt, uri: `/api/receipts/${receipt.id}` });
  });
  router.get("/:id", (req, res) => {
    const file = receipts.read(currentSession(res).userId, req.params.id);
    res.setHeader("Content-Type", file.mime);
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.send(Buffer.from(file.data));
  });
  return router;
}
