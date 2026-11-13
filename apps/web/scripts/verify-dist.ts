// Verifies the production static artifact (MAZ-83): every asset the HTML and CSS
// reference exists under dist/, the Inter font and its license ship, asset URLs
// are root-absolute (deep links like /transactions resolve them), and no server-side
// configuration or database credential leaked into the bundle.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist", import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

export function verifyDist(root: string): string[] {
  const problems: string[] = [];
  const index = join(root, "index.html");
  if (!existsSync(index)) return [`missing ${index}; run vite build first`];

  const all = files(root);
  const html = readFileSync(index, "utf8");
  const htmlRefs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1] ?? "");
  for (const ref of htmlRefs) {
    if (/^(https?:)?\/\//.test(ref)) {
      problems.push(`index.html loads a third-party URL: ${ref}`);
      continue;
    }
    if (!ref.startsWith("/")) problems.push(`index.html reference is not root-absolute: ${ref}`);
    if (!existsSync(join(root, ref))) problems.push(`index.html references a missing file: ${ref}`);
  }

  for (const css of all.filter((path) => path.endsWith(".css"))) {
    for (const match of readFileSync(css, "utf8").matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
      const ref = match[1] ?? "";
      if (ref.startsWith("data:")) continue;
      if (!ref.startsWith("/")) problems.push(`${relative(root, css)} url() is not root-absolute: ${ref}`);
      else if (!existsSync(join(root, ref))) problems.push(`${relative(root, css)} references a missing file: ${ref}`);
    }
  }

  if (!all.some((path) => /\/assets\/Inter-[\w-]+\.(ttf|woff2?)$/.test(path))) problems.push("Inter font is missing from assets/");
  for (const license of ["licenses/Inter-OFL.txt", "licenses/Ionicons-MIT.txt"]) {
    if (!existsSync(join(root, license))) problems.push(`missing ${license}`);
  }

  // Zod's compiler is off before Zod loads (src/app/zodConfig.ts), so the strict CSP never sees
  // its `new Function` probe: the entry's first import is that chunk. The bundler's own runtime
  // chunk (CommonJS interop helpers) may come first, as long as it imports nothing itself.
  const entry = /<script type="module"[^>]*src="\/([^"]+)"/.exec(html)?.[1];
  const entryPath = entry ? join(root, entry) : "";
  const entryImports = entryPath && existsSync(entryPath) ? [...readFileSync(entryPath, "utf8").matchAll(/import\s*(?:[^"';]*?from\s*)?["']\.\/([^"']+)["']/g)].map((m) => m[1] ?? "") : [];
  const isPureRuntime = (name: string) => /^rolldown-runtime-[\w-]+\.js$/.test(name) && !/\bimport\s*[{"'*\w]/.test(readFileSync(join(root, "assets", name), "utf8"));
  const firstImport = entryImports.find((name) => !isPureRuntime(name));
  const zodConfig = firstImport ? join(root, "assets", firstImport) : "";
  if (!zodConfig || !/zod-config-/.test(firstImport ?? "") || !existsSync(zodConfig) || !readFileSync(zodConfig, "utf8").includes("__zod_globalConfig")) {
    problems.push("the entry script must import the zod-config chunk first (src/app/zodConfig.ts)");
  }

  // The pdf.js worker (MAZ-94): one same-origin `.js` file under /assets/ (a JavaScript type on
  // every server, as module workers require), referenced root-absolute from the bundle.
  const workers = all.filter((path) => /\/assets\/pdf\.worker\.min-[\w-]+\.(m?js)$/.test(path) && readFileSync(path, "utf8").includes("WorkerMessageHandler"));
  if (workers.length !== 1) problems.push(`expected one pdf.js worker in assets/, found ${String(workers.length)}`);
  for (const worker of workers) {
    const name = relative(root, worker);
    if (name.endsWith(".mjs")) problems.push(`${name} must be emitted as .js`);
    const ref = `/${name.split("\\").join("/")}`;
    if (!all.some((path) => path.endsWith(".js") && path !== worker && readFileSync(path, "utf8").includes(ref))) problems.push(`no bundle references the pdf.js worker at ${ref}`);
  }
  if (all.some((path) => path.endsWith(".mjs"))) problems.push("dist/ contains .mjs files, which some servers send without a JavaScript type");

  const forbidden: [RegExp, string][] = [
    [/postgres(ql)?:\/\//i, "a PostgreSQL URL"],
    [/\b(Host|Server)=[^;"']+;\s*(Port|Database|Username)=/i, "a connection string"],
    [/ConnectionStrings__/, "a backend connection-string setting"],
    [/PENNY_API_URL|PENNY_TEST_TOKEN|POSTGRES_PASSWORD/, "a server-side environment variable name"],
    [/127\.0\.0\.1:\d+|localhost:\d+/, "a development server address"],
  ];
  for (const path of all.filter((p) => /\.(html|js|css|map|json|txt)$/.test(p))) {
    const text = readFileSync(path, "utf8");
    for (const [pattern, what] of forbidden) {
      if (pattern.test(text)) problems.push(`${relative(root, path)} contains ${what}`);
    }
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = verifyDist(dist);
  if (problems.length > 0) {
    console.error(`dist/ verification failed:\n- ${problems.join("\n- ")}`);
    process.exit(1);
  }
  console.log("dist/ verified: assets resolve, font and licenses ship, no server configuration in the bundle");
}
