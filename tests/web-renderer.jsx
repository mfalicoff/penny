import { afterEach, beforeEach, expect, jest } from "@jest/globals";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { SafeAreaProvider } from "react-native-safe-area-context";

let root;
let container;
let errors;
let warnings;

// Every consumer gets real DOM rendering and a strict console check, including cleanup.
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  errors = jest.spyOn(console, "error").mockImplementation(() => {});
  warnings = jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  try {
    await act(async () => root.unmount());
    expect(errors.mock.calls).toEqual([]);
    expect(warnings.mock.calls).toEqual([]);
  } finally {
    container.remove();
    errors.mockRestore();
    warnings.mockRestore();
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  }
});

export async function renderWeb(element) {
  await act(async () => root.render(
    <SafeAreaProvider initialMetrics={{
      frame: { x: 0, y: 0, width: 1200, height: 900 },
      insets: { top: 0, bottom: 0, left: 0, right: 0 },
    }}>
      {element}
    </SafeAreaProvider>,
  ));
  return document.body;
}

export function button(name) {
  const matches = [...document.querySelectorAll('[role="button"], button')].filter((node) =>
    (node.getAttribute("aria-label") || node.textContent).trim() === name,
  );
  expect(matches).toHaveLength(1);
  return matches[0];
}

export async function click(node) {
  await act(async () => node.click());
}

export async function fill(label, value) {
  const input = document.querySelector(`[aria-label="${label}"]`);
  expect(input).not.toBeNull();
  const prototype = input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
