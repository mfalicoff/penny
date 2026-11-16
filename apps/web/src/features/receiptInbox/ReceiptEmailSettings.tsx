import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState, type SyntheticEvent } from "react";
import { ApiError } from "../../api/client";
import { createReceiptAddress, receiptEmailKey, receiptEmailQuery, refreshInbox, revokeReceiptAddress, setReceiptEmail, updateReceiptEmail } from "../../api/receiptInbox";
import type { ReceiptEmail, ReceiptEmailAddress } from "../../api/schemas";
import { useAccountEmail } from "../../auth/account";
import { Button, Card } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { Dialog } from "../../design/ModalDialog";
import { Banner, EmptyState, ErrorState, LoadingState, useOnline, useToast } from "../../design/states";
import { useIsDemo } from "../../demo/demo";

export const HOW_TO = "Forward a receipt email to this address, or send a photo of a paper receipt to it. It shows up in Receipts to attach within a minute.";
export const SENDERS_HELP = "Only email that passes sender verification from these addresses reaches your inbox. If you forward receipts, add the address you forward from.";
export const ROTATE_WARNING = "Your current address stops working right away.";
export const TURN_OFF_WARNING = "Mail sent to this address will be refused. Receipts already in your inbox stay there.";

const longDate = (ms: number) => new Date(ms).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return navigator.onLine ? "Penny can't reach the server." : "You're offline. Connect, then try again.";
    if (error.status === 429) return "You've made too many new addresses today. Try again tomorrow.";
    if (error.status === 404) return "Receipt email isn't available on this server any more.";
    return error.message;
  }
  return "Something went wrong.";
}

/** A sender as the server stores it: a lowercase address or domain (`@` prefix dropped). */
export function normalizeSender(value: string): string {
  return value.trim().toLowerCase().replace(/^@/, "");
}
const looksLikeSender = (value: string) => /^([^\s@]+@)?[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value);

type Confirm = "rotate" | "off" | null;

function Problem({ message }: { message: string }) {
  return (
    <Banner tone="error" title="Nothing was changed">
      {message}
    </Banner>
  );
}

/**
 * Settings › Receipt email (MAZ-184, card `receipt-email-settings`): the private address in a
 * monospace field with Copy, its expiry with Extend, New address and Turn off (both confirmed),
 * the allowed senders list, and how to use it. With the feature off on the server this section
 * isn't listed; opened directly, it says the server doesn't offer it.
 */
export function ReceiptEmailSettings() {
  const email = useAccountEmail();
  const demo = useIsDemo();
  const settings = useQuery({ ...receiptEmailQuery(email), enabled: !demo });
  if (demo) {
    return (
      <EmptyState icon="receipt" title="The demo doesn't receive email">
        <p>Sign in to your own Penny server to get a receipt address.</p>
      </EmptyState>
    );
  }
  if (settings.isPending) return <LoadingState label="Loading receipt email…" />;
  if (settings.isError && !(settings.error instanceof ApiError && settings.error.status === 404)) {
    return (
      <ErrorState
        title="Penny couldn't load receipt email"
        onRetry={() => {
          void settings.refetch();
        }}
        retrying={settings.isFetching}
      />
    );
  }
  if (!settings.data?.enabled) {
    return (
      <EmptyState icon="receipt" title="Receipt email isn't available">
        <p>This Penny server doesn't accept emailed receipts.</p>
      </EmptyState>
    );
  }
  return <ReceiptEmailCard value={settings.data} />;
}

