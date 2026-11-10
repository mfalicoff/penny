import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <>
      <h1>Home</h1>
      <p>The redesigned overview arrives with MAZ-85 and MAZ-92.</p>
    </>
  );
}
