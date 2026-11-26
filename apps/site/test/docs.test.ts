import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PAGES, SOURCE_URL } from "../scripts/docs/pages.ts";
import { buildDocs, pagePath, renderAll, rewriteHref, slugger } from "../scripts/docs/render.ts";

const repository = join(import.meta.dirname, "../../..");
const docs = renderAll(repository);

describe("rewriteHref", () => {
  it("keeps published documents on the site", () => {
    expect(rewriteHref("operations.md#back-up", "self-hosting/deployment.md")).toBe("/docs/self-hosting/operations/#back-up");
    expect(rewriteHref("../self-hosting/deployment.md", "product/app-guide.md")).toBe("/docs/self-hosting/deployment/");
    expect(rewriteHref("../README.md", "self-hosting/nixos.md")).toBe("/docs/");
  });

  it("sends the rest of the repository to GitHub", () => {
    expect(rewriteHref("../reference/push.md", "self-hosting/deployment.md")).toBe(`${SOURCE_URL}/docs/reference/push.md`);
    expect(rewriteHref("../../README.md", "self-hosting/deployment.md")).toBe(`${SOURCE_URL}/README.md`);
    expect(rewriteHref("../../deploy/", "self-hosting/deployment.md")).toBe(`${SOURCE_URL.replace("/blob/", "/tree/")}/deploy`);
  });

  it("leaves absolute links and anchors alone", () => {
    expect(rewriteHref("https://example.com/a.md", "self-hosting/email.md")).toBe("https://example.com/a.md");
    expect(rewriteHref("#topology", "self-hosting/deployment.md")).toBe("#topology");
  });
});

describe("slugger", () => {
  it("matches GitHub's heading anchors, duplicates included", () => {
    const slug = slugger();
    expect(slug("Password reset (MAZ-123)")).toBe("password-reset-maz-123");
    expect(slug("Deployment: the PDF worker and security headers")).toBe("deployment-the-pdf-worker-and-security-headers");
    expect(slug("Upgrade")).toBe("upgrade");
    expect(slug("Upgrade")).toBe("upgrade-1");
  });
});

describe.each(docs.map((doc) => [doc.page.slug, doc] as const))("/docs/%s/", (_slug, doc) => {
  it("has a title and sections", () => {
    expect(doc.title.length).toBeGreaterThan(3);
    expect(doc.headings.filter((heading) => heading.depth === 2).length).toBeGreaterThan(0);
  });

  it("drops the GitHub breadcrumb line under the title", () => {
    expect(doc.html).not.toMatch(/<p>(<a [^>]+>[^<]+<\/a>\s*·\s*)+<a [^>]+>[^<]+<\/a><\/p>/);
  });

  it("has no link that leads nowhere", () => {
    for (const link of doc.links) {
      expect(link, "a relative Markdown link was not rewritten").not.toMatch(/^(?!https?:)[^#]*\.md(#|$)/);
      const [path = "", anchor] = link.split("#", 2);
      if (link.startsWith("#")) {
        expect(doc.headings.map((heading) => heading.id), link).toContain(anchor);
      } else if (path.startsWith("/docs/")) {
        const target = path === "/docs/" ? null : docs.find((candidate) => pagePath(candidate.page) === path);
        if (path !== "/docs/") expect(target, link).toBeDefined();
        if (anchor && target) expect(target.headings.map((heading) => heading.id), link).toContain(anchor);
      } else if (link.startsWith("https://github.com/mfalicoff/penny/")) {
        const file = link.replace(/^https:\/\/github\.com\/mfalicoff\/penny\/(blob|tree)\/master\//, "").split("#")[0] ?? "";
        expect(existsSync(join(repository, decodeURIComponent(file))), link).toBe(true);
      }
    }
  });
});

describe("the built docs", () => {
  const files = buildDocs(repository, { css: "/assets/docs.css" });

  it("have an overview and one page per document", () => {
    expect([...files.keys()].sort()).toEqual(["docs/index.html", ...PAGES.map((page) => `docs/${page.slug}/index.html`)].sort());
  });

  it("mark the current page in the navigation and link its source", () => {
    const page = PAGES[0]!;
    const html = files.get(`docs/${page.slug}/index.html`)!;
    expect(html).toContain(`<a href="${pagePath(page)}" aria-current="page">`);
    expect(html).toContain(`${SOURCE_URL}/docs/${page.source}`);
    expect(html).toContain('<link rel="stylesheet" href="/assets/docs.css" />');
  });
});
