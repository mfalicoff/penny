import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState, type SyntheticEvent } from "react";
import { z } from "zod";
import { ApiError, hasCode } from "../../api/client";
import { emailInvitesQuery, refreshHousehold, resendEmailInvite, revokeEmailInvite, sendEmailInvite } from "../../api/households";
import { serverInfoQuery } from "../../api/info";
import type { EmailInvite, EmailInviteStatus } from "../../api/schemas";
import { useAccountEmail } from "../../auth/account";
import { Badge, Button } from "../../design/controls";
import { Icon, MailIcon, type IconName } from "../../design/Icon";
import { Dialog } from "../../design/ModalDialog";
import { Banner } from "../../design/states";
import type { HouseholdView } from "./context";
import { describeSharedError } from "./errors";
import { MoreMenu } from "./GroupTools";
import { localDate, shortDate } from "./model";
import { InviteCard } from "./InviteCode";

const addressSchema = z.email().max(254);

/** Each status in words, with a badge tone and icon that repeat it, never color alone. */
const STATUS: Record<EmailInviteStatus, { label: string; tone: "neutral" | "pending" | "income" | "danger"; icon?: IconName }> = {
  sending: { label: "Sending", tone: "neutral", icon: "time" },
  waiting: { label: "Waiting", tone: "pending" },
  expired: { label: "Expired", tone: "neutral" },
  joined: { label: "Joined", tone: "income", icon: "checkmark" },
  failed: { label: "Failed", tone: "danger", icon: "alert-circle" },
};

/** "today at 9:38", "yesterday at 18:05", or "Nov 18" (card `web-invite-email`). */
export function sentLabel(at: number, now = Date.now()): string {
  const day = localDate(new Date(at));
  const date = new Date(at);
  const time = `${String(date.getHours())}:${String(date.getMinutes()).padStart(2, "0")}`;
  if (day === localDate(new Date(now))) return `today at ${time}`;
  if (day === localDate(new Date(now - 86_400_000))) return `yesterday at ${time}`;
  return shortDate(day);
}

/** The line under the address: when it was sent and what became of it. */
export function inviteDetail(invite: EmailInvite, now = Date.now()): string {
  const sent = invite.sentAt === null ? null : `Sent ${sentLabel(invite.sentAt, now)}`;
  switch (invite.status) {
    case "sending":
      return sent ? `${sent} · sending again` : "Sending now";
    case "waiting":
      return sent ?? "Sent";
    case "expired":
      return `${sent ?? "Sent"} · link expired`;
    case "joined":
      return `${sent ?? "Sent"} · joined`;
    case "failed":
      return "Couldn't be delivered. Check the address, or share a code instead.";
  }
}

/** A failed invitation write in words: the server's own text for its rules and limits. */
function describeInviteError(error: unknown): string {
  if (error instanceof ApiError && [400, 403, 404, 409, 429].includes(error.status) && !error.is("household.not_found")) return error.message;
  return describeSharedError(error).message;
}

/**
 * Invite by email (card `web-invite-email`, MAZ-124): an address and Send invite, what Penny does
 * with it, then the invitations already sent with their status, Resend and a … menu with Revoke.
 * Share a code instead shows the 10-minute code from People in the same dialog. Only shown while
 * the server sends email; the creator manages invitations, as with codes.
 */
