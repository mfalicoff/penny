import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import express from "express";
import { oidcFromEnv } from "./infrastructure/oidc.ts";
import { createApp } from "./app.ts";
const databasePath = resolve(
  process.env.DATABASE_PATH || "./data/penny.sqlite",
);
mkdirSync(dirname(databasePath), { recursive: true });
const { app, db, households, push } = createApp({
  databasePath,
  oidc: oidcFromEnv(process.env),
  origins: (
    process.env.CORS_ORIGINS || "http://localhost:8081,http://localhost:3001"
  )
    .split(",")
    .map((s: string) => s.trim()),
  secureCookies: process.env.COOKIE_SECURE === "true",
  allowRegistration: process.env.ALLOW_REGISTRATION !== "false",
});
function runHouseholdSchedules() {
  try {
    households.runRecurring(new Date().toISOString().slice(0, 10));
  } catch (error) {
    console.error("Could not create due household expenses:", error);
  }
}
runHouseholdSchedules();
const householdScheduleTimer = setInterval(runHouseholdSchedules, 60_000);
async function runPushDelivery() {
  try {
    await push.flushDue();
    await push.checkReceipts();
  } catch (error) {
    console.error("Could not deliver household notifications:", error);
  }
}
void runPushDelivery();
const pushDeliveryTimer = setInterval(() => { void runPushDelivery(); }, 15_000);
app.use(express.static(resolve("dist")));
app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
const port = Number(process.env.PORT || 3001);
const server = app.listen(port, "0.0.0.0");
server.on("listening", () =>
  console.log(`Penny server listening on port ${port}`),
);
server.on("error", (error) => {
  console.error("Could not start server:", error.message);
  clearInterval(householdScheduleTimer);
  clearInterval(pushDeliveryTimer);
  db.close();
  process.exit(1);
});
function shutdown() {
  clearInterval(householdScheduleTimer);
  clearInterval(pushDeliveryTimer);
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
