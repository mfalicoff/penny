import type { Ledger } from "@domain/ledger.ts";
import { useState, type KeyboardEvent } from "react";
import type { PurchaseInboxItem, ReceiptInboxItem } from "../../api/schemas";
import { tileStyle } from "../../design/categoryTint";
import { Button } from "../../design/controls";
import { Icon, LinkIcon } from "../../design/Icon";
import { categoryIcon } from "../entries/model";
import type { LedgerWriter } from "../entries/writer";
import { accountForCard, purchaseMatches, suggestCategory, whenText, type PurchaseMatch } from "./model";
import { AddAllDialog, MatchDialog, PurchaseAmount, useDiscard } from "./PurchaseDialogs";
import { PurchaseSheet } from "./PurchaseSheet";
import { useCardAccounts } from "./usePurchases";

type Open = { id: string; view: "review" | "add" } | { view: "add-all" } | null;

const OUTCOME_TEXT = { added: "Added", attached: "Attached", discarded: "Discarded" } as const;

/**
 * Purchases in the Inbox (cards `web-inbox-captured`, `web-capture-*`): each captured purchase
 * with its suggested category, card and when, its amount (converted at the day's rate when paid
 * in another currency) and "Matches a receipt" when one may be the same purchase. Review opens
 * the match suggestions when there are any, else the purchase sheet; Discard has Undo. Add all
 * adds the purchases that match nothing.
 */
export function PurchaseSection({
  items,
  done,
  receipts,
  writer,
  online,
  hasMore,
  loadingMore,
  onMore,
}: {
  items: PurchaseInboxItem[];
  done: boolean;
  receipts: ReceiptInboxItem[];
  writer: LedgerWriter;
  online: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onMore: () => void;
}) {
  const cards = useCardAccounts(items.length > 0);
  const [open, setOpen] = useState<Open>(null);
  const ledger = writer.ledger;
  const home = ledger?.currency ?? "CAD";
  const discard = useDiscard(home);
  const ready = ledger && writer.save ? (writer as LedgerWriter & { ledger: Ledger }) : null;
  const matchesOf = (item: PurchaseInboxItem): PurchaseMatch[] =>
    done ? [] : purchaseMatches(item, { ledger, receipts, account: ledger ? accountForCard(cards, item.card, ledger) : null });
  const current = open && open.view !== "add-all" ? items.find((item) => item.id === open.id) : undefined;
  const close = () => {
    setOpen(null);
  };

  if (items.length === 0) return null;
  return (
    <section className="inbox-section" aria-labelledby="inbox-purchases">
      <div className="inbox-section__head">
        <h2 id="inbox-purchases" className="inbox-section__title">
          Purchases
        </h2>
        {!done && ready ? (
          <Button
            icon="checkmark"
            busy={!online}
            onClick={() => {
              setOpen({ view: "add-all" });
            }}
          >
            Add all
          </Button>
        ) : null}
      </div>
      <ul className="inbox-panel purchase-list" aria-label={done ? "Purchases handled" : "Purchases to review"}>
        {items.map((item) => {
          const matches = matchesOf(item);
          return (
            <PurchaseRow
              key={item.id}
              item={item}
              ledger={ledger}
              home={home}
              matches={matches}
              actions={!done && Boolean(ready) && online}
              onReview={() => {
                setOpen({ id: item.id, view: matches.length ? "review" : "add" });
              }}
              onDiscard={() => {
                void discard(item);
              }}
            />
          );
        })}
      </ul>
      {hasMore ? (
        <Button busy={loadingMore} onClick={onMore}>
          {loadingMore ? "Loading…" : "Show older"}
        </Button>
      ) : null}
      {current && ready && open?.view === "review" ? (
        <MatchDialog
          item={current}
          matches={matchesOf(current)}
          writer={ready}
          onClose={close}
          onAddNew={() => {
            setOpen({ id: current.id, view: "add" });
          }}
          onDiscard={() => {
            close();
            void discard(current);
          }}
        />
      ) : null}
      {current && ready && open?.view === "add" ? (
        <PurchaseSheet
          item={current}
          writer={ready}
          onClose={close}
          onDiscard={() => {
            close();
            void discard(current);
          }}
        />
      ) : null}
      {ready && open?.view === "add-all" ? <AddAllDialog items={items} matched={(item) => matchesOf(item).length > 0} writer={ready} onClose={close} /> : null}
    </section>
  );
}

function PurchaseRow({
  item,
  ledger,
  home,
  matches,
  actions,
  onReview,
  onDiscard,
}: {
  item: PurchaseInboxItem;
  ledger: Ledger | null;
  home: string;
  matches: PurchaseMatch[];
  actions: boolean;
  onReview: () => void;
  onDiscard: () => void;
}) {
  const category = ledger ? suggestCategory(ledger, item.merchant)?.category : undefined;
  const receiptMatch = matches.some((match) => match.kind === "receipt");
  const meta = [item.status === "done" && item.outcome ? OUTCOME_TEXT[item.outcome] : category?.name, item.card, whenText(item.capturedAt)].filter(Boolean).join(" · ");
  function onKeyDown(event: KeyboardEvent<HTMLLIElement>) {
    if (!actions || event.target !== event.currentTarget.querySelector(".purchase-row__main")) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      onDiscard();
    }
  }
  const body = (
    <>
      <span className="purchase-tile" style={tileStyle({ ...category, entryKind: "expense" })} aria-hidden="true">
        <Icon name={categoryIcon(category?.icon)} size={18} weight={40} />
      </span>
      <span className="purchase-row__text">
        <b>{item.merchant}</b>
        <span className="purchase-row__meta">
          <span>{meta}</span>
          {matches.length ? (
            <span className="purchase-row__match">
              <LinkIcon size={12} weight={48} />
              {receiptMatch ? "Matches a receipt" : "Matches an entry"}
            </span>
          ) : null}
        </span>
      </span>
      <PurchaseAmount item={item} home={home} />
    </>
  );
  return (
    <li className={actions ? "purchase-row purchase-row--actions" : "purchase-row"} onKeyDown={onKeyDown}>
      {actions ? (
        <button type="button" className="purchase-row__main" aria-keyshortcuts="Delete" onClick={onReview}>
          {body}
        </button>
      ) : (
        <div className="purchase-row__main">{body}</div>
      )}
      {actions ? (
        <span className="purchase-row__actions">
          <Button variant="danger-quiet" icon="trash" className="purchase-discard" aria-label={`Discard ${item.merchant}`} onClick={onDiscard}>
            Discard
          </Button>
          <Button aria-label={`Review ${item.merchant}`} onClick={onReview}>
            Review
          </Button>
        </span>
      ) : null}
    </li>
  );
}
