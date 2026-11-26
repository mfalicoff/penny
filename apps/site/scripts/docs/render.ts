// Renders the published documents (pages.ts) from the repository's Markdown into the static
// pages served under /docs. The Vite plugin (plugin.ts) calls it while building and on the dev
// server, so the pages always match docs/ at the commit that's deployed.
import { readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { Marked, type Token, type Tokens } from "marked";
import { PAGES, REPOSITORY_URL, SECTIONS, SOURCE_URL, type DocPage } from "./pages.ts";

export interface Heading {
  depth: number;
  id: string;
  text: string;
}

export interface RenderedDoc {
  page: DocPage;
  title: string;
  /** The article's HTML, from the first heading down. */
  html: string;
  headings: Heading[];
  /** Every link in the article after rewriting, for the tests. */
  links: string[];
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

/** Text content of rendered inline HTML. */
function plainText(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&(amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity);
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);
}

/** GitHub's heading anchors, so links written for GitHub keep working: `#password-reset-maz-123`. */
export function slugger(): (text: string) => string {
  const seen = new Map<string, number>();
  return (text) => {
    const base = text
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .replace(/\s/g, "-");
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
}

/** The page's URL path under /docs/. */
export function pagePath(page: DocPage): string {
  return `/docs/${page.slug}/`;
}

/**
 * Where a link in `source` (a path under docs/) goes on the site: published documents stay on
 * the site, docs/README.md becomes /docs/, anything else in the repository goes to GitHub.
 */
export function rewriteHref(href: string, source: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#") || href.startsWith("/")) return href;
  const [path = "", anchor] = href.split("#", 2);
  const fragment = anchor ? `#${anchor}` : "";
  const target = posix.normalize(posix.join("docs", posix.dirname(source), path)).replace(/\/$/, "");
  if (target === "docs/README.md") return `/docs/${fragment}`;
  const page = PAGES.find((candidate) => `docs/${candidate.source}` === target);
  if (page) return `${pagePath(page)}${fragment}`;
  const isFolder = path.endsWith("/") || !posix.extname(target);
  return `${SOURCE_URL.replace("/blob/", isFolder ? "/tree/" : "/blob/")}/${target}${fragment}`;
}

/** The "App showcase · Documentation · …" line under a document's title, for GitHub readers. */
function isBreadcrumb(token: Token | undefined): boolean {
  if (token?.type !== "paragraph") return false;
  const inline = (token as Tokens.Paragraph).tokens;
  return inline.length > 0 && inline.every((part) => part.type === "link" || (part.type === "text" && /^[\s·]*$/.test(part.raw)));
}

export function renderDoc(page: DocPage, markdown: string): RenderedDoc {
  const slug = slugger();
  const headings: Heading[] = [];
  const links: string[] = [];
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        const text = plainText(inner);
        const id = slug(text);
        headings.push({ depth, id, text });
        if (depth === 1) return `<h1 id="${id}">${inner}</h1>\n`;
        return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>${inner}</h${depth}>\n`;
      },
      link({ href, title, tokens }) {
        const target = rewriteHref(href, page.source);
        links.push(target);
        const external = /^https?:/.test(target);
        const attributes = `href="${escapeHtml(target)}"${title ? ` title="${escapeHtml(title)}"` : ""}${external ? ' rel="noopener"' : ""}`;
        return `<a ${attributes}>${this.parser.parseInline(tokens)}</a>`;
      },
    },
  });

  const tokens = marked.lexer(markdown);
  const first = tokens.findIndex((token) => token.type === "heading" && (token as Tokens.Heading).depth === 1);
  const breadcrumb = tokens.slice(first + 1).findIndex((token) => token.type !== "space");
  if (first >= 0 && isBreadcrumb(tokens[first + 1 + breadcrumb])) tokens.splice(first + 1 + breadcrumb, 1);

  // Wide tables scroll inside the article instead of widening the page.
  const html = marked.parser(tokens).replace(/<table>/g, '<div class="table"><table>').replace(/<\/table>/g, "</table></div>");
  const title = headings.find((heading) => heading.depth === 1)?.text ?? page.label;
  return { page, title, html, headings, links };
}

/** Reads and renders every published document from the repository's docs/. */
export function renderAll(repository: string): RenderedDoc[] {
  return PAGES.map((page) => renderDoc(page, readFileSync(join(repository, "docs", page.source), "utf8")));
}

function shorten(text: string, length: number): string {
  if (text.length <= length) return text;
  return `${text.slice(0, text.lastIndexOf(" ", length))}…`;
}

interface Assets {
  /** The stylesheet's URL. */
  css: string;
}

function sidebar(current: DocPage | null): string {
  const sections = SECTIONS.map(
    (section) => `<p class="docs-nav-title">${escapeHtml(section.title)}</p>
        <ul>${section.pages
          .map((page) => {
            const here = page === current ? ' aria-current="page"' : "";
            return `<li><a href="${pagePath(page)}"${here}>${escapeHtml(page.label)}</a></li>`;
          })
          .join("")}</ul>`,
  ).join("\n        ");
  const links = `<a class="docs-nav-home" href="/docs/"${current ? "" : ' aria-current="page"'}>Overview</a>
        ${sections}`;
  // A sidebar on wide windows; a closed "Contents" disclosure on narrow ones (no script needed).
  return `<nav class="docs-nav docs-sidebar" aria-label="Documentation">
        ${links}
      </nav>
      <details class="docs-nav docs-contents">
        <summary>Contents</summary>
        <nav aria-label="Documentation">
        ${links}
        </nav>
      </details>`;
}

function layout(options: { title: string; description: string; assets: Assets; current: DocPage | null; main: string; aside?: string }): string {
  const { title, description, assets, current, main, aside = "" } = options;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${escapeHtml(title)} · Penny documentation</title>
    <meta name="description" content="${escapeHtml(shorten(description, 200))}" />
    <meta name="theme-color" content="#000000" />
    <meta name="color-scheme" content="dark" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="${assets.css}" />
  </head>
  <body class="docs">
    <header class="docs-header">
      <a class="brand" href="/" aria-label="Penny home">
        <i data-logo></i>
        <span>penny<span class="dot">.</span></span>
      </a>
      <nav aria-label="Main">
        <a href="/#glance">Features</a>
        <a href="/docs/"${current ? "" : ' aria-current="page"'}>Docs</a>
        <a class="button button-small" href="${REPOSITORY_URL}">GitHub</a>
      </nav>
    </header>
    <div class="docs-layout">
      ${sidebar(current)}
      <main id="content">
${main}
      </main>
      ${aside}
    </div>
    <footer class="docs-footer">
      <span>© Penny · MIT</span>
      ${current ? `<a href="${SOURCE_URL}/docs/${current.source}" rel="noopener">Edit this page on GitHub</a>` : `<a href="${REPOSITORY_URL}/tree/master/docs" rel="noopener">All documentation on GitHub</a>`}
    </footer>
  </body>
</html>
`;
}

export function docPageHtml(doc: RenderedDoc, assets: Assets): string {
  const sections = doc.headings.filter((heading) => heading.depth === 2);
  const toc = sections.length > 1
    ? `<aside class="docs-toc" aria-label="On this page">
        <p>On this page</p>
        <ul>${sections.map((heading) => `<li><a href="#${heading.id}">${escapeHtml(heading.text)}</a></li>`).join("")}</ul>
      </aside>`
    : "";
  return layout({ title: doc.title, description: doc.page.summary, assets, current: doc.page, main: `<article class="prose">\n${doc.html}</article>`, aside: toc });
}

export function indexHtml(docs: readonly RenderedDoc[], assets: Assets): string {
  const cards = SECTIONS.map(
    (section) => `<section>
          <h2>${escapeHtml(section.title)}</h2>
          <div class="docs-cards">${section.pages
            .map((page) => {
              const doc = docs.find((candidate) => candidate.page === page);
              return `<a class="docs-card" href="${pagePath(page)}">
              <h3>${escapeHtml(doc?.title ?? page.label)}</h3>
              <p>${escapeHtml(page.summary)}</p>
            </a>`;
            })
            .join("")}</div>
        </section>`,
  ).join("\n        ");
  const main = `<div class="docs-index">
        <p class="eyebrow">Documentation</p>
        <h1>Run Penny, and get the most out of it.</h1>
        <p class="lede">Install Penny on your own server with Docker Compose or NixOS, keep it healthy, and learn how the apps count your money.</p>
        ${cards}
      </div>`;
  return layout({
    title: "Overview",
    description: "Install, configure and run Penny, the self-hosted expense tracker, and learn how its apps count your money.",
    assets,
    current: null,
    main,
  });
}

/** Every page as `docs/<slug>/index.html` → HTML, plus the overview at `docs/index.html`. */
export function buildDocs(repository: string, assets: Assets): Map<string, string> {
  const docs = renderAll(repository);
  const files = new Map<string, string>([["docs/index.html", indexHtml(docs, assets)]]);
  for (const doc of docs) files.set(`docs/${doc.page.slug}/index.html`, docPageHtml(doc, assets));
  return files;
}

export const repositoryRoot = (siteRoot: string) => dirname(dirname(siteRoot));
