import { useOnline } from "../../design/states";
import { Icon } from "../../design/Icon";

/**
 * Shared data is online-only (it is never kept in the offline store). While the browser is
 * offline, say so next to the shared screens, under the shell's general offline banner.
 */
export function OnlineNotice() {
  const online = useOnline();
  if (online) return null;
  return (
    <p className="note" role="status">
      <Icon name="cloud-offline" size={14} /> Shared households need a connection. You can read what's already loaded; changes can't be sent until you're back online, and
      anything you type stays in its form.
    </p>
  );
}
