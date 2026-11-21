// Emailed receipts in a full-stack test environment (MAZ-184): the real pipeline, locally.
//
//   raw email ─▶ Cloudflare Email Worker (apps/email-worker, `wrangler dev`, workerd)
//             ─▶ signed POST /api/inbound-mail ─▶ API worker ─▶ penny-render (Gotenberg) ─▶ inbox
//
// penny-render runs from the image and flags pinned in deploy/compose.yaml, read-only and
// without capabilities. The Worker is reached through wrangler's local email handler
// (`/cdn-cgi/handler/email`), which behaves like Email Routing: a refused message comes
// back as the Worker's reject reason. Secrets are generated per run and never logged.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const emailDomain = "receipts.penny.test";

/** penny-render's image and command from deploy/compose.yaml. */
export function renderService(root) {
  const lines = readFileSync(join(root, "deploy/compose.yaml"), "utf8").split("\n");
  const start = lines.indexOf("  penny-render:");
  if (start < 0) throw new Error("deploy/compose.yaml defines no penny-render service.");
  let image;
  const command = [];
  let inCommand = false;
  for (let index = start + 1; index < lines.length && (lines[index] === "" || lines[index].startsWith("    ")); index++) {
    const line = lines[index];
    if (line.startsWith("    image: ")) image = line.slice("    image: ".length).trim();
    else if (line === "    command:") inCommand = true;
    else if (inCommand && line.startsWith("      - ")) command.push(line.slice("      - ".length).trim());
    else inCommand = false;
  }
  if (!image || !command.includes("--chromium-disable-javascript")) throw new Error("penny-render in deploy/compose.yaml is incomplete.");
  return { image, command };
}

/** Settings and secrets for one run. */
export function emailSettings() {
  return { domain: emailDomain, secret: randomBytes(32).toString("base64") };
}

/** API environment variables for the feature. */
export function apiEmailEnvironment(email, rendererUrl) {
  return {
    InboundMail__Enabled: "true",
    InboundMail__Domain: email.domain,
    InboundMail__WebhookSecret: email.secret,
    InboundMail__RendererUrl: rendererUrl,
    InboundMail__PollSeconds: "1",
  };
}

/** Starts penny-render as the run's container; returns its URL. */
export async function startRenderer(state, { root, cli, label, run, waitFor }) {
  const { image, command } = renderService(root);
  const name = `penny-test-${state.runId}-render`;
  run(cli, [
    "run", "--detach", "--name", name, "--label", `${label}=${state.runId}`,
    "--publish", "127.0.0.1::3000", "--read-only", "--tmpfs", "/tmp", "--tmpfs", "/home/gotenberg",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges", image, ...command,
  ]);
  const published = run(cli, ["port", name, "3000/tcp"]).trim().split("\n")[0];
  const url = `http://127.0.0.1:${published.slice(published.lastIndexOf(":") + 1)}`;
  await waitFor(async () => (await fetch(`${url}/health`).catch(() => undefined))?.ok === true, {
    timeoutMs: 180_000,
    what: "penny-render",
  });
  return url;
}

/** Starts the Email Worker under `wrangler dev`, pointed at the run's API. */
export async function startWorker(state, email, { root, freePort, waitFor }) {
  const worker = join(root, "apps/email-worker");
  if (!existsSync(join(worker, "node_modules/.bin/wrangler")))
    throw new Error("The Email Worker's dependencies are missing. Run `npm --prefix apps/email-worker ci` first.");
  const port = await freePort();
  const log = openSync(join(state.directory, "logs/email-worker.log"), "a", 0o600);
  const child = spawn(join(worker, "node_modules/.bin/wrangler"), [
    "dev", "--ip", "127.0.0.1", "--port", String(port), "--show-interactive-dev-session=false",
    "--var", `PENNY_ORIGIN:${state.apiUrl}`,
    "--var", `RECEIPT_DOMAIN:${email.domain}`,
    "--var", "MAX_MESSAGE_BYTES:26214400",
    "--var", "RECIPIENT_LIST_TTL_SECONDS:5",
    "--var", `PENNY_WEBHOOK_SECRET:${email.secret}`,
  ], {
    cwd: worker,
    detached: true,
    stdio: ["ignore", log, log],
    // workerd trusts the HTTPS test API through the run's bundle, as Node runners do.
    env: {
      ...process.env, WRANGLER_SEND_METRICS: "false", CI: "true",
      ...(state.tls ? { NODE_EXTRA_CA_CERTS: state.tls.trustBundle } : {}),
    },
  });
  closeSync(log);
  let exited = false;
  child.once("exit", () => { exited = true; });
  child.unref();
  const url = `http://127.0.0.1:${port}`;
  await waitFor(async () => {
    if (exited) throw Object.assign(new Error("The Email Worker exited during startup; see logs/email-worker.log"), { fatal: true });
    return (await fetch(url).catch(() => undefined)) !== undefined;
  }, { timeoutMs: 120_000, what: "the Email Worker" });
  return { pid: child.pid, url };
}

export function stopWorker(pid) {
  if (!pid) return;
  for (const target of [-pid, pid]) {
    try {
      process.kill(target, "SIGTERM");
      return;
    } catch {
      // Not a group leader, or already gone.
    }
  }
}

/**
 * A synthetic receipt email (MIME). `attachments` are { name, mime, content (Buffer) }.
 * @returns {Buffer}
 */
export function receiptEmail({ from = "Acme Store <orders@shop.example.test>", to, subject = "Your receipt", html = "<p>Total <b>$12.50</b></p>", attachments = [] }) {
  const boundary = `penny-${randomBytes(8).toString("hex")}`;
  const crlf = "\r\n";
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomBytes(8).toString("hex")}@shop.example.test>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];
  const parts = [
    [`--${boundary}`, "Content-Type: text/html; charset=utf-8", "", html].join(crlf),
    ...attachments.map((file) =>
      [
        `--${boundary}`,
        `Content-Type: ${file.mime}; name="${file.name}"`,
        `Content-Disposition: attachment; filename="${file.name}"`,
        "Content-Transfer-Encoding: base64",
        "",
        file.content.toString("base64").replace(/.{76}/g, "$&\r\n"),
      ].join(crlf)),
  ];
  return Buffer.from(`${headers.join(crlf)}${crlf}${crlf}${parts.join(crlf)}${crlf}--${boundary}--${crlf}`);
}

/**
 * Delivers `raw` to `to` through the Email Worker, as Email Routing would.
 * @returns {Promise<{ accepted: boolean, status: number, reason: string }>}
 */
export async function sendEmail(state, { to, from = "orders@shop.example.test", raw }) {
  if (!state.email?.workerUrl) throw new Error("This environment has no Email Worker; start it with --email.");
  const url = new URL("/cdn-cgi/handler/email", state.email.workerUrl);
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  const response = await fetch(url, { method: "POST", body: raw });
  const text = await response.text();
  return { accepted: response.ok, status: response.status, reason: text.trim() };
}

/** The emailed receipt pieces of a run, for `penny-env.mjs up` and `status`. */
export function emailSummary(state) {
  return state.email ? { emailDomain: state.email.domain, emailWorker: state.email.workerUrl, renderer: state.email.rendererUrl } : {};
}

