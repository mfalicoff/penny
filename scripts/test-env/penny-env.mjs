#!/usr/bin/env node
// One-command full-stack test environments (MAZ-62). See docs/reference/test-environment.md.
//
//   node scripts/test-env/penny-env.mjs up [--seed NAME] [--host 0.0.0.0] [--oidc] [--oidc-providers] [--no-build] [--http]
//   node scripts/test-env/penny-env.mjs run [--seed NAME] [--oidc] -- <command...>
//   node scripts/test-env/penny-env.mjs status | env | reset | clock <ISO|reset> | user [label]
//   node scripts/test-env/penny-env.mjs fault '<json rule>' | fault clear
//   node scripts/test-env/penny-env.mjs seed <scenario> | artifacts [dir]
//   node scripts/test-env/penny-env.mjs down [--all]
//
// Commands act on the most recent environment unless --run-id ID is given. Every run picks its
// own id, free ports (API, web origin, OIDC provider) and certificate, so several sessions on
// one machine each get their own environment (MAZ-265).
import { spawn } from "node:child_process";
import {
  collectArtifacts, control, down, downAll, freePort, newRunId, readState, runnerEnvironment, statePath, up, validRunId,
} from "./environment.mjs";
import { writeCertificate } from "./tls.mjs";
import { scenario, seed } from "./seed.mjs";
import { startOidcProvider } from "./oidc-provider.mjs";
import { startSmtpSink } from "./smtp-sink.mjs";
import { emailSummary, receiptEmail, sendEmail } from "./email.mjs";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { basename, join } from "node:path";

function parse(argv) {
  const separator = argv.indexOf("--");
  const own = separator < 0 ? argv : argv.slice(0, separator);
  const command = separator < 0 ? [] : argv.slice(separator + 1);
  const flags = {};
  const positional = [];
  for (let index = 0; index < own.length; index++) {
    const item = own[index];
    if (!item.startsWith("--")) positional.push(item);
    else if (["--no-build", "--all", "--oidc", "--oidc-providers", "--oidc-brands-only", "--keep", "--no-worker", "--email", "--smtp", "--http"].includes(item)) flags[item.slice(2)] = true;
    else flags[item.slice(2)] = own[++index];
  }
  return { verb: positional.shift() ?? "help", positional, flags, command };
}

async function start(flags) {
  // The run id, web port and certificate come first: the OIDC provider shares the API's
  // certificate and registers the run's web port as a redirect URI.
  const runId = flags["run-id"] ?? newRunId();
  if (!validRunId(runId)) throw new Error("Run ids use 4–24 lowercase letters or digits.");
  const webPort = flags["web-port"] ? Number(flags["web-port"]) : await freePort();
  let oidc;
  const extraOidc = [];
  let smtp;
  let tls;
  try {
    tls = writeCertificate(join(statePath(runId), "tls"));
    // --oidc-brands-only leaves out the server's own SSO, so only Apple and Google are listed.
    if ((flags.oidc || flags["oidc-providers"]) && !flags["oidc-brands-only"])
      oidc = await startOidcProvider({ tls, webPorts: [webPort] });
    // MAZ-170: two more local providers, listed as Apple and Google, for the provider cards and
    // journeys. Each has its own issuer, so an account belongs to exactly one of them.
    if (flags["oidc-providers"])
      for (const [order, id, label] of [[1, "apple", "Apple"], [2, "google", "Google"]])
        extraOidc.push({ id, label, icon: id, order, provider: await startOidcProvider({ tls, webPorts: [webPort] }) });
    if (flags.smtp) smtp = await startSmtpSink();
    const state = await up({
      runId,
      tls,
      webPort,
      http: flags.http === true,
      host: flags.host,
      port: flags.port ? Number(flags.port) : undefined,
      origins: flags.origins?.split(","),
      build: !flags["no-build"],
      worker: !flags["no-worker"],
      oidc: oidc?.settings,
      oidcProviders: extraOidc.map(({ provider, ...rest }) => ({ ...rest, settings: provider.settings })),
      email: flags.email === true,
      smtp: smtp ? { port: smtp.port } : undefined,
    });
    if (oidc) await oidc.attach(state);
    for (const { provider } of extraOidc) await provider.attach(state);
    if (flags.seed) await seedInto(state, flags.seed);
    const providers = oidc ?? extraOidc[0]?.provider;
    return { state, oidc: providers && { close: async () => { await oidc?.close(); for (const { provider } of extraOidc) await provider.close(); } }, smtp };
  } catch (error) {
    await oidc?.close();
    for (const { provider } of extraOidc) await provider.close();
    await smtp?.close();
    // up() removes the run on failure; this covers a failure before it started.
    if (tls && !existsSync(join(statePath(runId), "env.json"))) rmSync(statePath(runId), { recursive: true, force: true });
    throw error;
  }
}

async function seedInto(state, name) {
  const context = await seed(scenario(name), {
    apiUrl: state.apiUrl,
    runTag: state.runId,
    setClock: (now) => control(state, "PUT", "clock", { now }),
    verifyEmail: (email) => control(state, "POST", "email-verified", { email }),
  });
  // Runners read sessions and ids from here; the file is private to the run (0600).
  const { writeFileSync } = await import("node:fs");
  writeFileSync(join(state.directory, `seed-${name}.json`), `${JSON.stringify(context, null, 2)}\n`, { mode: 0o600 });
  return context;
}

