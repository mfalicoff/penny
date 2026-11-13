import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { CategoriesPage } from "../features/organize/CategoriesPage";

/**
 * The kind shown lives in the URL (`/categories?kind=income`), so a link opens on it and Back
 * returns to the previous kind. Old or hand-edited links fall back to expenses.
 */
export const categoriesSearchSchema = z.object({
  kind: z.enum(["expense", "income", "investment"]).optional().catch(undefined),
});

/** Categories (MAZ-89). */
export const Route = createFileRoute("/categories")({
  staticData: { title: "Categories" },
  validateSearch: categoriesSearchSchema,
  component: Categories,
});

function Categories() {
  const { kind = "expense" } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <CategoriesPage
      kind={kind}
      onKindChange={(next) => {
        void navigate({ search: (previous) => ({ ...previous, kind: next === "expense" ? undefined : next }) });
      }}
    />
  );
}
