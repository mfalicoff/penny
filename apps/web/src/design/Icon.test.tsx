import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Icon } from "./Icon";

describe("Icon", () => {
  it("is decorative by default", () => {
    const { container } = render(<Icon name="leaf" />);
    const icon = container.firstElementChild;
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon?.querySelector("svg path")).not.toBeNull();
  });

  it("exposes an accessible name when labelled", () => {
    const { getByRole } = render(<Icon name="search" label="Search" size={16} />);
    expect(getByRole("img", { name: "Search" })).toHaveStyle({ width: "16px", height: "16px" });
  });
});
