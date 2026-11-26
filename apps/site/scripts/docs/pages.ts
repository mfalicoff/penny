/**
 * The documents published under /docs on the product page: the public part of the repository's
 * docs/ (self-hosting and using Penny). Development notes, plans, references and design cards
 * stay on GitHub, and links to them from these pages point there.
 */
export interface DocPage {
  /** Path under the repository's docs/. */
  source: string;
  /** The page's path under /docs/, without slashes at either end. */
  slug: string;
  /** The short name in the sidebar. */
  label: string;
  /** One or two sentences for its card on /docs/ and its meta description. */
  summary: string;
}

export interface DocSection {
  title: string;
  pages: readonly DocPage[];
}

export const SECTIONS: readonly DocSection[] = [
  {
    title: "Self-hosting",
    pages: [
      { source: "self-hosting/deployment.md", slug: "self-hosting/deployment", label: "Install and configure", summary: "Run Penny with Docker Compose: the stack, a quick start, the reverse proxy and TLS, configuration, upgrades and rolling back." },
      { source: "self-hosting/nixos.md", slug: "self-hosting/nixos", label: "NixOS", summary: "Run the same stack as native services with the flake's packages and NixOS module, its options and secrets." },
      { source: "self-hosting/email.md", slug: "self-hosting/email", label: "Email delivery", summary: "Optional SMTP for password reset links, invitations and email verification." },
      { source: "self-hosting/operations.md", slug: "self-hosting/operations", label: "Operations runbook", summary: "Health checks, logs, backups and restores, PostgreSQL maintenance, and what to do when something fails." },
      { source: "self-hosting/observability.md", slug: "self-hosting/observability", label: "Observability", summary: "A reference Grafana stack for the API's traces, metrics and logs, with dashboards and alerts." },
    ],
  },
  {
    title: "Using Penny",
    pages: [{ source: "product/app-guide.md", slug: "using-penny/app-guide", label: "App behavior and limits", summary: "How Penny counts your share of split costs, households, trips, recurring entries and offline sync." }],
  },
];

export const PAGES: readonly DocPage[] = SECTIONS.flatMap((section) => section.pages);

/** Where links to the rest of the repository go. */
export const REPOSITORY_URL = "https://github.com/mfalicoff/penny";
export const SOURCE_URL = `${REPOSITORY_URL}/blob/master`;
