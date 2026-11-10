// Builds dist/index.js (ESM, React external), dist/index.d.ts tree, dist/styles.css and dist/fonts.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
  jsx: "automatic",
  external: ["react", "react-dom", "react/jsx-runtime"],
  outfile: "dist/index.js",
});

execFileSync("npx", ["tsc", "-p", "tsconfig.json"], { stdio: "inherit" });
cpSync("src/styles.css", "dist/styles.css");
cpSync("fonts", "dist/fonts", { recursive: true });
console.log("built dist/");
