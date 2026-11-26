// Serves the documentation under /docs on the dev server and writes it into the build, from the
// repository's docs/ Markdown (render.ts). The pages' stylesheet (src/docs/docs.css) is a build
// entry of its own, so it's hashed and cached like the page's other assets.
import { join, resolve } from "node:path";
import type { Plugin } from "vite";
import { inlineIcons } from "../icons.ts";
import { buildDocs } from "./render.ts";

const ENTRY = "src/docs/entry.ts";

export function docs(repository: string): Plugin {
  let root = "";
  return {
    name: "penny-docs",
    config(config) {
      const siteRoot = config.root ?? process.cwd();
      return {
        build: {
          rolldownOptions: {
            input: { main: resolve(siteRoot, "index.html"), docs: resolve(siteRoot, ENTRY) },
          },
        },
      };
    },
    configResolved(config) {
      root = config.root;
    },
    configureServer(server) {
      server.watcher.add(join(repository, "docs"));
      server.watcher.on("change", (file) => {
        if (file.startsWith(join(repository, "docs")) && file.endsWith(".md")) server.ws.send({ type: "full-reload" });
      });
      server.middlewares.use(async (request, response, next) => {
        const path = (request.url ?? "").split(/[?#]/)[0] ?? "";
        if (path !== "/docs" && !path.startsWith("/docs/")) return next();
        if (!path.endsWith("/")) {
          response.statusCode = 308;
          response.setHeader("Location", `${path}/`);
          return response.end();
        }
        const html = buildDocs(repository, { css: "/src/docs/docs.css" }).get(`${path.slice(1)}index.html`);
        if (!html) return next();
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(await server.transformIndexHtml(path, html));
      });
    },
    generateBundle(_options, bundle) {
      const entry = Object.values(bundle).find((file) => file.type === "chunk" && file.isEntry && file.facadeModuleId === resolve(root, ENTRY));
      if (!entry || entry.type !== "chunk") throw new Error(`The docs stylesheet entry (${ENTRY}) is missing from the build`);
      const [css] = [...(entry.viteMetadata?.importedCss ?? [])];
      if (!css) throw new Error("The docs entry produced no stylesheet");
      // The entry only carries the stylesheet: no script ships with the docs.
      delete bundle[entry.fileName];
      for (const [fileName, html] of buildDocs(repository, { css: `/${css}` })) {
        this.emitFile({ type: "asset", fileName, source: inlineIcons(html) });
      }
    },
  };
}
