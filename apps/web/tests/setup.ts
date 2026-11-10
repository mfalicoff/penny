import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { stopDemo } from "../src/demo/demo";

// Any console error or warning during a test is a failure: rendering must be clean.
let messages: string[] = [];

// jsdom has no scrolling; the router restores scroll positions on navigation.
if (typeof window !== "undefined") window.scrollTo = () => undefined;

beforeEach(() => {
  messages = [];
  for (const level of ["error", "warn"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      messages.push(`console.${level}: ${args.map(String).join(" ")}`);
    });
  }
});

afterEach(() => {
  cleanup();
  stopDemo();
  if (messages.length > 0) {
    throw new Error(`Unexpected console output:\n${messages.join("\n")}`);
  }
});
