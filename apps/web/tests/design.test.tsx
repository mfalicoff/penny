import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initials } from "../src/design/controls";
import { formatCents, Money } from "../src/design/Money";

describe("money", () => {
  it("formats cents in the given currency, or as a plain number without one", () => {
    expect(formatCents(123456, "CAD")).toBe("$1,234.56");
    expect(formatCents(500, "EUR")).toBe("€5.00");
    expect(formatCents(500)).toBe("5.00");
    expect(formatCents(-1999, "CAD", { signed: true })).toBe("-$19.99");
    expect(formatCents(1999, "CAD", { signed: true })).toBe("+$19.99");
  });

  it("states what a meaning color stands for in text", () => {
    render(<Money cents={225000} currency="CAD" tone="income" />);
    expect(screen.getByText("$2,250.00")).toHaveClass("pk-money--income", "pk-num");
    expect(screen.getByText("income")).toHaveClass("visually-hidden");
  });

  it("keeps expenses in the label color with no extra words", () => {
    const { container } = render(<Money cents={6500} currency="CAD" />);
    expect(container.textContent).toBe("$65.00");
    expect(container.firstElementChild?.className).not.toMatch(/pk-money--/);
  });
});

describe("initials", () => {
  it.each([
    ["Max Falicoff", "MF"],
    ["alex@example.test", "AL"],
    ["jean-luc.picard@example.test", "JL"],
    ["", "?"],
  ])("%s → %s", (name, expected) => {
    expect(initials(name)).toBe(expected);
  });
});
