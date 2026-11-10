import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import { shouldRetry } from "./queryClient";

describe("shouldRetry", () => {
  it("never retries client errors", () => {
    expect(shouldRetry(0, new ApiError(401, "Not signed in."))).toBe(false);
    expect(shouldRetry(0, new ApiError(409, "Conflict"))).toBe(false);
  });

  it("retries network and server errors twice", () => {
    for (const error of [new ApiError(0, "offline"), new ApiError(503, "unavailable"), new Error("boom")]) {
      expect(shouldRetry(0, error)).toBe(true);
      expect(shouldRetry(1, error)).toBe(true);
      expect(shouldRetry(2, error)).toBe(false);
    }
  });
});
