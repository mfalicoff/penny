// @vitest-environment node
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiError, apiFetch, hasCode, setTransport } from "../src/api/client";
import { ERROR_CODES } from "../src/api/errorCodes";

const contractError = z
  .object({
    components: z.object({
      schemas: z.object({
        Error: z.object({
          required: z.array(z.string()),
          properties: z.object({
            code: z.object({ enum: z.array(z.string()) }),
          }),
        }),
      }),
    }),
  })
  .parse(
    JSON.parse(
      readFileSync(
        new URL("../../../contracts/openapi.json", import.meta.url),
        "utf8",
      ),
    ),
  ).components.schemas.Error;

afterEach(() => {
  setTransport(null);
});

function answer(status: number, body: unknown) {
  setTransport(() =>
    Promise.resolve(
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
}

const failure = async () => {
  try {
    await apiFetch("/api/ledger", z.unknown());
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("expected a failure");
};

describe("API error codes (MAZ-187)", () => {
  it("lists exactly the contract's codes", () => {
    expect([...ERROR_CODES].sort()).toEqual(
      [...contractError.properties.code.enum].sort(),
    );
    expect(contractError.required).toEqual(["error", "code"]);
  });

  it("keeps the server's message and code", async () => {
    answer(409, {
      error:
        "Your data changed on another device. Please refresh and try again.",
      code: "ledger.conflict",
    });
    const error = await failure();
    expect(error.status).toBe(409);
    expect(error.message).toBe(
      "Your data changed on another device. Please refresh and try again.",
    );
    expect(error.code).toBe("ledger.conflict");
    expect(error.is("ledger.conflict")).toBe(true);
    expect(hasCode(error, "ledger.conflict")).toBe(true);
    expect(hasCode(error, "expense.changed")).toBe(false);
  });

  it("has no code when the server sent none or the body isn't JSON", async () => {
    answer(400, { error: "Invalid request." });
    expect((await failure()).code).toBeUndefined();
    answer(502, "<html>Bad gateway</html>");
    const error = await failure();
    expect(error.code).toBeUndefined();
    expect(error.message).toBe("Request failed (502).");
    answer(400, { error: "Invalid request.", code: 7 });
    expect((await failure()).code).toBeUndefined();
  });

  it("never matches a code for errors that aren't API failures", () => {
    expect(hasCode(new Error("ledger.conflict"), "ledger.conflict")).toBe(
      false,
    );
    expect(hasCode(undefined, "ledger.conflict")).toBe(false);
  });
});