function summary(state) {
  return {
    runId: state.runId,
    apiUrl: state.apiUrl,
    apiCertificate: state.tls?.certificate,
    webPort: state.webPort,
    database: state.database,
    postgres: state.postgres,
    container: state.container,
    stateFile: `${state.directory}/env.json`,
    oidcIssuer: state.oidc?.issuer,
    oidcCertificate: state.oidc?.certificate,
    ...emailSummary(state),
  };
}

async function main() {
  const { verb, positional, flags, command } = parse(process.argv.slice(2));
  const id = flags["run-id"];
  switch (verb) {
    case "up": {
      const { state, oidc, smtp } = await start(flags);
      console.log(JSON.stringify(summary(state), null, 2));
      if (oidc || smtp) {
        console.log("The local OIDC provider or SMTP sink runs in this process; press Ctrl+C to stop it (the environment stays up).");
        await new Promise(() => {});
      }
      return;
    }
    case "run": {
      if (!command.length) throw new Error("Usage: penny-env run [options] -- <command...>");
      const { state, oidc, smtp } = await start(flags);
      let code;
      const stop = async () => {
        collectArtifacts(state);
        await oidc?.close();
        await smtp?.close();
        if (!flags.keep) await down(state.runId, { keepArtifacts: false });
      };
      const signals = ["SIGINT", "SIGTERM"];
      const onSignal = async (signal) => {
        await stop();
        process.exit(signal === "SIGINT" ? 130 : 143);
      };
      for (const signal of signals) process.once(signal, onSignal);
      try {
        const child = spawn(command[0], command.slice(1), {
          stdio: "inherit",
          env: { ...process.env, ...runnerEnvironment(state) },
        });
        code = await new Promise((resolve) => {
          child.on("error", () => resolve(127));
          child.on("exit", (exit, signal) => resolve(exit ?? (signal ? 1 : 0)));
        });
      } finally {
        for (const signal of signals) process.off(signal, onSignal);
        await stop();
      }
      process.exitCode = code;
      return;
    }
    case "status":
      console.log(JSON.stringify({ ...summary(readState(id)), controls: await control(readState(id), "GET", "state") }, null, 2));
      return;
    case "env":
      for (const [key, value] of Object.entries(runnerEnvironment(readState(id)))) console.log(`export ${key}=${value}`);
      return;
    case "reset":
      console.log(JSON.stringify(await control(readState(id), "POST", "reset")));
      return;
    case "clock":
      console.log(JSON.stringify(positional[0] === "reset" || !positional[0]
        ? await control(readState(id), "DELETE", "clock")
        : await control(readState(id), "PUT", "clock", { now: positional[0] })));
      return;
    case "fault":
      console.log(JSON.stringify(positional[0] === "clear" || !positional[0]
        ? await control(readState(id), "DELETE", "faults")
        : await control(readState(id), "PUT", "faults", { rules: [JSON.parse(positional[0])].flat() })));
      return;
    case "user":
      console.log(JSON.stringify(await control(readState(id), "POST", "users", { label: positional[0] ?? "user" }), null, 2));
      return;
    case "seed": {
      if (!positional[0]) throw new Error("Usage: penny-env seed <scenario>");
      const context = await seedInto(readState(id), positional[0]);
      console.log(JSON.stringify({ users: Object.keys(context.users), userIds: context.userIds, households: context.households, expenses: context.expenseIds }, null, 2));
      return;
    }
    case "mail": {
      // Delivers a synthetic receipt email through the run's Email Worker (MAZ-184).
      if (!flags.to) throw new Error("Usage: penny-env mail --to ADDRESS [--subject S] [--attach FILE.pdf] [--eml FILE]");
      const attachments = flags.attach
        ? [{ name: basename(flags.attach), mime: flags.attach.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/png", content: readFileSync(flags.attach) }]
        : [];
      const raw = flags.eml ? readFileSync(flags.eml) : receiptEmail({ to: flags.to, subject: flags.subject, attachments });
      console.log(JSON.stringify(await sendEmail(readState(id), { to: flags.to, raw })));
      return;
    }
    case "artifacts":
      console.log(collectArtifacts(readState(id), positional[0]));
      return;
    case "down":
      if (flags.all) console.log(`Removed: ${(await downAll()).join(", ") || "nothing"}`);
      else await down(id ?? readState().runId);
      return;
    default:
      console.log(help());
  }
}

function help() {
  return [
    "penny-env: disposable .NET API + PostgreSQL environments for browser and simulator runs.",
    "  up [--seed NAME] [--host 0.0.0.0] [--port N] [--web-port N] [--origins a,b] [--oidc] [--oidc-providers [--oidc-brands-only]] [--email] [--smtp] [--http] [--no-build] [--no-worker] [--run-id ID]",
    "     every run picks free ports and its own id; the API is HTTPS with the run's certificate (--http: plain HTTP)",
    "     --email: emailed receipts end to end: penny-render and the Email Worker (wrangler dev) (MAZ-184)",
    "     --smtp: the API sends email (password resets, invitations) to an SMTP sink in this process (MAZ-124)",
    "  mail --to ADDRESS [--subject S] [--attach FILE] [--eml FILE]   send through the Email Worker",
    "  run [up options] [--keep] -- <command...>   start, run, collect artifacts, always tear down",
    "  status | env | reset | clock <ISO|reset> | user [label] | fault '<json>'|clear | seed <scenario>",
    "  artifacts [dir] | down [--all]",
  ].join("\n");
}

main().catch((error) => {
  console.error(error.message);
  if (error.logs) console.error(error.logs);
  process.exitCode = 1;
});
