import { CategoryIcon, CATEGORIES, type CategoryKey } from "@penny/ios-kit";

const keys = Object.keys(CATEGORIES) as CategoryKey[];

export const AllCategories = () => (
  <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 76px)", gap: 12, padding: 16 }}>
    {keys.map((k) => (
      <div key={k} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, fontSize: 11, color: "var(--pk-label-2)" }}>
        <CategoryIcon category={k} />{CATEGORIES[k].label}
      </div>
    ))}
  </div>
);

export const Sizes = () => (
  <div style={{ display: "flex", gap: 14, alignItems: "center", padding: 16 }}>
    <CategoryIcon category="food" size="sm" />
    <CategoryIcon category="food" size="md" />
    <CategoryIcon category="food" size="lg" />
  </div>
);