export function InviteEmailDialog({ view, onClose }: { view: HouseholdView; onClose: () => void }) {
  const email = useAccountEmail();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"email" | "code">("email");
  const [address, setAddress] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const ids = { email: useId(), hint: useId(), error: useId(), invited: useId() };
  const invites = useQuery({ ...emailInvitesQuery(email, view.householdId), enabled: mode === "email" });
  const name = view.detail.household.name;
  const host = typeof window === "undefined" ? "this server" : window.location.host;

  const after = async (error?: unknown) => {
    // "Doesn't send email" means the server turned email off: refresh what it offers.
    if (hasCode(error, "mail.disabled")) {
      await queryClient.invalidateQueries({ queryKey: serverInfoQuery.queryKey });
    }
    await refreshHousehold(queryClient, email, view.householdId);
  };

  const send = useMutation({
    mutationKey: ["households", "email-invite"],
    mutationFn: (to: string) => sendEmailInvite(view.householdId, to),
    onSuccess: async (invite) => {
      setAddress("");
      setFailure(null);
      setAnnouncement(`Invitation sent to ${invite.email}.`);
      await after();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 400) {
        setFieldError(error.message);
        inputRef.current?.focus();
        return;
      }
      setFailure(describeInviteError(error));
      void after(error);
    },
  });

  const resend = useMutation({
    mutationKey: ["households", "email-invite", "resend"],
    mutationFn: (invite: EmailInvite) => resendEmailInvite(view.householdId, invite.id),
    onSuccess: async (invite) => {
      setFailure(null);
      setAnnouncement(`Invitation sent again to ${invite.email}.`);
      await after();
    },
    onError: (error) => {
      setFailure(describeInviteError(error));
      void after(error);
    },
  });

  const revoke = useMutation({
    mutationKey: ["households", "email-invite", "revoke"],
    mutationFn: (invite: EmailInvite) => revokeEmailInvite(view.householdId, invite.id),
    onSuccess: async (_, invite) => {
      setFailure(null);
      setAnnouncement(`Invitation to ${invite.email} revoked. Its link no longer works.`);
      await after();
    },
    onError: (error) => {
      setFailure(describeInviteError(error));
      void after(error);
    },
  });

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (send.isPending) return;
    const to = address.trim();
    if (!addressSchema.safeParse(to).success) {
      setFieldError("Enter a valid email address.");
      inputRef.current?.focus();
      return;
    }
    setFieldError(null);
    send.mutate(to);
  }

  const footer =
    mode === "email" ? (
      <button type="button" className="invite-email__switch" onClick={() => { setMode("code"); }}>
        <Icon name="key" size={15} />
        Share a code instead
      </button>
    ) : (
      <button type="button" className="invite-email__switch" onClick={() => { setMode("email"); }}>
        <MailIcon size={15} />
        Invite by email instead
      </button>
    );

  return (
    <Dialog
      title={`Invite to ${name}`}
      onClose={onClose}
      initialFocus={inputRef}
      hint={footer}
      actions={
        <Button variant="secondary" onClick={onClose}>
          Done
        </Button>
      }
    >
      {mode === "code" ? (
        <InviteCard view={view} />
      ) : (
        <div className="invite-email">
          <form className="invite-email__form" onSubmit={onSubmit} noValidate>
            <label htmlFor={ids.email} className="invite-email__label">
              Email
            </label>
            <div className="invite-email__send">
              <input
                ref={inputRef}
                id={ids.email}
                type="email"
                inputMode="email"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={254}
                value={address}
                aria-invalid={fieldError ? true : undefined}
                aria-describedby={fieldError ? `${ids.error} ${ids.hint}` : ids.hint}
                onChange={(event) => { setAddress(event.currentTarget.value); }}
              />
              <Button type="submit" variant="primary" busy={send.isPending}>
                {send.isPending ? "Sending…" : "Send invite"}
              </Button>
            </div>
            {fieldError ? (
              <span id={ids.error} className="form-error" role="alert">
                {fieldError}
              </span>
            ) : null}
            <p id={ids.hint} className="invite-email__hint">
              Penny emails them a link to join. If they are new to Penny, the link lets them create an account on {host} first. Joining still asks them to accept.
            </p>
          </form>
          {failure ? (
            <Banner tone="error" title="Nothing was sent">
              {failure}
            </Banner>
          ) : null}
          <p className="visually-hidden" role="status">
            {announcement}
          </p>
          <section aria-labelledby={ids.invited} className="invite-email__invited">
            <h3 id={ids.invited} className="invite-email__label">
              Invited
            </h3>
            {invites.isPending ? (
              <p className="invite-email__empty" role="status">
                Loading invitations…
              </p>
            ) : invites.isError ? (
              <p className="invite-email__empty" role="alert">
                {describeInviteError(invites.error)}
              </p>
            ) : invites.data.length === 0 ? (
              <p className="invite-email__empty">Nobody yet. Invitations you send show here until they're used or revoked.</p>
            ) : (
              <ul className="invite-email__list" aria-labelledby={ids.invited}>
                {invites.data.map((invite) => (
                  <InviteRow
                    key={invite.id}
                    invite={invite}
                    busy={(resend.isPending && resend.variables.id === invite.id) || (revoke.isPending && revoke.variables.id === invite.id)}
                    onResend={() => { resend.mutate(invite); }}
                    onRevoke={() => { revoke.mutate(invite); }}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Dialog>
  );
}

function InviteRow({ invite, busy, onResend, onRevoke }: { invite: EmailInvite; busy: boolean; onResend: () => void; onRevoke: () => void }) {
  const status = STATUS[invite.status];
  const canResend = invite.status !== "joined";
  return (
    <li className="invite-row">
      <span className="invite-row__icon" aria-hidden="true">
        <MailIcon size={15} />
      </span>
      <span className="invite-row__main">
        <span className="invite-row__email">{invite.email}</span>
        <span className="invite-row__detail">{inviteDetail(invite)}</span>
      </span>
      <Badge tone={status.tone} {...(status.icon ? { icon: status.icon } : {})}>
        {status.label}
      </Badge>
      {canResend ? (
        <Button busy={busy || invite.status === "sending"} aria-label={`Resend to ${invite.email}`} onClick={onResend}>
          Resend
        </Button>
      ) : null}
      <MoreMenu label={`More for ${invite.email}`} items={[{ label: "Revoke", icon: "trash", onSelect: onRevoke }]} />
    </li>
  );
}
