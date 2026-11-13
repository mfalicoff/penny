import { createFileRoute } from "@tanstack/react-router";
import { HomePage } from "../features/home/HomePage";
import { homeSearchSchema } from "../features/home/model";

/**
 * Home (MAZ-92): the month's overview. Search parameters (`month`, and the Explore your month
 * list's `day`, `q`, `kind`, `category`) are described in `features/home/model.ts`; invalid
 * values fall back, so old links still open.
 */
export const Route = createFileRoute("/")({
  staticData: { title: "Home" },
  validateSearch: homeSearchSchema,
  component: Home,
});

function Home() {
  const search = Route.useSearch();
  return <HomePage search={search} />;
}
