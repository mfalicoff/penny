import type { Transaction } from "@domain/ledger.ts";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useId, useRef, useState, type ReactNode } from "react";
import { ApiError } from "../../api/client";
import { expenseQuery, householdsQuery } from "../../api/households";
import type { ReceiptInboxFile, ReceiptInboxItem, SharedExpense } from "../../api/schemas";
import { searchTransactionsQuery } from "../../api/search";
import { useAccountEmail } from "../../auth/account";
import { Button, cx } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { tileStyle } from "../../design/categoryTint";
import { Dialog } from "../../design/ModalDialog";
import { formatCents, Money } from "../../design/Money";
import { Banner, LoadingState, useOnline, useToast } from "../../design/states";
import { categoryIcon } from "../entries/model";
import { useLedgerWriter } from "../entries/writer";
import { describeSharedError } from "../households/errors";
import { ReceiptPreviewDialog } from "../receipts/ReceiptPreviewDialog";
import { afterAttach, attachPersonal, attachShared, latestExpense, sharedReceiptId } from "./attach";
import {
  asReceipt,
  ATTACHED_TOAST_MS,
  dayText,
  fileDetail,
  fileLabel,
  openFiles,
  personalCandidates,
  preselectFile,
  receivedDay,
  searchCandidates,
  sharedCandidates,
  sharedHits,
  spokenDay,
  suggestionRange,
  suggestions,
  type AttachCandidate,
} from "./model";
import { ReceiptThumb } from "./ReceiptThumb";

type Step = "file" | "entry" | "confirm";

export const NOT_VERIFIED_WARNING = "Penny couldn't verify who sent this email. Check the receipt before attaching it.";
export const sharedNote = (household: string) => `Members of ${household} will be able to see this receipt.`;
export const replaceNote = (name: string) => `This replaces ${name}. The current receipt stays in Penny and can be attached again.`;

/**
 * The attach sheet (MAZ-184, card `receipt-attach-sheet`): which file (skipped for one file),
 * which entry (Suggested by date, or Search), then a confirm step that shows the file and the
 * entry together with who will see it, what it replaces and whether the sender was verified.
 * Nothing is linked until Attach. Expenses only.
 */
export function AttachSheet({ item, file: chosenFile, onClose, onDone }: { item: ReceiptInboxItem; file?: ReceiptInboxFile; onClose: () => void; onDone: () => void }) {
  const files = openFiles(item);
  const [file, setFile] = useState<ReceiptInboxFile | undefined>(chosenFile ?? preselectFile(item));
  const [step, setStep] = useState<Step>(chosenFile || files.length <= 1 ? "entry" : "file");
  const [target, setTarget] = useState<AttachCandidate | null>(null);
  const [preview, setPreview] = useState(false);
  const online = useOnline();

  if (!file) {
    return (
      <Dialog title="Attach receipt" description="Every file of this email is already attached." onClose={onClose} actions={<Button onClick={onClose}>Close</Button>} />
    );
  }

  return (
    <>
      {step === "file" ? (
        <FileStep
          files={files}
          value={file}
          onChange={setFile}
          onPreview={() => {
            setPreview(true);
          }}
          onClose={onClose}
          onNext={() => {
            setStep("entry");
          }}
        />
      ) : null}
      {step === "entry" ? (
        <EntryStep
          item={item}
          file={file}
          onClose={onClose}
          {...(files.length > 1 && !chosenFile ? { onBack: () => { setStep("file"); } } : {})}
          onChoose={(candidate) => {
            setTarget(candidate);
            setStep("confirm");
          }}
        />
      ) : null}
      {step === "confirm" && target ? (
        <ConfirmStep
          item={item}
          file={file}
          target={target}
          online={online}
          onPreview={() => {
            setPreview(true);
          }}
          onBack={() => {
            setStep("entry");
          }}
          onClose={onClose}
          onDone={onDone}
        />
      ) : null}
      {preview ? (
        <ReceiptPreviewDialog
          receipt={asReceipt(file)}
          onClose={() => {
            setPreview(false);
          }}
        />
      ) : null}
    </>
  );
}

