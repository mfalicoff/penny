import { writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { createApp } from "../../../../server/app.ts";
import { listen } from "./lifecycle.mjs";

/** In-memory backends only: no real accounts, databases or credentials. */
export async function createServerConnectionFixture(harness) {
  const requests = [];
  const servers = [];
  const databases = [];
  harness.addCleanup(() => writeFile(resolve(harness.artifacts, "requests.json"), JSON.stringify(requests, null, 2)));
  harness.addCleanup(async () => {
    const errors = [];
    for (const server of servers) {
      try {
        server.closeAllConnections();
        if (server.listening) await new Promise((done, reject) => server.close((error) => error ? reject(error) : done()));
      } catch (error) { errors.push(error); }
    }
    for (const db of databases) {
      try { db.close(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, "Backend fixture cleanup failed");
  });
  async function penny(name) {
    const { app, db } = createApp({ databasePath: ":memory:" });
    databases.push(db);
    const server = createServer((req, res) => {
      requests.push({ server: name, method: req.method, path: req.url, authorization: req.headers.authorization, cookie: req.headers.cookie });
      app(req, res);
    });
    servers.push(server);
    return listen(server);
  }
  const originalUrl = await penny("original");
  const selectedUrl = await penny("selected");
  const impostor = createServer((req, res) => {
    requests.push({ server: "impostor", method: req.method, path: req.url, authorization: req.headers.authorization, cookie: req.headers.cookie });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ name: "not-penny", version: "99.0.0" }));
  });
  servers.push(impostor);
  const impostorUrl = await listen(impostor);
  const version = (await (await fetch(`${selectedUrl}/api/info`)).json()).version;
  requests.length = 0;
  return { requests, originalUrl, selectedUrl, impostorUrl, version };
}
