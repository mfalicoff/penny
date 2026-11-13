import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import { archiveHousehold, createInvite, forgetHousehold, leaveHousehold, refreshHousehold, removeMember, renameHousehold } from "../../api/households";
import type { HouseholdMember, Invite, MonthRecap } from "../../api/schemas";
import { useAccountEmail } from "../../auth/account";
import { Avatar, Badge, Button, Card } from "../../design/controls";
import { Dialog } from "../../design/ModalDialog";
import { SaveErrorBanner, useToast } from "../../design/states";
import type { HouseholdView } from "./context";
import { describeSharedError } from "./errors";
import { groupListPath } from "./links";
import { dayLabel, isCurrent, localDate, monthLabel } from "./model";

type Pending = { kind: "remove"; member: HouseholdMember } | { kind: "leave" } | { kind: "archive" } | { kind: "rename" } | null;

/**
 * People (card `iphone-shared-people`): members, invitations and the creator's controls. The
 * server enforces who may do what; the page offers only what the viewer may do and explains the
 * settlement rule for leaving, removal and archiving.
 */
export function PeopleTab({ view, recap, onEditTrip }: { view: HouseholdView; recap: MonthRecap | undefined; onEditTrip?: () => void }) {
  const [pending, setPending] = useState<Pending>(null);
  const { household, members } = view.detail;
  const current = members.filter(isCurrent);
  const former = members.filter((member) => !isCurrent(member));
  const trip = Boolean(household.trip);
  const alone = current.length === 1;

  return (
    <div className="household-columns">
      <div className="page">
        <Card title={`${String(current.length)} ${current.length === 1 ? "member" : "members"}`}>
          <ul className="row-list" aria-label="Members">
            {current.map((member) => (
              <li key={member.userId} className="row">
                <Avatar name={member.email} size={32} />
                <span>
                  <span className="row__title">{member.userId === view.who.meId ? `${member.email} (you)` : member.email}</span>
                  <span className="row__meta" style={{ display: "block" }}>
                    {member.userId === household.creatorId ? "Created" : "Joined"} {joinedLabel(member)}
                  </span>
                </span>
                <span className="row__end">
                  <Badge>{member.userId === household.creatorId ? "Creator" : "Member"}</Badge>
                  {view.canWrite && view.creator && member.userId !== view.who.meId ? (
                    <Button variant="danger-quiet" onClick={() => { setPending({ kind: "remove", member }); }} aria-label={`Remove ${member.email}`}>
                      Remove
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
          <p className="note">
            Everyone uses {household.currency}. New members are included in {trip ? "trip" : "equal"} splits from the day they join; earlier expenses don't change.
          </p>
        </Card>
        {former.length ? (
          <Card title="Former members">
            <ul className="row-list" aria-label="Former members">
              {former.map((member) => (
                <li key={member.userId} className="row row--plain">
                  <span>
                    <span className="row__title">{member.email}</span>
                    <span className="row__meta" style={{ display: "block" }}>
                      Left {member.leftAt ? dayLabel(localDate(new Date(member.leftAt)), true) : ""}. Their past expenses stay in the household.
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
      <div className="page">
        {view.canWrite && view.creator ? <InviteCard view={view} /> : null}
        {view.canWrite ? (
          <Card title="Manage">
            <div className="shared-actions">
              {view.creator ? (
                <>
                  {onEditTrip ? <Button onClick={onEditTrip}>Edit trip</Button> : <Button onClick={() => { setPending({ kind: "rename" }); }}>Rename</Button>}
                  <Button variant="danger-quiet" onClick={() => { setPending({ kind: "archive" }); }}>
                    Archive {trip ? "trip" : "household"}
                  </Button>
                </>
              ) : null}
              {!view.creator || alone ? (
                <Button variant="danger-quiet" onClick={() => { setPending({ kind: "leave" }); }}>
                  Leave {trip ? "trip" : "household"}
                </Button>
              ) : null}
            </div>
            <p className="note">
              {view.creator && !alone
                ? "Only the creator invites, removes members, renames and archives. The creator can leave once everyone else has left."
                : "Leaving, removal and archiving need every month to be settled first: months don't offset each other."}
            </p>
          </Card>
        ) : null}
      </div>
      {pending?.kind === "remove" ? <RemoveDialog view={view} member={pending.member} onClose={() => { setPending(null); }} /> : null}
      {pending?.kind === "leave" ? <LeaveDialog view={view} onClose={() => { setPending(null); }} /> : null}
      {pending?.kind === "archive" ? <ArchiveDialog view={view} recap={recap} onClose={() => { setPending(null); }} /> : null}
      {pending?.kind === "rename" ? <RenameDialog view={view} onClose={() => { setPending(null); }} /> : null}
    </div>
  );
}

function joinedLabel(member: HouseholdMember): string {
  return dayLabel(member.joinedOn ?? localDate(new Date(member.joinedAt)), true);
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

/** Invite someone: a code that works for 10 minutes and admits anyone who has it until it expires or is replaced. */
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
    <Card title="Invite someone">
      {create.isError ? <SaveErrorBanner message={describeSharedError(create.error).message} /> : null}
      {invite && !expired ? (
        <div className="invite-code">
          <span className="muted">They enter this code in Shared › Join with a code</span>
          <span className="invite-code__value" aria-label={`Invite code ${invite.code.split("").join(" ")}`}>
            {formatInviteCode(invite.code)}
          </span>
          <span className="muted">Expires in {clock}</span>
          <div className="shared-actions">
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
            <span role="status" className="muted">
              {copied ? "Copied" : ""}
            </span>
          </div>
        </div>
      ) : (
        <>
          {expired ? (
            <p role="status" className="muted">
              That code expired. Create a new one when the person is ready to join.
            </p>
          ) : (
            <p className="muted">Create a code when the person is ready. It works for 10 minutes, and a new code replaces the old one.</p>
          )}
          <Button icon="person-add" busy={create.isPending} onClick={() => { create.mutate(); }} style={{ justifySelf: "start" }}>
            {expired ? "Create a new code" : "Create invite code"}
          </Button>
        </>
      )}
    </Card>
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