function FileStep({
  files,
  value,
  onChange,
  onPreview,
  onClose,
  onNext,
}: {
  files: ReceiptInboxFile[];
  value: ReceiptInboxFile;
  onChange: (file: ReceiptInboxFile) => void;
  onPreview: () => void;
  onClose: () => void;
  onNext: () => void;
}) {
  const name = useId();
  return (
    <Dialog
      title="Which file?"
      description="Choose the receipt to attach. Usually it's the merchant's invoice rather than the email itself."
      onClose={onClose}
      actions={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onNext}>
            Next
          </Button>
        </>
      }
    >
      <fieldset className="choices choices--list inbox-files">
        <legend className="visually-hidden">File to attach</legend>
        <div className="choices__options">
          {files.map((file) => (
            <label key={file.receiptId} className={cx("choice", file.receiptId === value.receiptId && "choice--on")}>
              <input
                type="radio"
                name={name}
                value={file.receiptId}
                checked={file.receiptId === value.receiptId}
                onChange={() => {
                  onChange(file);
                }}
              />
              <span className="choice__label">{fileLabel(file)}</span>
              <span className="choice__desc">{fileDetail(file)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <Button variant="quiet" icon="document-text" onClick={onPreview} aria-label={`Preview ${fileLabel(value)}`}>
        Preview
      </Button>
    </Dialog>
  );
}

function EntryStep({ item, file, onClose, onBack, onChoose }: { item: ReceiptInboxItem; file: ReceiptInboxFile; onClose: () => void; onBack?: () => void; onChoose: (candidate: AttachCandidate) => void }) {
  const email = useAccountEmail();
  const writer = useLedgerWriter();
  const day = receivedDay(item.receivedAt);
  const range = suggestionRange(day);
  const searchId = useId();
  const [text, setText] = useState("");
  const query = text.trim();
  const households = useQuery(householdsQuery(email));
  const memberOf = new Set((households.data ?? []).map((household) => household.id));
  const nearby = useInfiniteQuery(searchTransactionsQuery(email, { ...range, kind: "expense", source: "shared", sort: "date-desc" }));
  const found = useInfiniteQuery({ ...searchTransactionsQuery(email, { query, kind: "expense", source: "all" }), enabled: query.length >= 2 });

  const personal = writer.ledger ? personalCandidates(writer.ledger) : [];
  const shared = sharedHits(nearby.data?.pages.flatMap((page) => page.items) ?? []);
  const suggested = suggestions([...personal, ...sharedCandidates(shared, memberOf)], day);

  const results = query.length >= 2 && found.data ? searchCandidates(found.data.pages.flatMap((page) => page.items), personal, memberOf) : [];

  const loadingSuggestions = !writer.ledger || nearby.isPending;
  return (
    <Dialog
      title="Attach to…"
      description={`${fileLabel(file)} from ${dayText(day)}. Choose the expense it belongs to.`}
      onClose={onClose}
      wide
      actions={
        <>
          {onBack ? (
            <Button variant="quiet" icon="chevron-back" onClick={onBack}>
              Back
            </Button>
          ) : null}
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      <section className="inbox-pick" aria-labelledby={`${searchId}-suggested`}>
        <h3 id={`${searchId}-suggested`} className="inbox-pick__heading">
          Suggested
        </h3>
        {loadingSuggestions ? (
          <LoadingState label="Finding expenses near that date…" />
        ) : suggested.length ? (
          <CandidateList candidates={suggested} onChoose={onChoose} label="Suggested expenses" />
        ) : (
          <p className="note">No expense without a receipt within a week of {dayText(day)}. Search for one below.</p>
        )}
      </section>
      <section className="inbox-pick" aria-labelledby={`${searchId}-search`}>
        <h3 id={`${searchId}-search`} className="inbox-pick__heading">
          Search
        </h3>
        <div className="form-field">
          <label htmlFor={searchId}>Search expenses</label>
          <input
            id={searchId}
            type="search"
            autoComplete="off"
            maxLength={200}
            value={text}
            onChange={(event) => {
              setText(event.currentTarget.value);
            }}
          />
        </div>
        {query.length >= 2 ? (
          found.isPending ? (
            <LoadingState label="Searching…" />
          ) : found.isError ? (
            <p className="note" role="status">
              Penny couldn't search right now. Check your connection and try again.
            </p>
          ) : results.length ? (
            <CandidateList candidates={results} onChoose={onChoose} label="Matching expenses" />
          ) : (
            <p className="note" role="status">
              No expenses match “{query}”.
            </p>
          )
        ) : null}
      </section>
    </Dialog>
  );
}

/** "$4.50 · 12 Nov · Flat 4B" under a candidate's title. */
function candidateMeta(candidate: AttachCandidate): string {
  const parts = [dayText(candidate.date)];
  if (candidate.source === "shared") parts.push(`Shared · ${candidate.householdName}`);
  else parts.push("Personal");
  if (candidate.receipt) parts.push("Has a receipt");
  return parts.join(" · ");
}

function CandidateList({ candidates, onChoose, label }: { candidates: AttachCandidate[]; onChoose: (candidate: AttachCandidate) => void; label: string }) {
  return (
    <ul className="results inbox-candidates" aria-label={label}>
      {candidates.map((candidate) => (
        <li key={candidate.key} className="results__row activity-row">
          <button
            type="button"
            className="activity-row__main"
            onClick={() => {
              onChoose(candidate);
            }}
          >
            <span className="category-dot" style={tileStyle(candidate.category ?? undefined)}>
              <Icon name={categoryIcon(candidate.category?.icon)} size={18} />
            </span>
            <span className="results__title">{candidate.title}</span>
            <span className="results__meta">{candidateMeta(candidate)}</span>
            <span className="results__amount">
              <Money cents={candidate.totalCents} currency={candidate.currency} />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function EntryCard({ candidate }: { candidate: AttachCandidate }) {
  return (
    <div className="inbox-entry-card">
      <span className="category-dot" style={tileStyle(candidate.category ?? undefined)}>
        <Icon name={categoryIcon(candidate.category?.icon)} size={18} />
      </span>
      <span className="inbox-entry-card__text">
        <b>{candidate.title}</b>
        <span>
          <time dateTime={candidate.date}>{dayText(candidate.date)}</time>
          {candidate.source === "shared" ? ` · Shared · ${candidate.householdName}` : " · Personal"}
          {candidate.category ? ` · ${candidate.category.name}` : ""}
        </span>
      </span>
      <Money cents={candidate.totalCents} currency={candidate.currency} />
    </div>
  );
}

interface ConfirmProps {
  item: ReceiptInboxItem;
  file: ReceiptInboxFile;
  target: AttachCandidate;
  online: boolean;
  onPreview: () => void;
  onBack: () => void;
  onClose: () => void;
  onDone: () => void;
}

function ConfirmStep(props: ConfirmProps) {
  const { target } = props;
  if (target.source === "personal") return <ConfirmPersonal {...props} target={target} />;
  return <ConfirmShared {...props} target={target} />;
}

function ConfirmFrame({
  item,
  file,
  candidate,
  replaces,
  busy,
  disabled,
  error,
  notice,
  onAttach,
  onPreview,
  onBack,
  onClose,
}: {
  item: ReceiptInboxItem;
  file: ReceiptInboxFile;
  candidate: AttachCandidate;
  replaces: string | null;
  busy: boolean;
  disabled?: string | null;
  error: string | null;
  notice?: ReactNode;
  onAttach: () => void;
  onPreview: () => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const attachRef = useRef<HTMLButtonElement>(null);
  const spoken = `Attach ${fileLabel(file)} to ${candidate.title}, ${formatCents(candidate.totalCents, candidate.currency)}, ${spokenDay(candidate.date)}`;
  return (
    <Dialog
      title="Attach receipt?"
      onClose={onClose}
      initialFocus={attachRef}
      actions={
        <>
          <Button variant="quiet" icon="chevron-back" onClick={onBack}>
            Back
          </Button>
          <Button ref={attachRef} variant="primary" busy={busy || Boolean(disabled)} aria-label={spoken} onClick={onAttach}>
            {busy ? "Attaching…" : "Attach"}
          </Button>
        </>
      }
    >
      {notice}
      {error ? (
        <Banner tone="error" title="Not attached">
          {error}
        </Banner>
      ) : null}
      <div className="inbox-confirm">
        <div className="inbox-confirm__file">
          <ReceiptThumb uri={file.uri} mime={file.mime} />
          <span className="inbox-confirm__file-text">
            <b>{fileLabel(file)}</b>
            <span>{fileDetail(file)}</span>
            <Button variant="quiet" onClick={onPreview} aria-label={`Preview ${fileLabel(file)}`}>
              Preview
            </Button>
          </span>
        </div>
        <Icon name="arrow-down" size={18} />
        <EntryCard candidate={candidate} />
      </div>
      <ul className="inbox-notes">
        {candidate.source === "shared" ? (
          <li>
            <Icon name="people" size={16} /> {sharedNote(candidate.householdName)}
          </li>
        ) : null}
        {replaces ? (
          <li>
            <Icon name="document-text" size={16} /> {replaceNote(replaces)}
          </li>
        ) : null}
        {!item.senderVerified ? (
          <li className="inbox-notes__warning">
            <Icon name="alert-circle" size={16} /> {NOT_VERIFIED_WARNING}
          </li>
        ) : null}
      </ul>
      {disabled ? (
        <p className="note" role="status">
          <Icon name="cloud-offline" size={14} /> {disabled}
        </p>
      ) : null}
    </Dialog>
  );
}

type Personal = Extract<AttachCandidate, { source: "personal" }>;
type Shared = Extract<AttachCandidate, { source: "shared" }>;

function useAttachedToast() {
  const toast = useToast();
  return (title: string, view: () => void, undo: () => Promise<void>, offline: boolean) => {
    toast.show({
      title: `Receipt attached to ${title}${/[.!?]$/.test(title) ? "" : "."}`,
      ...(offline ? { detail: "Saved on this device. It syncs when you're back online." } : {}),
      durationMs: ATTACHED_TOAST_MS,
      action: { label: "View entry", onClick: view },
      onUndo: () => {
        undo().then(
          () => {
            toast.show({ title: "Receipt removed", detail: "It's back in your inbox." });
          },
          (error: unknown) => {
            toast.show({ title: "Couldn't undo", detail: error instanceof Error ? error.message : "The receipt is still attached.", tone: "error" });
          },
        );
      },
    });
  };
}

function ConfirmPersonal({ item, file, target, onPreview, onBack, onClose, onDone }: ConfirmProps & { target: Personal }) {
  const email = useAccountEmail();
  const queryClient = useQueryClient();
  const writer = useLedgerWriter();
  const navigate = useNavigate();
  const show = useAttachedToast();
  // The entry as this browser has it now, so a save never undoes a newer edit.
  const entry: Transaction | undefined = writer.ledger?.transactions.find((candidate) => candidate.id === target.entry.id) ?? target.entry;
  const receipt = asReceipt(file);
  const attach = useMutation({
    mutationKey: ["receipt-inbox", "attach", "personal"],
    // The entry as confirmed travels with the call: after the save this component re-renders with the new link.
    mutationFn: (seen: Transaction) => attachPersonal(writer, seen.id, seen.receipt?.id ?? null, receipt),
    onSuccess: async ({ offline }, saved) => {
      const previous = saved.receipt ?? null;
      await afterAttach(queryClient, email);
      onClose();
      onDone();
      show(
        saved.title,
        () => void navigate({ to: "/transactions", search: { day: saved.date, kind: "expense" } }),
        async () => {
          await attachPersonal(writer, saved.id, receipt.id, previous);
          await afterAttach(queryClient, email);
        },
        offline,
      );
    },
  });
  return (
    <ConfirmFrame
      item={item}
      file={file}
      candidate={{ ...target, entry, title: entry.title, date: entry.date, totalCents: entry.total }}
      replaces={entry.receipt && entry.receipt.id !== receipt.id ? entry.receipt.name || "the current receipt" : null}
      busy={attach.isPending}
      disabled={writer.save ? null : writer.unavailable}
      error={attach.isError ? (attach.error instanceof Error ? attach.error.message : "The receipt couldn't be attached.") : null}
      onAttach={() => {
        attach.mutate(entry);
      }}
      onPreview={onPreview}
      onBack={onBack}
      onClose={onClose}
    />
  );
}

function ConfirmShared({ item, file, target, online, onPreview, onBack, onClose, onDone }: ConfirmProps & { target: Shared }) {
  const email = useAccountEmail();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const show = useAttachedToast();
  const [changed, setChanged] = useState(false);
  const expense = useQuery({ ...expenseQuery(email, target.householdId, target.expenseId), staleTime: 0 });
  const attach = useMutation({
    mutationKey: ["receipt-inbox", "attach", "shared"],
    mutationFn: (current: SharedExpense) => attachShared(target.householdId, current, file.receiptId),
    onSuccess: async (saved, current) => {
      const previous = sharedReceiptId(current);
      setChanged(false);
      await afterAttach(queryClient, email, target.householdId);
      onClose();
      onDone();
      show(
        saved.title,
        () => void navigate({ to: "/households/$id/expenses/$expenseId", params: { id: target.householdId, expenseId: saved.id } }),
        async () => {
          const latest = await latestExpense(queryClient, email, target.householdId, saved.id);
          await attachShared(target.householdId, latest, previous);
          await afterAttach(queryClient, email, target.householdId);
        },
        false,
      );
    },
    onError: async (error) => {
      // Someone changed the expense meanwhile: reload it and ask again with the new values.
      if (error instanceof ApiError && error.status === 409) {
        setChanged(true);
        await expense.refetch();
      }
    },
  });

  if (expense.isPending) {
    return (
      <Dialog title="Attach receipt?" onClose={onClose}>
        <LoadingState label="Loading the expense…" />
      </Dialog>
    );
  }
  if (expense.isError) {
    return (
      <Dialog
        title="Attach receipt?"
        onClose={onClose}
        actions={
          <>
            <Button variant="quiet" icon="chevron-back" onClick={onBack}>
              Back
            </Button>
            <Button onClick={() => void expense.refetch()}>Try again</Button>
          </>
        }
      >
        <Banner tone="error" title="Penny couldn't load this expense">
          {describeSharedError(expense.error).message}
        </Banner>
      </Dialog>
    );
  }
  const current = expense.data;
  const linked = current.receipt ?? null;
  const conflict = attach.isError && attach.error instanceof ApiError && attach.error.status === 409;
  return (
    <ConfirmFrame
      item={item}
      file={file}
      candidate={{ ...target, title: current.title, date: current.date, totalCents: current.totalCents, category: current.category }}
      replaces={linked && linked.id !== file.receiptId ? linked.name || "the current receipt" : !linked && current.receiptId && current.receiptId !== file.receiptId ? "the current receipt" : null}
      busy={attach.isPending}
      disabled={online ? null : "Shared expenses need a connection. Connect to attach this receipt."}
      error={attach.isError && !conflict ? describeSharedError(attach.error).message : null}
      notice={
        changed ? (
          <Banner tone="info" title="This expense just changed">
            Someone updated it, so Penny reloaded it. Check it, then attach again.
          </Banner>
        ) : null
      }
      onAttach={() => {
        attach.mutate(current);
      }}
      onPreview={onPreview}
      onBack={onBack}
      onClose={onClose}
    />
  );
}

