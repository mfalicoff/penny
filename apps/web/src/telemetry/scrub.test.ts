import { describe, expect, it } from "vitest";
import { scrubItem, scrubText, scrubUrl } from "./scrub";

describe("scrubUrl", () => {
  it("keeps the origin and route shape and drops ids, queries and fragments", () => {
    expect(scrubUrl("https://penny.example.com/households/7f3c9a2e-1b4d-4e8f-9a6b-2c1d3e4f5a6b/expenses/42?tab=month#x")).toBe(
      "https://penny.example.com/households/:id/expenses/:id",
    );
    expect(scrubUrl("/transactions?q=pharmacy&category=health")).toBe("/transactions");
    expect(scrubUrl("/auth/callback?code=SplxlOBeZQQYbYS6WxSbIA&state=af0ifjsldkj")).toBe("/auth/callback");
    expect(scrubUrl("/api/households/abc123/months/2026-10")).toBe("/api/households/:id/months/:id");
    // Letter-only hex ids and uppercase invite codes are ids too; real route words survive.
    expect(scrubUrl("/households/deadbeefcafe/expenses/fadedbead")).toBe("/households/:id/expenses/:id");
    expect(scrubUrl("/join/KXQMWPRT")).toBe("/join/:id");
    expect(scrubUrl("/api/v1/search/transactions")).toBe("/api/v1/search/transactions");
    expect(scrubUrl("/api/auth/password-reset")).toBe("/api/auth/password-reset");
  });

  it("keeps asset file names so stack traces stay readable", () => {
    expect(scrubUrl("https://penny.example.com/assets/index-Bx3a9_q.js")).toBe("https://penny.example.com/assets/index-Bx3a9_q.js");
  });

  it("leaves strings that are not URLs alone", () => {
    expect(scrubUrl("navigation")).toBe("navigation");
    expect(scrubUrl("//evil")).toBe("//evil");
  });
});

describe("scrubText", () => {
  it("redacts emails, quoted text, numbers and URLs but keeps the wording", () => {
    expect(scrubText('Invalid amount "12.50" for maria@example.com at https://penny.example.com/trips/9f2?x=1 after 3 retries')).toBe(
      "Invalid amount <text> for <email> at https://penny.example.com/trips/:id after <n> retries",
    );
    expect(scrubText("Cannot read properties of undefined (reading 'total')")).toBe("Cannot read properties of undefined (reading <text>)");
  });
});

describe("scrubItem", () => {
  it("scrubs a Faro exception, its page and its stack, without touching timings", () => {
    const item = {
      type: "exception",
      payload: {
        type: "TypeError",
        value: "Search for 'coffee' failed",
        stacktrace: { frames: [{ filename: "https://penny.example.com/assets/index-Bx3a9.js", function: "load", lineno: 12, colno: 7 }] },
      },
      meta: { page: { url: "https://penny.example.com/transactions?q=coffee", id: "https://penny.example.com/transactions?q=coffee" } },
    };
    expect(scrubItem(item)).toEqual({
      type: "exception",
      payload: {
        type: "TypeError",
        value: "Search for <text> failed",
        stacktrace: { frames: [{ filename: "https://penny.example.com/assets/index-Bx3a9.js", function: "load", lineno: 12, colno: 7 }] },
      },
      meta: { page: { url: "https://penny.example.com/transactions", id: "https://penny.example.com/transactions" } },
    });
  });

  it("scrubs URLs in OTLP span attributes", () => {
    const span = { attributes: [{ key: "http.url", value: { stringValue: "https://penny.example.com/api/households/abc123?x=1" } }, { key: "http.status_code", value: { intValue: 200 } }] };
    expect(scrubItem(span)).toEqual({
      attributes: [{ key: "http.url", value: { stringValue: "https://penny.example.com/api/households/:id" } }, { key: "http.status_code", value: { intValue: 200 } }],
    });
  });
});
