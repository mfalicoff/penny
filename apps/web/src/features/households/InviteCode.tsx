import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { createInvite } from "../../api/households";
import type { Invite } from "../../api/schemas";
import { Button } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { SaveErrorBanner } from "../../design/states";
import type { HouseholdView } from "./context";
import { describeSharedError } from "./errors";

/** Groups the 10-character code for reading aloud and typing, as `iphone-invite` draws it: "7F3A 9C01 B2". */
export const formatInviteCode = (code: string) => `${code.slice(0, 4)} ${code.slice(4, 8)} ${code.slice(8)}`;

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => { setNow(Date.now()); }, 1000);
    return () => { window.clearInterval(timer); };
  }, [active]);
  return now;
}

/**
 * Invite someone: a code that works for 10 minutes and admits anyone who has it until it expires
 * or is replaced. The card's code, amber countdown and Copy; the web has no share sheet (MAZ-229).
 */
export function InviteCard({ view, onEmail }: { view: HouseholdView; onEmail?: (() => void) | undefined }) {
  const [invite, setInvite] = useState<Invite | null>(null);
  const [copied, setCopied] = useState(false);
  const now = useNow(invite !== null);
  const create = useMutation({
    mutationKey: ["households", "invite"],
    mutationFn: () => createInvite(view.householdId),
    onSuccess: (next) => {
      setInvite(next);
      setCopied(false);
    },
  });
  const remaining = invite ? Math.max(0, invite.expiresAt - now) : 0;
  const expired = invite !== null && remaining === 0;
  const clock = `${String(Math.floor(remaining / 60_000))}:${String(Math.floor((remaining % 60_000) / 1000)).padStart(2, "0")}`;

  return (
    <div className="invite-code">
      {create.isError ? <SaveErrorBanner message={describeSharedError(create.error).message} /> : null}
      {invite && !expired ? (
        <>
          <span className="invite-code__hint">They enter this code in Shared → Join</span>
          <span className="invite-code__value" aria-label={`Invite code ${invite.code.split("").join(" ")}`}>
            {formatInviteCode(invite.code)}
          </span>
          <span className="invite-code__expires">
            <Icon name="time" size={14} />
            Expires in {clock}
          </span>
          <div className="invite-code__actions">
            <Button
              icon="copy"
              onClick={() => {
                void navigator.clipboard
                  .writeText(invite.code)
                  .then(() => { setCopied(true); })
                  .catch(() => { setCopied(false); });
              }}
            >
              Copy
            </Button>
          </div>
          <span role="status" className="muted">
            {copied ? "Copied" : ""}
          </span>
        </>
      ) : (
        <>
          {expired ? (
            <p role="status" className="invite-code__hint">
              That code expired. Create a new one when the person is ready to join.
            </p>
          ) : (
            <p className="invite-code__hint">
              {onEmail
                ? "Email them an invitation, or create a code when the person is ready. A code works for 10 minutes, and a new code replaces the old one."
                : "Create a code when the person is ready. It works for 10 minutes, and a new code replaces the old one."}
            </p>
          )}
          <div className="invite-code__actions">
            {onEmail ? (
              <Button variant="primary" icon="person-add" onClick={onEmail}>
                Invite by email
              </Button>
            ) : null}
            <Button variant={onEmail ? "secondary" : "primary"} icon={onEmail ? "key" : "person-add"} busy={create.isPending} onClick={() => { create.mutate(); }}>
              {expired ? "Create a new code" : "Create invite code"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
