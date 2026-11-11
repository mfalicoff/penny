import "@testing-library/jest-dom/vitest";
// IndexedDB for the durable offline store (MAZ-87); a fresh, empty database for every test.
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { stopDemo } from "../src/demo/demo";
import { draftStore } from "../src/features/entries/drafts";

// Any console error or warning during a test is a failure: rendering must be clean.
let messages: string[] = [];

// jsdom has no scrolling; the router restores scroll positions on navigation.
if (typeof window !== "undefined") window.scrollTo = () => undefined;

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
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
  // Add entry keeps an unsaved draft in memory for the tab; each test starts without one.
  draftStore.clearAll();
  if (messages.length > 0) {
    throw new Error(`Unexpected console output:\n${messages.join("\n")}`);
  }
});
