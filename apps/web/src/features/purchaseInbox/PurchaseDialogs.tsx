import type { Ledger } from "@domain/ledger.ts";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { ratesQuery } from "../../api/rates";
import type { ExchangeRates, PurchaseInboxItem } from "../../api/schemas";
import { useAccountEmail } from "../../auth/account";
import { tileStyle } from "../../design/categoryTint";
import { Button } from "../../design/controls";
import { Icon, LinkIcon } from "../../design/Icon";
import { Dialog } from "../../design/ModalDialog";
import { formatCents } from "../../design/Money";
import { Banner, useToast } from "../../design/states";
import { currencySymbolFor, formatMinor } from "../entries/currency";
import { categoryIcon } from "../entries/model";
import type { LedgerWriter } from "../entries/writer";
import { asReceipt, preselectFile, senderName } from "../receiptInbox/model";
import { addAllPlan, addCountLabel, apartText, capturedText, homeAmount, purchaseDay, shortWhen, suggestCategory, whenText, type PurchaseMatch } from "./model";
import { failureText } from "./PurchaseSheet";
import { addPersonal, afterTriage, attachToEntry, discardPurchase, lookUpRate, purchaseDraft, undoDiscard, withReceipt } from "./triage";
import { useCardAccounts } from "./usePurchases";

/** The purchase's home amount at its day's rate: the cached `GET /api/rates` answer, or null until it arrives. */
export function usePurchaseRates(item: Pick<PurchaseInboxItem, "currency" | "capturedAt">, home: string): ExchangeRates | undefined {
  const email = useAccountEmail();
  const query = useQuery({ ...ratesQuery(email, home, purchaseDay(item)), enabled: item.currency !== home });
  return query.data;
}

/** "−$48.08" over "US$34.99" for a purchase in another currency; "−$6.75" otherwise. */
export function PurchaseAmount({ item, home }: { item: PurchaseInboxItem; home: string }) {
  const rates = usePurchaseRates(item, home);
  const converted = homeAmount(item, home, rates);
  const foreign = item.currency !== home;
  return (
    <span className="purchase-amount pk-num">
      <span>{converted === null ? formatMinor(-item.amount, item.currency, home, { signed: true }) : formatCents(-converted, home, { signed: true })}</span>
      {foreign && converted !== null ? <small>{formatMinor(item.amount, item.currency, home)}</small> : null}
    </span>
  );
}

/** Discard, with Undo in the toast (card `web-capture-discard`): "Purchase discarded Metro · $54.18". */
export function useDiscard(home: string) {
  const email = useAccountEmail();
  const queryClient = useQueryClient();
  const toast = useToast();
  return async (item: PurchaseInboxItem) => {
    try {
      await discardPurchase(item);
    } catch (error) {
      toast.show({ title: "Not discarded", detail: failureText(error), tone: "error" });
      return;
    }
    await afterTriage(queryClient, email);
    toast.show({
      title: "Purchase discarded",
      detail: `${item.merchant} · ${formatMinor(item.amount, item.currency, home)}`,
      icon: "trash",
      inline: true,
      onUndo: () => {
        undoDiscard(item)
          .then(() => afterTriage(queryClient, email))
          .catch((error: unknown) => {
            toast.show({ title: "Couldn't undo", detail: failureText(error), tone: "error" });
          });
      },
    });
  };
}

/**
 * "Looks like the same purchase" (card `web-capture-match`): the emailed receipts and entries
 * that may be this purchase. Attaching to a receipt adds one expense with the receipt on it;
 * attaching to an entry adds nothing new. Discard, or Add as a new expense.
 */
