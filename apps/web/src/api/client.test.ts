import { describe, expect, it } from "vitest";
import { z } from "zod";
import { json, stubFetch } from "../../tests/render";
import { ApiError, apiFetch } from "./client";

const schema = z.object({ ok: z.boolean() });

describe("apiFetch", () => {
  it("calls the same origin with credentials and returns validated data", async () => {
    const fetchMock = stubFetch(() => json({ ok: true, extra: "tolerated" }));
    await expect(apiFetch("/api/thing", schema)).resolves.toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/thing");
    expect(init).toMatchObject({ method: "GET", credentials: "same-origin", body: null });
  });

  it("sends JSON bodies with a content type", async () => {
    const fetchMock = stubFetch(() => json({ ok: true }));
    await apiFetch("/api/thing", schema, { method: "POST", body: { a: 1 } });
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.body).toBe('{"a":1}');
    expect(init?.headers).toMatchObject({ "Content-Type": "application/json" });
  });

  it("surfaces the API's { error } message and status", async () => {
    stubFetch(() => json({ error: "Not signed in." }, 401));
    const error = await apiFetch("/api/thing", schema).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, message: "Not signed in.", isClientError: true });
  });

  it("falls back to a generic message for non-JSON errors", async () => {
    stubFetch(() => new Response("<html>Bad gateway</html>", { status: 502 }));
    await expect(apiFetch("/api/thing", schema)).rejects.toMatchObject({
      status: 502,
      message: "Request failed (502).",
      isClientError: false,
    });
  });

  it("rejects responses that don't match the schema", async () => {
    stubFetch(() => json({ ok: "yes" }));
    await expect(apiFetch("/api/thing", schema)).rejects.toMatchObject({
      status: 200,
      message: "The server sent a response Penny doesn't understand.",
    });
  });

  it("reports network failures as status 0", async () => {
    stubFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    await expect(apiFetch("/api/thing", schema)).rejects.toMatchObject({ status: 0 });
  });

  it("lets aborts propagate unchanged", async () => {
    stubFetch(() => {
      throw new DOMException("Aborted", "AbortError");
    });
    await expect(apiFetch("/api/thing", schema)).rejects.toMatchObject({ name: "AbortError" });
  });
});