function ReceiptEmailCard({ value }: { value: ReceiptEmail }) {
  const email = useAccountEmail();
  const queryClient = useQueryClient();
  const toast = useToast();
  const online = useOnline();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const address = value.address;

  const onSaved = (next: ReceiptEmail) => {
    setReceiptEmail(queryClient, email, next);
  };
  const create = useMutation({
    mutationKey: ["receipt-email", "create"],
    mutationFn: createReceiptAddress,
    onSuccess: (next) => {
      onSaved(next);
      setConfirm(null);
      toast.show({ title: address ? "New address ready" : "Receipt address ready", detail: address ? "Your old address no longer works." : "Forward a receipt to it to try it out." });
    },
  });
  const extend = useMutation({
    mutationKey: ["receipt-email", "extend"],
    mutationFn: () => updateReceiptEmail({ extend: true }),
    onSuccess: (next) => {
      onSaved(next);
      toast.show({ title: "Address extended", ...(next.address ? { detail: `It now works until ${longDate(next.address.expiresAt)}.` } : {}) });
    },
  });
  const turnOff = useMutation({
    mutationKey: ["receipt-email", "off"],
    mutationFn: revokeReceiptAddress,
    onSuccess: async () => {
      setConfirm(null);
      await queryClient.invalidateQueries({ queryKey: receiptEmailKey(email) });
      await refreshInbox(queryClient, email);
      toast.show({ title: "Receipt email turned off", detail: "Receipts already in your inbox stay there." });
    },
  });
  const failed = [create, extend].find((mutation) => mutation.isError);

  return (
    <div className="settings-stack">
      <Card title="Receipt email">
        {failed && confirm === null ? <Problem message={describeError(failed.error)} /> : null}
        {address ? (
          <AddressRow address={address} online={online} extending={extend.isPending} onExtend={() => { extend.mutate(); }} />
        ) : (
          <div className="setting-row">
            <div className="setting-row__body">
              <span className="setting-row__title">Get a private address for receipts</span>
              <span className="setting-row__desc">Email receipts to Penny, then attach them to your expenses. Nothing is attached without you.</span>
            </div>
            <Button variant="primary" busy={create.isPending || !online} onClick={() => { create.mutate(); }}>
              {create.isPending ? "Creating…" : "Create address"}
            </Button>
          </div>
        )}
        <p className="setting-note">{HOW_TO}</p>
        {!online ? (
          <p className="note" role="status">
            <Icon name="cloud-offline" size={14} /> Connect to the internet to change your receipt address.
          </p>
        ) : null}
        {address ? (
          <div className="inbox-settings__actions">
            <Button busy={!online} onClick={() => { setConfirm("rotate"); }}>
              New address
            </Button>
            <Button variant="danger-quiet" busy={!online} onClick={() => { setConfirm("off"); }}>
              Turn off
            </Button>
          </div>
        ) : null}
      </Card>
      {address ? <SendersCard address={address} online={online} /> : null}
      {confirm === "rotate" ? (
        <ConfirmDialog
          title="Get a new address?"
          message={ROTATE_WARNING}
          confirmLabel="New address"
          busy={create.isPending}
          error={create.isError ? describeError(create.error) : null}
          onConfirm={() => { create.mutate(); }}
          onClose={() => { create.reset(); setConfirm(null); }}
        />
      ) : null}
      {confirm === "off" ? (
        <ConfirmDialog
          title="Turn off receipt email?"
          message={TURN_OFF_WARNING}
          confirmLabel="Turn off"
          danger
          busy={turnOff.isPending}
          error={turnOff.isError ? describeError(turnOff.error) : null}
          onConfirm={() => { turnOff.mutate(); }}
          onClose={() => { turnOff.reset(); setConfirm(null); }}
        />
      ) : null}
    </div>
  );
}

function AddressRow({ address, online, extending, onExtend }: { address: ReceiptEmailAddress; online: boolean; extending: boolean; onExtend: () => void }) {
  const fieldId = useId();
  const [copied, setCopied] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address.address);
      setCopied("Address copied.");
    } catch {
      // No clipboard access (an insecure origin or a refusal): select it for a manual copy.
      inputRef.current?.select();
      setCopied("Press Ctrl+C or ⌘C to copy the selected address.");
    }
  }

  return (
    <>
      <div className="form-field">
        <label htmlFor={fieldId}>Your receipt address</label>
        <div className="field-with-action">
          <input
            ref={inputRef}
            id={fieldId}
            className="inbox-address"
            readOnly
            value={address.address}
            spellCheck={false}
            onFocus={(event) => {
              event.currentTarget.select();
            }}
          />
          <Button icon="copy" onClick={() => void copy()}>
            Copy
          </Button>
        </div>
        <span className="visually-hidden" role="status">
          {copied}
        </span>
      </div>
      <div className="setting-row">
        <Icon name="time" size={18} />
        <div className="setting-row__body">
          <span className="setting-row__title">Works until {longDate(address.expiresAt)}</span>
          <span className="setting-row__desc">
            {address.lastReceivedAt ? `Last receipt received ${longDate(address.lastReceivedAt)}.` : "Nothing received yet."} Extend it to keep using it.
          </span>
        </div>
        <Button busy={extending || !online} onClick={onExtend}>
          {extending ? "Extending…" : "Extend"}
        </Button>
      </div>
    </>
  );
}

