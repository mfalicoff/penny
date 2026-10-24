import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import type { HouseholdService } from "../application/households.ts";
import { currentSession } from "./middleware.ts";

export function createHouseholdRoutes(service: HouseholdService) {
  const routes = Router();
  const actor = (res: Parameters<typeof currentSession>[0]) => currentSession(res).userId;
  const inviteLimit = rateLimit({ windowMs: 10 * 60000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false, message: {error:"Too many invite attempts. Try again later."} });
  routes.get("/projection", (req,res) => res.json(service.projection(actor(res), typeof req.query.month === "string" ? req.query.month : undefined, typeof req.query.year === "string" ? req.query.year : undefined)));
  routes.post("/join", inviteLimit, (req,res) => res.json(service.join(actor(res),req.body)));
  routes.post("/trips", (req,res) => res.status(201).json(service.createTrip(actor(res),req.body)));
  routes.get("/", (_req,res) => res.json(service.list(actor(res))));
  routes.post("/", (req,res) => res.status(201).json(service.create(actor(res),req.body)));
  routes.get("/:id", (req,res) => res.json(service.get(req.params.id,actor(res))));
  routes.patch("/:id", (req,res) => res.json(service.rename(req.params.id,actor(res),req.body)));
  routes.patch("/:id/trip", (req,res) => res.json(service.updateTrip(req.params.id,actor(res),req.body)));
  routes.post("/:id/archive", (req,res) => res.json(service.archive(req.params.id,actor(res))));
  routes.post("/:id/invites", (req,res) => res.status(201).json(service.invite(req.params.id,actor(res))));
  routes.post("/:id/leave", (req,res) => res.json(service.leave(req.params.id,actor(res))));
  routes.delete("/:id/members/:userId", (req,res) => res.json(service.remove(req.params.id,actor(res),req.params.userId)));
  routes.get("/:id/expenses", (req,res) => res.json(service.expenses(req.params.id,actor(res),typeof req.query.month === "string" ? req.query.month : undefined)));
  routes.post("/:id/expenses", (req,res) => res.status(201).json(service.createExpense(req.params.id,actor(res),req.body)));
  routes.get("/:id/expenses/:expenseId", (req,res) => res.json(service.getExpense(req.params.id,actor(res),req.params.expenseId)));
  routes.post("/:id/expenses/:expenseId/payments", (req,res) => res.status(201).json(service.payExpense(req.params.id,actor(res),req.params.expenseId,req.body)));
  routes.put("/:id/expenses/:expenseId", (req,res) => res.json(service.updateExpense(req.params.id,actor(res),req.params.expenseId,req.body)));
  routes.delete("/:id/expenses/:expenseId", (req,res) => res.json(service.deleteExpense(req.params.id,actor(res),req.params.expenseId,req.body)));
  routes.get("/:id/months/:month", (req,res) => res.json(service.month(req.params.id,actor(res),req.params.month)));
  routes.post("/:id/months/:month/reimbursements", (req,res) => res.status(201).json(service.reimburse(req.params.id,actor(res),req.params.month,req.body)));
  routes.get("/:id/audit", (req,res) => res.json(service.audit(req.params.id,actor(res),typeof req.query.expenseId === "string" ? req.query.expenseId : undefined)));
  routes.get("/:id/recurring", (req,res) => res.json(service.recurring(req.params.id,actor(res))));
  routes.post("/:id/recurring", (req,res) => res.status(201).json(service.createRecurring(req.params.id,actor(res),req.body)));
  routes.put("/:id/recurring/:ruleId", (req,res) => res.json(service.updateRecurring(req.params.id,actor(res),req.params.ruleId,req.body)));
  routes.delete("/:id/recurring/:ruleId", (req,res) => res.json(service.deleteRecurring(req.params.id,actor(res),req.params.ruleId,req.body)));
  return routes;
}