export function MatchDialog({
  item,
  matches,
  writer,
  onClose,
  onAddNew,
  onDiscard,
}: {
  item: PurchaseInboxItem;
  matches: PurchaseMatch[];
  writer: LedgerWriter & { ledger: Ledger };
  onClose: () => void;
  onAddNew: () => void;
  onDiscard: () => void;
}) {
  const email = useAccountEmail();
  const queryClient = useQueryClient();
  const toast = useToast();
  const cards = useCardAccounts();
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const ledger = writer.ledger;
  const home = ledger.currency;
  const firstRef = useRef<HTMLButtonElement>(null);

  async function attach(match: PurchaseMatch) {
    if (busy) return;
    setBusy(match.key);
    setFailure(null);
    try {
      if (match.kind === "entry") {
        await attachToEntry(item, match.entry.id);
        toast.show({ title: "Purchase attached", detail: `${match.entry.title} already has it. Nothing new was added.` });
      } else {
        const file = preselectFile(match.receipt);
        if (!file) throw new Error("This email has no file to attach.");
        const draft = withReceipt(purchaseDraft(ledger, item, cards), asReceipt(file));
        const rate = item.currency === home ? null : await lookUpRate(queryClient, email, home, item.currency, draft.date);
        const { offline } = await addPersonal(writer, item, draft, rate);
        toast.show({ title: "Expense added", detail: offline ? "Saved on this device. It syncs when you're back online." : `${item.merchant}, with its receipt.` });
      }
      await afterTriage(queryClient, email);
      onClose();
    } catch (error) {
      setFailure(failureText(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog
      title={item.merchant}
      onClose={onClose}
      wide
      initialFocus={firstRef}
      className="purchase-match"
      hint={
        <Button variant="danger-quiet" icon="trash" className="purchase-discard" onClick={onDiscard}>
          Discard
        </Button>
      }
      actions={<Button onClick={onAddNew}>Add as a new expense</Button>}
    >
      <div className="purchase-match__head">
        <span className="purchase-match__amount pk-num">
          <span className="purchase-match__symbol" aria-hidden="true">
            {currencySymbolFor(item.currency, home)}
          </span>
          <span className="visually-hidden">{formatMinor(item.amount, item.currency, home)}</span>
          <span aria-hidden="true">{formatMinor(item.amount, item.currency, home).replace(currencySymbolFor(item.currency, home), "")}</span>
        </span>
        <span className="purchase-sheet__source">
          <Icon name="card" size={14} />
          <span>{["Apple Pay", item.card, capturedText(item.capturedAt)].filter(Boolean).join(" · ")}</span>
        </span>
      </div>
      {failure ? (
        <Banner tone="error" title="Not attached">
          {failure}
        </Banner>
      ) : null}
      <h3 className="purchase-match__label">Looks like the same purchase</h3>
      <ul className="purchase-match__list">
        {matches.map((match, index) => (
          <li key={match.key} className="purchase-match__item">
            {match.kind === "receipt" ? (
              <>
                <span className="purchase-match__thumb" aria-hidden="true">
                  <Icon name="document-text" size={22} />
                </span>
                <span className="purchase-match__text">
                  <b>{senderName(match.receipt.from)} receipt</b>
                  <span>
                    <LinkIcon size={13} /> Emailed {whenText(match.receipt.receivedAt).replace(/^T/, "t").replace(/^Y/, "y")} · same merchant, {apartText(match.apartMs)}
                  </span>
                </span>
              </>
            ) : (
              <>
                <EntryTile ledger={ledger} categoryId={match.entry.categoryId} />
                <span className="purchase-match__text">
                  <b>
                    {match.entry.title} <span className="purchase-match__muted">· {formatCents(-match.entry.total, home, { signed: true })}</span>
                  </b>
                  <span>
                    <LinkIcon size={13} /> An entry you added {entryDayText(match.entry.date)}, same amount{match.sameCard ? " and card" : ""}
                  </span>
                </span>
              </>
            )}
            <Button
              {...(index === 0 ? { ref: firstRef, variant: "primary" as const } : {})}
              busy={busy === match.key}
              aria-label={`Attach to ${match.kind === "receipt" ? `${senderName(match.receipt.from)} receipt` : match.entry.title}`}
              onClick={() => {
                void attach(match);
              }}
            >
              <LinkIcon size={15} /> Attach to this
            </Button>
          </li>
        ))}
      </ul>
      <p className="purchase-match__note">Attaching to the receipt adds one expense with the receipt on it. Attaching to the entry adds nothing new: the purchase leaves the Inbox.</p>
    </Dialog>
  );
}

function EntryTile({ ledger, categoryId }: { ledger: Pick<Ledger, "categories">; categoryId: string }) {
  const category = ledger.categories.find((item) => item.id === categoryId);
  return (
    <span className="purchase-tile" style={tileStyle({ ...category, entryKind: "expense" })} aria-hidden="true">
      <Icon name={categoryIcon(category?.icon)} size={18} weight={40} />
    </span>
  );
}

function entryDayText(date: string): string {
  const [year = 2000, month = 1, day = 1] = date.split("-").map(Number);
  const text = whenText(new Date(year, month - 1, day, 12).getTime());
  return text.startsWith("Today") ? "today" : text.startsWith("Yesterday") ? "yesterday" : `on ${text}`;
}

/**
 * Add all (card `web-capture-add-all`): every purchase that matches nothing is added with its
 * suggested category and its card's account; a purchase that matches a receipt or an entry stays
 * for review. Emailed receipts aren't expenses, so they stay too.
 */
export function AddAllDialog({
  items,
  matched,
  writer,
  onClose,
}: {
  items: PurchaseInboxItem[];
  matched: (item: PurchaseInboxItem) => boolean;
  writer: LedgerWriter & { ledger: Ledger };
  onClose: () => void;
}) {
  const email = useAccountEmail();
  const queryClient = useQueryClient();
  const toast = useToast();
  const cards = useCardAccounts();
  const ledger = writer.ledger;
  const home = ledger.currency;
  const plan = addAllPlan(items, matched);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const totals = useAddTotals(plan.add, home);

  async function addAll() {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    let added = 0;
    const failed: string[] = [];
    for (const item of plan.add) {
      try {
        const draft = purchaseDraft(ledger, item, cards);
        const rate = item.currency === home ? null : await lookUpRate(queryClient, email, home, item.currency, draft.date);
        await addPersonal(writer, item, draft, rate);
        added++;
      } catch (error) {
        failed.push(`${item.merchant}: ${failureText(error)}`);
      }
    }
    await afterTriage(queryClient, email);
    setBusy(false);
    if (added) toast.show({ title: added === 1 ? "1 expense added" : `${String(added)} expenses added`, detail: "You can still edit them in Activity." });
    if (failed.length) setFailure(failed.join(" "));
    else onClose();
  }

  return (
    <Dialog
      title="Add all purchases"
      onClose={onClose}
      initialFocus={cancelRef}
      className="purchase-add-all"
      actions={
        <>
          <Button ref={cancelRef} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" busy={busy} disabled={plan.add.length === 0} onClick={() => void addAll()}>
            {addCountLabel(plan.add.length)}
          </Button>
        </>
      }
    >
      <p className="purchase-add-all__lead">Each purchase is added as an expense with its suggested category and its card's account. You can still edit them in Activity.</p>
      {failure ? (
        <Banner tone="error" title="Some purchases weren't added">
          {failure}
        </Banner>
      ) : null}
      <h3 className="purchase-match__label">{plan.add.length === 1 ? "1 purchase" : `${String(plan.add.length)} purchases`}</h3>
      <ul className="purchase-add-all__list">
        {plan.add.map((item) => (
          <AddAllRow key={item.id} item={item} ledger={ledger} />
        ))}
        <li className="purchase-add-all__total">
          <span>Total</span>
          <b className="pk-num">{totals === null ? "—" : formatCents(totals, home)}</b>
        </li>
      </ul>
      {plan.stay.length ? (
        <>
          <h3 className="purchase-match__label">Stays in the Inbox</h3>
          <ul className="purchase-add-all__list">
            {plan.stay.map((item) => (
              <AddAllRow key={item.id} item={item} ledger={ledger} stays />
            ))}
          </ul>
        </>
      ) : null}
      <p className="purchase-add-all__lead">Emailed receipts aren't expenses, so Add all leaves them for you to attach.</p>
    </Dialog>
  );
}

function AddAllRow({ item, ledger, stays = false }: { item: PurchaseInboxItem; ledger: Ledger; stays?: boolean }) {
  const suggestion = suggestCategory(ledger, item.merchant);
  const category = suggestion?.category;
  const line = stays ? "Matches a receipt: review it first" : [category?.name, item.card?.split(/\s/)[0], shortWhen(item.capturedAt)].filter(Boolean).join(" · ");
  return (
    <li className="purchase-add-all__row">
      <span className="purchase-tile" style={tileStyle({ ...category, entryKind: "expense" })} aria-hidden="true">
        <Icon name={categoryIcon(category?.icon)} size={16} weight={40} />
      </span>
      <span className="purchase-add-all__text">
        <b>{item.merchant}</b>
        <span>{line}</span>
      </span>
      <PurchaseAmount item={item} home={ledger.currency} />
    </li>
  );
}

/** The home total of the purchases Add all adds, once every rate is known. */
function useAddTotals(items: PurchaseInboxItem[], home: string): number | null {
  const email = useAccountEmail();
  const days = [...new Set(items.filter((item) => item.currency !== home).map(purchaseDay))];
  const results = useQueries({ queries: days.map((day) => ratesQuery(email, home, day)) });
  const answers = new Map<string, ExchangeRates | undefined>(days.map((day, index) => [day, results[index]?.data]));
  let sum = 0;
  for (const item of items) {
    const amount = homeAmount(item, home, answers.get(purchaseDay(item)));
    if (amount === null) return null;
    sum += amount;
  }
  return sum;
}

