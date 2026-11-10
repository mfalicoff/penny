import { useQuery } from "@tanstack/react-query";
import { serverInfoQuery } from "../api/info";

/** Non-blocking server identity: the shell renders before, and without, the API. */
export function ServerStatus() {
  const info = useQuery(serverInfoQuery);
  if (info.isPending) {
    return <p className="server-status" role="status">Connecting to server…</p>;
  }
  if (info.isError) {
    return (
      <p className="server-status server-status--error" role="status">
        Server unavailable
      </p>
    );
  }
  return (
    <p className="server-status" role="status">
      Penny server <span className="pk-num">{info.data.version}</span>
    </p>
  );
}
