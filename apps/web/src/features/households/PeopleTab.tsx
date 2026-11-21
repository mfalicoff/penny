import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import { archiveHousehold, createInvite, forgetHousehold, leaveHousehold, refreshHousehold, removeMember, renameHousehold } from "../../api/households";
import type { HouseholdMember, Invite, MonthRecap } from "../../api/schemas";
import { useAccountEmail } from "../../auth/account";
import { Avatar, Button, Card } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { Dialog } from "../../design/ModalDialog";
import { SaveErrorBanner, useToast } from "../../design/states";
import type { HouseholdView } from "./context";
import { describeSharedError } from "./errors";
import type { MoreItem } from "./GroupTools";
import { groupListPath } from "./links";
import { dayLabel, isCurrent, localDate, monthLabel, shortDate } from "./model";

type Pending = { kind: "remove"; member: HouseholdMember } | { kind: "pick" } | { kind: "leave" } | { kind: "archive" } | { kind: "rename" } | null;

/**
 * The creator's and members' less frequent actions: rename (or Edit trip), remove someone, archive
 * and leave. The cards keep them in the navigation bar's … menu, so a page lists `items` there
 * and renders `dialogs`; the server still decides who may do what.
 */
export function useManageActions(view: HouseholdView, recap: MonthRecap | undefined, onEditTrip?: () => void): { items: MoreItem[]; dialogs: ReactNode; note: string } {
  const [pending, setPending] = useState<Pending>(null);
  const current = view.detail.members.filter(isCurrent);
  const trip = Boolean(view.detail.household.trip);
  const alone = current.length === 1;
  const removable = view.canWrite && view.creator ? current.filter((member) => member.userId !== view.who.meId) : [];
  const items: MoreItem[] = [];
  if (view.canWrite && view.creator) {
    items.push(onEditTrip ? { label: "Edit trip", icon: "create", onSelect: onEditTrip } : { label: "Rename", icon: "create", onSelect: () => { setPending({ kind: "rename" }); } });
    if (removable[0]) {
      const only = removable.length === 1 ? removable[0] : undefined;
      items.push({ label: "Remove someone", icon: "trash", onSelect: () => { setPending(only ? { kind: "remove", member: only } : { kind: "pick" }); } });
    }
    items.push({ label: `Archive ${trip ? "trip" : "household"}`, icon: "trash", onSelect: () => { setPending({ kind: "archive" }); } });
  }
  if (view.canWrite && (!view.creator || alone)) items.push({ label: `Leave ${trip ? "trip" : "household"}`, icon: "log-out", onSelect: () => { setPending({ kind: "leave" }); } });
  const close = () => { setPending(null); };
  const dialogs = (
    <>
      {pending?.kind === "pick" ? <PickMemberDialog members={removable} onPick={(member) => { setPending({ kind: "remove", member }); }} onClose={close} /> : null}
      {pending?.kind === "remove" ? <RemoveDialog view={view} member={pending.member} onClose={close} /> : null}
      {pending?.kind === "leave" ? <LeaveDialog view={view} onClose={close} /> : null}
      {pending?.kind === "archive" ? <ArchiveDialog view={view} recap={recap} onClose={close} /> : null}
      {pending?.kind === "rename" ? <RenameDialog view={view} onClose={close} /> : null}
    </>
  );
  const note =
    view.creator && !alone
      ? "Only the creator invites, removes members, renames and archives. The creator can leave once everyone else has left."
      : "Leaving, removal and archiving need every month to be settled first: months don't offset each other.";
  return { items, dialogs, note };
}

/**
 * People (card `iphone-shared-people`): the members with their role, the invite code for the
 * creator and how splits treat new members, then former members. On phones and tablets the
 * page's … menu holds Manage (`useManageActions`); from 1100px, where the `web-household` header
 * has no … menu, it's a card here (`manage`).
 */
