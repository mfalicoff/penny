/**
 * Module resolution for running the web sync engine (`src/offline/engine.ts`) under plain Node:
 * `@domain/*` is the Vite alias for `src/domain/*`, and the app's relative imports leave out `.ts`.
 * `scripts/ledger-sync-bench.ts` registers it before importing the engine.
 */
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

const domain = new URL("../../src/domain/", import.meta.url);

/** Where `specifier`, imported from `parent`, is under Vite's resolution; null to leave it to Node. */
export function viteLikeTarget(specifier: string, parent: string | undefined): string | null {
  if (specifier.startsWith("@domain/")) return new URL(specifier.slice("@domain/".length), domain).href;
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[cm]?[jt]sx?$/.test(specifier) && parent?.startsWith("file:")) {
    const candidate = new URL(`${specifier}.ts`, parent);
    if (existsSync(fileURLToPath(candidate))) return candidate.href;
  }
  return null;
}

export function registerViteLikeResolution(): void {
  registerHooks({
    resolve: (specifier, context, next) => next(viteLikeTarget(specifier, context.parentURL) ?? specifier, context),
  });
}
