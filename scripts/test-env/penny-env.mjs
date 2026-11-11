#!/usr/bin/env node
// One-command full-stack test environments (MAZ-62). See docs/migration/test-environment.md.
//
//   node scripts/test-env/penny-env.mjs up [--seed NAME] [--host 0.0.0.0] [--oidc] [--no-build]
//   node scripts/test-env/penny-env.mjs run [--seed NAME] [--oidc] -- <command...>
//   node scripts/test-env/penny-env.mjs status | env | reset | clock <ISO|reset> | user [label]
//   node scripts/test-env/penny-env.mjs fault '<json rule>' | fault clear
//   node scripts/test-env/penny-env.mjs seed <scenario> | artifacts [dir] | compare | cutover [--no-build]
//   node scripts/test-env/penny-env.mjs down [--all]
//
// Commands act on the most recent environment unless --run-id ID is given. `compare`
// runs the `differential` scenario by default and writes test-results/fullstack/parity/.
import { spawn } from "node:child_process";
import { join } from "node:path";
import {
  collectArtifacts, control, down, downAll, readState, root, runnerEnvironment, up,
} from "./environment.mjs";
import { scenario, seed } from "./seed.mjs";
import { startOidcProvider } from "./oidc-provider.mjs";
import { compareLegacy, writeParityReport } from "./compare.mjs";
import { rehearseCutover } from "./cutover.mjs";

function parse(argv) {
  const separator = argv.indexOf("--");
  const own = separator < 0 ? argv : argv.slice(0, separator);
  const command = separator < 0 ? [] : argv.slice(separator + 1);
  const flags = {};
  const positional = [];
  for (let index = 0; index < own.length; index++) {
    const item = own[index];
    if (!item.startsWith("--")) positional.push(item);
    else if (["--no-build", "--all", "--oidc", "--keep", "--no-worker"].includes(item)) flags[item.slice(2)] = true;
    else flags[item.slice(2)] = own[++index];
  }
  return { verb: positional.shift() ?? "help", positional, flags, command };
}

async function start(flags) {
  let oidc;
  if (flags.oidc) oidc = await startOidcProvider({ runId: flags["run-id"] });
  try {
    const state = await up({
      runId: flags["run-id"],
      host: flags.host,
      port: flags.port ? Number(flags.port) : undefined,
      origins: flags.origins?.split(","),
      build: !flags["no-build"],
      worker: !flags["no-worker"],
      oidc: oidc?.settings,
    });
    if (oidc) await oidc.attach(state);
    if (flags.seed) await seedInto(state, flags.seed);
    return { state, oidc };
  } catch (error) {
    await oidc?.close();
    throw error;
  }
}

async function seedInto(state, name) {
  const context = await seed(scenario(name), {
    apiUrl: state.apiUrl,
    runTag: state.runId,
    setClock: (now) => control(state, "PUT", "clock", { now }),
  });
  // Runners read sessions and ids from here; the file is private to the run (0600).
  const { writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  writeFileSync(join(state.directory, `seed-${name}.json`), `${JSON.stringify(context, null, 2)}\n`, { mode: 0o600 });
  return context;
}

function summary(state) {
  return {
    runId: state.runId,
    apiUrl: state.apiUrl,
    database: state.database,
    postgres: state.postgres,
    container: state.container,
    stateFile: `${state.directory}/env.json`,
    android: state.apiUrl.replace("127.0.0.1", "10.0.2.2"),
    oidcIssuer: state.oidc?.issuer,
    oidcCertificate: state.oidc?.certificate,
  };
}

async function main() {
  const { verb, positional, flags, command } = parse(process.argv.slice(2));
  const id = flags["run-id"];
  switch (verb) {
    case "up": {
      const { state, oidc } = await start(flags);
      console.log(JSON.stringify(summary(state), null, 2));
      if (oidc) {
        console.log("The local OIDC provider runs in this process; press Ctrl+C to stop it (the environment stays up).");
        await new Promise(() => {});
      }
      return;
    }
    case "run": {
      if (!command.length) throw new Error("Usage: penny-env run [options] -- <command...>");
      const { state, oidc } = await start(flags);
      let code = 1;
      const stop = async () => {
        collectArtifacts(state);
        await oidc?.close();
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
    case "artifacts":
      console.log(collectArtifacts(readState(id), positional[0]));
      return;
    case "cutover": {
      // Needs no running environment: starts legacy and a fresh .NET environment itself.
      const report = await rehearseCutover({ build: !flags["no-build"] });
      console.log(JSON.stringify({ summary: report.summary, steps: report.steps, checks: report.checks, timings: report.timings }, null, 2));
      for (const difference of report.differences.slice(0, 50)) console.error(difference);
      if (report.differences.length || Object.values(report.checks).some((ok) => !ok)) process.exitCode = 1;
      return;
    }
    case "compare": {
      const report = await compareLegacy(readState(id), { scenario: positional[0] ?? "differential" });
      console.log(JSON.stringify(report.summary, null, 2));
      writeParityReport(report, join(root, "test-results/fullstack/parity"));
      if (report.differences.length) {
        for (const difference of report.differences) console.error(difference);
        process.exitCode = 1;
      }
      return;
    }
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
    "  up [--seed NAME] [--host 0.0.0.0] [--port N] [--origins a,b] [--oidc] [--no-build] [--no-worker] [--run-id ID]",
    "  run [up options] [--keep] -- <command...>   start, run, collect artifacts, always tear down",
    "  status | env | reset | clock <ISO|reset> | user [label] | fault '<json>'|clear | seed <scenario>",
    "  artifacts [dir] | compare [scenario] | cutover [--no-build] | down [--all]",
  ].join("\n");
}

main().catch((error) => {
  console.error(error.message);
  if (error.logs) console.error(error.logs);
  process.exitCode = 1;
});
