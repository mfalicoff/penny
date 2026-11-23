import { describe, expect, it } from "vitest";
import worker from "../src/index.ts";

describe("fetch", () => {
  it("answers 404 in plain text, taking no request, env or context", async () => {
    // It declares no parameters, so it can't read secrets or the recipient list.
    expect(worker.fetch.length).toBe(0);
    const response = worker.fetch();

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await response.text()).toContain("POST /cdn-cgi/handler/email");
  });
});
