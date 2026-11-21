import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pointerCanPause, TOAST_MAX_HOVER_MS, TOAST_MS, toastDelay, ToastProvider, useToast, useToastEntry } from "../src/design/states";

// MAZ-162: on touch screens a tap leaves a "hover" behind, so a toast that paused on any
// pointer never closed and kept covering the rows under it.

function stubHover(fine: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({ matches: fine, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
}

function Trigger({ undo }: { undo?: () => void }) {
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={() => {
        toast.show({ title: "Share marked as paid", ...(undo ? { onUndo: undo } : {}) });
      }}
    >
      Show
    </button>
  );
}

function showToast(undo?: () => void) {
  render(
    <ToastProvider>
      <Trigger {...(undo ? { undo } : {})} />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Show" }));
  return screen.getByText("Share marked as paid").closest(".pk-toast") as HTMLElement;
}

const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

describe("toastDelay", () => {
  it("closes after TOAST_MS when nothing holds it", () => {
    expect(toastDelay({ hovered: false, focused: false })).toBe(TOAST_MS);
  });

  it("holds a hovered toast only up to the maximum pause", () => {
    expect(toastDelay({ hovered: true, focused: false })).toBe(TOAST_MAX_HOVER_MS);
  });

  it("holds a keyboard-focused toast until focus leaves", () => {
    expect(toastDelay({ hovered: false, focused: true })).toBeNull();
    expect(toastDelay({ hovered: true, focused: true })).toBeNull();
  });
});

describe("pointerCanPause", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pauses for a mouse on a device that hovers with a fine pointer", () => {
    stubHover(true);
    expect(pointerCanPause("mouse")).toBe(true);
  });

  it("never pauses for touch or pen", () => {
    stubHover(true);
    expect(pointerCanPause("touch")).toBe(false);
    expect(pointerCanPause("pen")).toBe(false);
  });

  it("doesn't pause for emulated mouse events on a touch screen", () => {
    stubHover(false);
    expect(pointerCanPause("mouse")).toBe(false);
  });
});

describe("ToastProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("closes on its own after a tap leaves a touch pointer on it", () => {
    stubHover(false);
    const toast = showToast();
    fireEvent.pointerOver(toast, { pointerType: "touch" });
    advance(TOAST_MS + 10);
    expect(screen.queryByText("Share marked as paid")).not.toBeInTheDocument();
  });

  it("pauses under a mouse, then closes after the maximum pause", () => {
    stubHover(true);
    const toast = showToast();
    fireEvent.pointerOver(toast, { pointerType: "mouse" });
    advance(TOAST_MS * 2);
    expect(screen.getByText("Share marked as paid")).toBeInTheDocument();
    advance(TOAST_MAX_HOVER_MS - TOAST_MS * 2 + 10);
    expect(screen.queryByText("Share marked as paid")).not.toBeInTheDocument();
  });

  it("restarts the full delay when the mouse leaves", () => {
    stubHover(true);
    const toast = showToast();
    fireEvent.pointerOver(toast, { pointerType: "mouse" });
    advance(TOAST_MS * 2);
    fireEvent.pointerOut(toast, { pointerType: "mouse" });
    advance(TOAST_MS - 10);
    expect(screen.getByText("Share marked as paid")).toBeInTheDocument();
    advance(20);
    expect(screen.queryByText("Share marked as paid")).not.toBeInTheDocument();
  });

  it("stays for its own duration (the 8-second attached confirmation) and runs its extra action", () => {
    const view = vi.fn();
    function Attached() {
      const toast = useToast();
      return (
        <button
          type="button"
          onClick={() => {
            toast.show({ title: "Receipt attached to Lunch.", durationMs: 8000, action: { label: "View entry", onClick: view }, onUndo: vi.fn() });
          }}
        >
          Show
        </button>
      );
    }
    render(
      <ToastProvider>
        <Attached />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    advance(TOAST_MS + 500);
    expect(screen.getByText("Receipt attached to Lunch.")).toBeInTheDocument();
    advance(8000 - TOAST_MS);
    expect(screen.queryByText("Receipt attached to Lunch.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    fireEvent.click(screen.getByRole("button", { name: "View entry" }));
    expect(view).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Receipt attached to Lunch.")).not.toBeInTheDocument();
  });

  it("stays while keyboard focus is on Undo, past the hover limit, and closes once focus leaves", () => {
    const undo = vi.fn();
    showToast(undo);
    const undoButton = screen.getByRole("button", { name: "Undo" });
    act(() => {
      undoButton.focus();
    });
    advance(TOAST_MAX_HOVER_MS * 2);
    expect(screen.getByText("Share marked as paid")).toBeInTheDocument();
    act(() => {
      screen.getByRole("button", { name: "Show" }).focus();
    });
    advance(TOAST_MS + 10);
    expect(screen.queryByText("Share marked as paid")).not.toBeInTheDocument();
    expect(undo).not.toHaveBeenCalled();
  });
});

// MAZ-233, card iphone-saved-toast: Undo is the saved toast's only button, a filled capsule, and
// the entry it is about is exposed so its row can be highlighted while it shows.
describe("saved toast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function Saved() {
    const toast = useToast();
    const entry = useToastEntry();
    return (
      <>
        <button
          type="button"
          onClick={() => {
            toast.show({
              title: "Expense added",
              detail: "Groceries · $48.90",
              entryId: "e-1",
              tile: { icon: "basket", color: "var(--pk-c-groceries)" },
              onUndo: vi.fn(),
            });
          }}
        >
          Add
        </button>
        <button
          type="button"
          onClick={() => {
            toast.show({ title: "Receipt attached", entryId: "e-2", onUndo: vi.fn(), action: { label: "View entry", onClick: vi.fn() } });
          }}
        >
          Attach
        </button>
        <output aria-label="Highlighted">{entry ?? "none"}</output>
      </>
    );
  }

  it("has Undo alone, as a capsule, and highlights its entry until it closes", () => {
    render(
      <ToastProvider>
        <Saved />
      </ToastProvider>,
    );
    expect(screen.getByLabelText("Highlighted")).toHaveTextContent("none");
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("button", { name: "Undo" })).toHaveClass("pk-toast__undo");
    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Highlighted")).toHaveTextContent("e-1");
    advance(TOAST_MS + 10);
    expect(screen.queryByText("Expense added")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Highlighted")).toHaveTextContent("none");
  });

  // MAZ-237: the saved toast leads with the entry's category tile, not a green check (green means income).
  it("leads with the entry's category tile instead of the check", () => {
    const { container } = render(
      <ToastProvider>
        <Saved />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const tile = container.querySelector<HTMLElement>(".pk-toast__tile");
    expect(tile).not.toBeNull();
    expect(tile?.style.background).toBe("var(--pk-c-groceries)");
    expect(container.querySelectorAll(".pk-toast .icon")).toHaveLength(1);
    expect(tile?.querySelector(".icon")).not.toBeNull();
  });

  it("keeps the close button when the toast has another action", () => {
    render(
      <ToastProvider>
        <Saved />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).not.toHaveClass("pk-toast__undo");
  });
});
