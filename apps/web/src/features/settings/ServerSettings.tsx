import { useQuery } from "@tanstack/react-query";
import { serverInfoQuery } from "../../api/info";
import { Badge, Card } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { EmptyState, useOnline } from "../../design/states";
import { useIsDemo } from "../../demo/demo";

/**
 * Settings › Server (web card `web-settings`, "Server & sync"). The web app always talks to the
 * server it was loaded from, so the address is read-only here; the native apps' server picker and
 * app lock don't apply in a browser (MAZ-132 access row).
 */
export function ServerSettings() {
  const info = useQuery(serverInfoQuery);
  const online = useOnline();
  const demo = useIsDemo();
  if (demo) {
    return (
      <EmptyState icon="server" title="The demo doesn't use a server">
        <p>Everything in the demo stays in this tab. Sign in to connect to your Penny server.</p>
      </EmptyState>
    );
  }
  const status = !online ? (
    <Badge tone="pending" icon="cloud-offline">
      Offline
    </Badge>
  ) : info.isError ? (
    <Badge tone="danger" icon="alert-circle">
      Unreachable
    </Badge>
  ) : info.isPending ? (
    <Badge>Checking…</Badge>
  ) : (
    <Badge tone="income" icon="cloud-done">
      Connected
    </Badge>
  );
  return (
    <Card title="Server">
      <div className="setting-row">
        <div className="setting-row__body">
          <span className="setting-row__title">{window.location.host}</span>
          <span className="setting-row__desc">{info.data ? `Version ${info.data.version}` : "Version unknown"}</span>
        </div>
        {status}
      </div>
      <div className="setting-row">
        <Icon name="lock-closed" size={18} />
        <div className="setting-row__body">
          <span className="setting-row__desc">
            Penny on the web always uses the server it's opened from. To use another server, open that server's address in your browser.
          </span>
        </div>
      </div>
    </Card>
  );
}
