import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initials } from "../src/design/controls";
import { categoryHex, categoryTint, ownTileStyle } from "../src/design/categoryTint";
import { formatCents, HeroMoney, Money } from "../src/design/Money";

describe("money", () => {
  it("formats cents in the given currency, or as a plain number without one", () => {
    expect(formatCents(123456, "CAD")).toBe("$1,234.56");
    expect(formatCents(500, "EUR")).toBe("€5.00");
    expect(formatCents(500)).toBe("5.00");
    expect(formatCents(-1999, "CAD", { signed: true })).toBe("−$19.99");
    expect(formatCents(1999, "CAD", { signed: true })).toBe("+$19.99");
  });

  it("draws hero cents smaller, after the whole units, with a typographic minus (MAZ-222)", () => {
    const { container, rerender } = render(<HeroMoney cents={111665} currency="CAD" />);
    expect(container.textContent).toBe("$1,116.65");
    expect(container.querySelector(".hero-money__cents")).toHaveTextContent(".65");
    rerender(<HeroMoney cents={-175950} currency="CAD" />);
    expect(container.textContent).toBe("\u2212$1,759.50");
    rerender(<HeroMoney cents={111665} currency="CAD" showCents={false} />);
    expect(container.textContent).toBe("$1,117");
    expect(container.querySelector(".hero-money__cents")).toBeNull();
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

describe("category tiles (MAZ-222)", () => {
  it("draws every category in the redesign palette, never the copper action tint", () => {
    // The default categories store the older ledger palette; copper #E47850 is Food & drinks.
    expect(categoryTint({ id: "food", color: "#E47850" })).toBe("var(--pk-c-food)");
    expect(categoryTint({ id: "custom", color: "#e47850" })).toBe("var(--pk-c-food)");
    // A default id keeps its own color, whatever older color it stores.
    expect(categoryTint({ id: "health", color: "#6C9C79" })).toBe("var(--pk-c-health)");
    expect(categoryTint({ id: "fun", color: "#9D83BA" })).toBe("var(--pk-c-entertainment)");
    // A redesign color is used as it is; anything else is gray.
    expect(categoryTint({ id: "custom", color: "#3B82F6" })).toBe("var(--pk-c-home)");
    expect(categoryTint({ id: "custom", color: "#E4572E" })).toBe("var(--pk-c-other)");
    expect(categoryTint(undefined)).toBe("var(--pk-c-other)");
  });

  it("uses the meaning color for income and investment entries", () => {
    expect(categoryTint({ id: "salary", color: "#6C9C79", entryKind: "income" })).toBe("var(--pk-income)");
    expect(categoryTint({ id: "investments", color: "#678DB1", entryKind: "investment" })).toBe("var(--pk-invest)");
    expect(categoryTint({ id: "groceries", color: "#6C9C79", entryKind: "expense" })).toBe("var(--pk-c-groceries)");
  });
});

describe("own category colors on the recap and the year in review (MAZ-290)", () => {
  it("keeps a color outside both palettes instead of gray", () => {
    expect(categoryHex({ color: "#5b7db1" })).toBe("#5B7DB1");
    expect(ownTileStyle({ color: "#5B7DB1" })).toEqual({ "--tile": "#5B7DB1" });
  });

  it("maps palette colors and default ids as everywhere else", () => {
    expect(categoryHex({ color: "#E47850" })).toBe("#E0529C");
    expect(categoryHex({ color: "#3B82F6" })).toBe("#3B82F6");
    expect(ownTileStyle({ id: "home", color: "#5B7DB1" })).toEqual({ "--tile": "var(--pk-c-home)" });
    expect(ownTileStyle({ color: "#5B7DB1", entryKind: "income" })).toEqual({ "--tile": "var(--pk-income)" });
  });

  it("draws an unreadable color gray", () => {
    expect(categoryHex({ color: "#12345G" })).toBe("#8E8A85");
    expect(categoryHex(undefined)).toBe("#8E8A85");
    expect(ownTileStyle({ color: "red" })).toEqual({ "--tile": "var(--pk-c-other)" });
  });
});
