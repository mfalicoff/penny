import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { cx } from "../../design/controls";
import { Icon, type IconName } from "../../design/Icon";
import { useInboxStatus } from "../receiptInbox/useInbox";

type Section = { to: "/settings" | "/settings/appearance" | "/settings/currency" | "/settings/receipt-email" | "/settings/server"; label: string; icon: IconName };

const SECTIONS: Section[] = [
  { to: "/settings", label: "Account", icon: "person-add" },
  { to: "/settings/appearance", label: "Appearance", icon: "sunny" },
  { to: "/settings/currency", label: "Currency", icon: "cash" },
  { to: "/settings/server", label: "Server", icon: "server" },
];

/** Shown only when the server accepts emailed receipts (MAZ-184). */
const RECEIPT_EMAIL: Section = { to: "/settings/receipt-email", label: "Receipt email", icon: "receipt" };

/**
 * Section list beside a detail pane on wide windows. On phones the list is the `/settings` page
 * and each section is its own page with a back link, so browser Back returns to the list.
 */
export function SettingsLayout() {
  const atIndex = useRouterState({ select: (state) => state.location.pathname.replace(/\/$/, "") === "/settings" });
  const { enabled } = useInboxStatus();
  const sections = enabled ? [...SECTIONS.slice(0, 3), RECEIPT_EMAIL, ...SECTIONS.slice(3)] : SECTIONS;
  return (
    <div className={cx("settings", atIndex ? "settings--index" : "settings--section")}>
      <nav aria-label="Settings sections" className="settings__nav">
        <ul>
          {sections.map((section) => (
            <li key={section.to}>
              <Link to={section.to} className="settings__link" activeOptions={{ exact: true, includeSearch: false }}>
                <Icon name={section.icon} size={18} />
                {section.label}
                <Icon name="chevron-forward" size={14} />
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="settings__pane">
        {atIndex ? null : (
          <Link to="/settings" className="settings__back">
            <Icon name="chevron-back" size={16} weight={48} />
            All settings
          </Link>
        )}
        <Outlet />
      </div>
    </div>
  );
}
