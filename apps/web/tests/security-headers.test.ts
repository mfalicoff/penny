// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, contentSecurityPolicyFor } from "../scripts/security-headers.ts";

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

  it("allows exactly the configured telemetry collector, and only for requests (MAZ-129)", () => {
    const collector = "https://faro-collector-prod-us-east-0.grafana.net/collect/0123456789abcdef";
    const policy = contentSecurityPolicyFor(collector);
    expect(policy).toBe(contentSecurityPolicy.replace("connect-src 'self'", `connect-src 'self' ${collector}`));
    expect(policy.split(collector)).toHaveLength(2);
  });

  // Both front ends put the operator's collector (empty when off) after connect-src 'self'.
  it("is the policy the NixOS module's nginx sends for the app", () => {
    const module = readFileSync(new URL("../../../nix/module.nix", import.meta.url), "utf8");
    const slot = '${lib.optionalString (cfg.webTelemetryUrl != null) " ${cfg.webTelemetryUrl}"}';
    expect(module).toContain(`add_header Content-Security-Policy "${contentSecurityPolicy.replace("connect-src 'self'", `connect-src 'self'${slot}`)}" always;`);
  });

  it("is the policy the container image's nginx sends for the app", () => {
    const template = readFileSync(new URL("../../../deploy/web/default.conf.template", import.meta.url), "utf8");
    expect(template).toContain(`add_header Content-Security-Policy "${contentSecurityPolicyFor("${PENNY_WEB_TELEMETRY_URL}")}" always;`);
  });
});
