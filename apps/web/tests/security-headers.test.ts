// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "../scripts/security-headers.ts";

// MAZ-94: the page policy `vite preview` (and so Playwright) runs under is the one production sends.
describe("Content-Security-Policy", () => {
  const directives = new Map(contentSecurityPolicy.split("; ").map((directive) => [directive.split(" ")[0], directive]));

  it("lets the same-origin pdf.js worker and blob receipt photos load, and nothing third-party", () => {
    expect(directives.get("worker-src")).toBe("worker-src 'self'");
    expect(directives.get("script-src")).toBe("script-src 'self'");
    expect(directives.get("img-src")).toBe("img-src 'self' blob:");
    expect(directives.get("connect-src")).toBe("connect-src 'self'");
    expect(directives.get("object-src")).toBe("object-src 'none'");
    expect(directives.get("frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(contentSecurityPolicy).not.toMatch(/unsafe-eval|wasm-unsafe-eval|https?:|\*/);
  });

  it("is the policy the NixOS module's nginx sends for the app", () => {
    const module = readFileSync(new URL("../../../nix/module.nix", import.meta.url), "utf8");
    expect(module).toContain(`add_header Content-Security-Policy "${contentSecurityPolicy}" always;`);
  });
});