/** Allowed senders: an editable list. Empty means any sender (the inbox never changes the ledger by itself). */
function SendersCard({ address, online }: { address: ReceiptEmailAddress; online: boolean }) {
  const email = useAccountEmail();
  const queryClient = useQueryClient();
  const toast = useToast();
  const inputId = useId();
  const helpId = useId();
  const errorId = useId();
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState<string | null>(null);
  const save = useMutation({
    mutationKey: ["receipt-email", "senders"],
    mutationFn: (allowedSenders: string[]) => updateReceiptEmail({ allowedSenders }),
    onSuccess: (next, list) => {
      setReceiptEmail(queryClient, email, next);
      if (list.length > address.allowedSenders.length) setText("");
      toast.show({ title: list.length ? "Allowed senders saved" : "Any sender can reach your inbox" });
    },
  });

  function add(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const sender = normalizeSender(text);
    if (!looksLikeSender(sender)) {
      setInvalid("Enter an email address (you@example.com) or a domain (example.com).");
      return;
    }
    setInvalid(null);
    if (address.allowedSenders.includes(sender)) {
      setText("");
      return;
    }
    save.mutate([...address.allowedSenders, sender]);
  }

  return (
    <Card title="Allowed senders">
      <p id={helpId} className="setting-note">
        {SENDERS_HELP} {address.allowedSenders.length ? null : "Right now any sender can reach your inbox."}
      </p>
      {save.isError ? <Problem message={describeError(save.error)} /> : null}
      {address.allowedSenders.length ? (
        <ul className="inbox-senders" aria-label="Allowed senders">
          {address.allowedSenders.map((sender) => (
            <li key={sender} className="inbox-senders__row">
              <span className="inbox-senders__name">{sender}</span>
              <Button
                variant="danger-quiet"
                icon="close"
                iconOnly
                aria-label={`Remove ${sender}`}
                busy={save.isPending || !online}
                onClick={() => {
                  save.mutate(address.allowedSenders.filter((item) => item !== sender));
                }}
              />
            </li>
          ))}
        </ul>
      ) : null}
      <form className="form-field" onSubmit={add} noValidate aria-label="Add an allowed sender">
        <label htmlFor={inputId}>Address or domain</label>
        <div className="field-with-action">
          <input
            id={inputId}
            type="email"
            inputMode="email"
            autoComplete="off"
            spellCheck={false}
            placeholder="you@example.com"
            maxLength={254}
            value={text}
            aria-describedby={invalid ? `${helpId} ${errorId}` : helpId}
            {...(invalid ? { "aria-invalid": true } : {})}
            onChange={(event) => {
              setText(event.currentTarget.value);
              setInvalid(null);
            }}
          />
          <Button type="submit" icon="add" busy={save.isPending || !online || address.allowedSenders.length >= 50}>
            Add
          </Button>
        </div>
        {invalid ? (
          <span id={errorId} className="form-error">
            {invalid}
          </span>
        ) : null}
      </form>
    </Card>
  );
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      title={title}
      description={message}
      onClose={onClose}
      initialFocus={cancelRef}
      actions={
        <>
          <Button ref={cancelRef} variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={danger ? "danger" : "primary"} busy={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {error ? <Problem message={error} /> : null}
    </Dialog>
  );
}
