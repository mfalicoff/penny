import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useToday } from "../src/app/useToday";

/** `useToday` (MAZ-136): the local date, refreshed at midnight and on return to the tab. */
function Probe({ id }: { id: string }) {
  return <p data-testid={id}>{useToday()}</p>;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useToday", () => {
  it("moves to the next date at local midnight, the same value for every reader", () => {
    vi.setSystemTime(new Date(2026, 10, 10, 23, 59, 58));
    render(
      <>
        <Probe id="a" />
        <Probe id="b" />
      </>,
    );
    expect(screen.getByTestId("a")).toHaveTextContent("2026-11-10");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId("a")).toHaveTextContent("2026-11-10");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId("a")).toHaveTextContent("2026-11-11");
    expect(screen.getByTestId("b")).toHaveTextContent("2026-11-11");
    // And again the next night: the timer re-arms.
    act(() => {
      vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    });
    expect(screen.getByTestId("a")).toHaveTextContent("2026-11-12");
  });

  it("catches up when the tab becomes visible or gets focus after the date changed", () => {
    vi.setSystemTime(new Date(2026, 10, 10, 22, 0, 0));
    render(<Probe id="a" />);
    expect(screen.getByTestId("a")).toHaveTextContent("2026-11-10");
    // A sleeping laptop: the clock jumps without the midnight timer running.
    vi.setSystemTime(new Date(2026, 10, 11, 8, 0, 0));
    expect(screen.getByTestId("a")).toHaveTextContent("2026-11-10");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(screen.getByTestId("a")).toHaveTextContent("2026-11-11");
    vi.setSystemTime(new Date(2026, 10, 12, 8, 0, 0));
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(screen.getByTestId("a")).toHaveTextContent("2026-11-12");
  });

  it("stops its timer once nothing reads it", () => {
    vi.setSystemTime(new Date(2026, 10, 10, 12, 0, 0));
    const { unmount } = render(<Probe id="a" />);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
