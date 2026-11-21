import { useQuery } from "@tanstack/react-query";
import { oidcConfigQuery } from "../../api/auth";
import { serverInfoQuery } from "../../api/info";
import { useSyncStatus } from "../../app/shell/Sidebar";
import { cx } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { EmptyState } from "../../design/states";
import { useIsDemo } from "../../demo/demo";
import { SectionTitle } from "./SectionTitle";
import { SettingsSection } from "./SettingsSection";

/** Settings › Server & sync. */
export function ServerSettings() {
  const demo = useIsDemo();
  return (
    <>
      <SectionTitle>Server &amp; sync</SectionTitle>
      {demo ? (
        <EmptyState icon="server" title="The demo doesn't use a server">
          <p>Everything in the demo stays in this tab. Sign in to connect to your Penny server.</p>
        </EmptyState>
      ) : (
        <ServerSyncSection />
      )}
    </>
  );
}

/**
 * Server & sync (card `web-settings`): the server this page was opened from, its version and
 * sign-in methods, and when the ledger last synced. The web app always uses the server it was
 * loaded from, so the address is read-only (MAZ-132 access row): signing out is how to change it.
 */
export function ServerSyncSection() {
  const info = useQuery(serverInfoQuery);
  const oidc = useQuery(oidcConfigQuery);
  const version = info.data ? `Version ${info.data.version}` : info.isError ? "Can't reach the server" : "Checking…";
  const signIn = oidc.data?.enabled ? "Email and SSO sign-in" : "Email sign-in";
  const sync = useSyncStatus();
  // "Synced just now" reads "Just now" beside "Last synced".
  const synced = sync.text.replace(/^Synced (\S)/, (_, first: string) => first.toUpperCase());
  return (
    <SettingsSection title="Server & sync">
      <div className="setting-row">
        <div className="setting-row__body">
          <span className="setting-row__title">{window.location.host}</span>
          <span className="setting-row__desc">
            {version} · {signIn}
          </span>
        </div>
        <span className="setting-row__value">
          <Icon name="lock-closed" size={14} />
          Sign out to change servers
        </span>
      </div>
      <div className="setting-row">
        <div className="setting-row__body">
          <span className="setting-row__title">Last synced</span>
          <span className="setting-row__desc">{sync.synced ? "All changes are saved to your server." : "Changes are kept in this browser until they reach your server."}</span>
        </div>
        <span className={cx("setting-row__value", sync.synced && "setting-row__value--synced", sync.tone === "error" && "setting-row__value--error")}>
          <Icon name={sync.icon} size={16} />
          {synced}
        </span>
      </div>
    </SettingsSection>
  );
}
