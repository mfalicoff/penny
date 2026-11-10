import { Link } from "@tanstack/react-router";
import type { IconName } from "../../design/Icon";
import { EmptyState } from "../../design/states";

/**
 * Keeps a legacy deep link working before its web screen exists: the URL opens, names the page and
 * points somewhere useful, instead of a "page not found". Each feature issue replaces its use.
 */
export function NotYetAvailable({ page, icon }: { page: string; icon: IconName }) {
  return (
    <EmptyState
      icon={icon}
      title={`${page} isn't in the web app yet`}
      action={
        <Link to="/" className="wbtn wbtn--secondary">
          Go to Home
        </Link>
      }
    >
      <p>Use the Penny app on your phone for {page.toLowerCase()} for now. Everything you do there syncs here.</p>
    </EmptyState>
  );
}