export function PeopleTab({ view, recap, onEditTrip, manage = true }: { view: HouseholdView; recap: MonthRecap | undefined; onEditTrip?: () => void; manage?: boolean }) {
  const { household, members } = view.detail;
  const current = members.filter(isCurrent);
  const former = members.filter((member) => !isCurrent(member));
  const trip = Boolean(household.trip);
  const actions = useManageActions(view, recap, onEditTrip);
  const membersId = useId();
  const inviteId = useId();
  const formerId = useId();

  return (
    <div className="household-columns">
      <div className="page">
        <section className="shared-group" aria-labelledby={membersId}>
          <div className="shared-group__head">
            <h2 id={membersId}>{`${String(current.length)} ${current.length === 1 ? "member" : "members"}`}</h2>
          </div>
          <ul className="shared-group__rows" aria-label="Members">
            {current.map((member) => (
              <li key={member.userId} className="row">
                <Avatar name={member.email} size={36} />
                <span className="row__main">
                  <span className="row__title">{member.userId === view.who.meId ? `${member.email} (you)` : member.email}</span>
                  <span className="row__meta">
                    {member.userId === household.creatorId ? "Created" : "Joined"} {joinedLabel(member)}
                  </span>
                </span>
                <span className="member-role">{member.userId === household.creatorId ? "Creator" : "Member"}</span>
              </li>
            ))}
          </ul>
        </section>
        {view.canWrite && view.creator ? (
          <section className="shared-group" aria-labelledby={inviteId}>
            <div className="shared-group__head">
              <h2 id={inviteId}>Invite someone</h2>
            </div>
            <InviteCard view={view} />
          </section>
        ) : null}
        <p className="shared-note">
          Everyone uses {household.currency}. New members are included in {trip ? "trip" : "equal"} splits from the day they join; earlier expenses don't change.
        </p>
        {former.length ? (
          <section className="shared-group" aria-labelledby={formerId}>
            <div className="shared-group__head">
              <h2 id={formerId}>Former members</h2>
            </div>
            <ul className="shared-group__rows" aria-label="Former members">
              {former.map((member) => (
                <li key={member.userId} className="row">
                  <Avatar name={member.email} size={36} />
                  <span className="row__main">
                    <span className="row__title">{member.email}</span>
                    <span className="row__meta">Left {member.leftAt ? shortDate(localDate(new Date(member.leftAt))) : ""}. Their past expenses stay.</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
      {manage && actions.items.length ? (
        <div className="page">
          <Card title="Manage">
            <div className="shared-actions">
              {actions.items.map((item) => (
                <Button key={item.label} variant={item.icon === "create" ? "secondary" : "danger-quiet"} onClick={item.onSelect}>
                  {item.label}
                </Button>
              ))}
            </div>
            <p className="note">{actions.note}</p>
          </Card>
        </div>
      ) : null}
      {actions.dialogs}
    </div>
  );
}

/** "Sep 2", as on the card; with the year when it isn't this year's. */
function joinedLabel(member: HouseholdMember): string {
  const day = member.joinedOn ?? localDate(new Date(member.joinedAt));
  return day.slice(0, 4) === localDate().slice(0, 4) ? shortDate(day) : dayLabel(day, true).replace(/^\w+, /, "");
}

/** Groups the 10-character code for reading aloud and typing: "7F3A9 C01B2". */
export const formatInviteCode = (code: string) => `${code.slice(0, 5)} ${code.slice(5)}`;

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
function InviteCard({ view }: { view: HouseholdView }) {
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
            <p className="invite-code__hint">Create a code when the person is ready. It works for 10 minutes, and a new code replaces the old one.</p>
          )}
          <div className="invite-code__actions">
            <Button variant="primary" icon="person-add" busy={create.isPending} onClick={() => { create.mutate(); }}>
              {expired ? "Create a new code" : "Create invite code"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function ConfirmDialog({
  title,
  description,
  confirm,
  busy,
  error,
  onConfirm,
  onClose,
  children,
}: {
  title: string;
  description: string;
  confirm: string;
  busy: boolean;
  error: unknown;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <Dialog
      title={title}
      description={description}
      onClose={onClose}
      actions={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" busy={busy} onClick={onConfirm}>
            {busy ? "Working…" : confirm}
          </Button>
        </>
      }
    >
      {error ? <SaveErrorBanner message={describeSharedError(error).message} /> : null}
      {children}
    </Dialog>
  );
}

function RemoveDialog({ view, member, onClose }: { view: HouseholdView; member: HouseholdMember; onClose: () => void }) {
  const email = useAccountEmail();
  const queryClient = useQueryClient();
  const toast = useToast();
  const remove = useMutation({
    mutationKey: ["households", "remove"],
    mutationFn: () => removeMember(view.householdId, member.userId),
    onSuccess: async () => {
      await refreshHousehold(queryClient, email, view.householdId);
      toast.show({ title: `${member.email} was removed`, detail: "Their past expenses stay in the household." });
      onClose();
    },
  });
  return (
    <ConfirmDialog
      title={`Remove ${member.email}?`}
      description="They leave future expenses. Their past expenses and history stay. They must be settled in every month first."
      confirm="Remove member"
      busy={remove.isPending}
      error={remove.error}
      onConfirm={() => { remove.mutate(); }}
      onClose={onClose}
    />
  );
}

function LeaveDialog({ view, onClose }: { view: HouseholdView; onClose: () => void }) {
  const email = useAccountEmail();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const leave = useMutation({
    mutationKey: ["households", "leave"],
    mutationFn: () => leaveHousehold(view.householdId),
    onSuccess: async () => {
      await forgetHousehold(queryClient, email, view.householdId);
      toast.show({ title: `You left ${view.detail.household.name}`, detail: "Your past shares stay in your history." });
      onClose();
      void navigate({ to: groupListPath(view.route) });
    },
  });
  return (
    <ConfirmDialog
      title={`Leave ${view.detail.household.name}?`}
      description="You stop being included in new expenses. Your past shares stay in your reports and history. You must be settled in every month first."
      confirm="Leave"
      busy={leave.isPending}
      error={leave.error}
      onConfirm={() => { leave.mutate(); }}
      onClose={onClose}
    />
  );
}

/** Archive (specimen `archive`): final, and only once every member is settled in every month. */
function ArchiveDialog({ view, recap, onClose }: { view: HouseholdView; recap: MonthRecap | undefined; onClose: () => void }) {
  const email = useAccountEmail();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const archive = useMutation({
    mutationKey: ["households", "archive"],
    mutationFn: () => archiveHousehold(view.householdId),
    onSuccess: async () => {
      await forgetHousehold(queryClient, email, view.householdId);
      toast.show({ title: `${view.detail.household.name} archived`, detail: "Its history stays in members' reports." });
      onClose();
      void navigate({ to: groupListPath(view.route) });
    },
    onError: () => void refreshHousehold(queryClient, email, view.householdId),
  });
  const unsettled = recap ? [...recap.overdueMonths, ...(recap.suggestions.length && !recap.overdueMonths.includes(recap.month) ? [recap.month] : [])] : [];
  return (
    <ConfirmDialog
      title={`Archive ${view.detail.household.name}?`}
      description="Archiving is final: nobody can add, change or settle anything afterwards, and invites stop working. Members can still read its history, and their shares stay in their reports."
      confirm="Archive"
      busy={archive.isPending}
      error={archive.error}
      onConfirm={() => { archive.mutate(); }}
      onClose={onClose}
    >
      {unsettled.length ? (
        <p className="form-error">Still unsettled: {unsettled.map((month) => monthLabel(month)).join(", ")}. Every month must be settled before archiving.</p>
      ) : (
        <p className="note">Every member must be settled in every month. Penny checks this when you archive.</p>
      )}
    </ConfirmDialog>
  );
}

function RenameDialog({ view, onClose }: { view: HouseholdView; onClose: () => void }) {
  const email = useAccountEmail();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(view.detail.household.name);
  const [invalid, setInvalid] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const errorId = useId();
  const rename = useMutation({
    mutationKey: ["households", "rename"],
    mutationFn: (next: string) => renameHousehold(view.householdId, next),
    onSuccess: async ({ household }) => {
      await refreshHousehold(queryClient, email, view.householdId);
      toast.show({ title: `Renamed to ${household.name}` });
      onClose();
    },
  });
  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 80) {
      setInvalid(true);
      inputRef.current?.focus();
      return;
    }
    rename.mutate(trimmed);
  }
  return (
    <Dialog title="Rename household" onClose={onClose} initialFocus={inputRef}>
      <form className="form" onSubmit={onSubmit} noValidate>
        {rename.isError ? <SaveErrorBanner message={describeSharedError(rename.error).message} /> : null}
        <div className="form-field">
          <label htmlFor={inputId}>Name</label>
          <input
            id={inputId}
            ref={inputRef}
            value={name}
            maxLength={80}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? errorId : undefined}
            onChange={(event) => { setName(event.currentTarget.value); }}
          />
          {invalid ? (
            <span id={errorId} className="form-error">
              Enter a name of up to 80 characters.
            </span>
          ) : null}
        </div>
        <div className="form-actions">
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" busy={rename.isPending}>
            Save name
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Which member to remove, when there's more than one; the usual confirmation follows. */
function PickMemberDialog({ members, onPick, onClose }: { members: HouseholdMember[]; onPick: (member: HouseholdMember) => void; onClose: () => void }) {
  return (
    <Dialog title="Remove someone" description="Choose who to remove. You'll confirm next, and their past expenses stay." onClose={onClose}>
      <ul className="row-list" aria-label="Members you can remove">
        {members.map((member) => (
          <li key={member.userId}>
            <button type="button" className="row" onClick={() => { onPick(member); }}>
              <Avatar name={member.email} size={32} />
              <span className="row__title">{member.email}</span>
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
