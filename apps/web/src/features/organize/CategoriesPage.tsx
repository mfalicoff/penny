import { useId, useMemo, useState } from "react";
import { kinds, type Category, type Kind } from "@domain/ledger.ts";
import { ChoiceGroup } from "../../design/controls";
import { EmptyState, ErrorState, LoadingState } from "../../design/states";
import { CategoryFormDialog } from "./CategoryFormDialog";
import { ManageAdd } from "./ManageAdd";
import { OrganizeRow } from "./OrganizeRow";
import { categoryIcon, categoryUsage, kindLabels, sentenceCase, unsyncedIds, usageOf, usageText, type Usage } from "./model";
import { useLedgerWorkspace } from "./workspace";

const KIND_PLURAL: Record<Kind, string> = { expense: "expense categories", income: "income categories", investment: "investment categories" };

/**
 * Categories (card `iphone-categories`): one list per kind, chosen with a segmented control whose
 * value lives in the URL (`?kind=income`), each row with its color, icon and how many entries use
 * it. Changes are saved in this browser first and sync from there (MAZ-87).
 */
export function CategoriesPage({ kind, onKindChange }: { kind: Kind; onKindChange: (kind: Kind) => void }) {
  const workspace = useLedgerWorkspace();
  const [form, setForm] = useState<{ category?: Category } | null>(null);
  const headingId = useId();
  const { ledger, server } = workspace;

  const usage = useMemo(() => (ledger ? categoryUsage(ledger) : new Map<string, Usage>()), [ledger]);
  const waiting = useMemo(() => (ledger ? unsyncedIds(ledger.categories, server?.categories ?? null) : new Set<string>()), [ledger, server]);

  if (workspace.status === "loading") return <LoadingState label="Loading your categories…" />;
  if (workspace.status === "error" || !ledger) {
    return (
      <ErrorState title="Penny couldn't load your categories" onRetry={workspace.retry} retrying={workspace.retrying}>
        {workspace.loadError} Nothing was changed.
      </ErrorState>
    );
  }

  const list = ledger.categories.filter((category) => category.kind === kind);
  const open = () => {
    setForm({});
  };

  return (
    <div className="page organize">
      <ManageAdd label="New category" onClick={open} />
      <ChoiceGroup<Kind>
        legend="Kind"
        hideLegend
        name="category-kind"
        value={kind}
        onChange={onKindChange}
        options={kinds.map((value) => ({ value, label: kindLabels[value] }))}
      />
      {list.length === 0 ? (
        <EmptyState
          icon="pricetag"
          title={`No ${KIND_PLURAL[kind]}`}
        >
          <p>Add one to sort your {kindLabels[kind].toLowerCase()} entries. You can rename it, recolor it or move its entries later.</p>
        </EmptyState>
      ) : (
        <section className="organize-section" aria-labelledby={headingId}>
          <h2 id={headingId} className="group-label">
            {list.length} {list.length === 1 ? "category" : "categories"}
          </h2>
          <ul className="group-list group-list--inset organize-list--categories">
            {list.map((category) => (
              <OrganizeRow
                key={category.id}
                name={category.name}
                meta={sentenceCase(usageText(usageOf(usage, category.id)))}
                icon={categoryIcon(category.icon)}
                tint={{ id: category.id, color: category.color }}
                waiting={waiting.has(category.id)}
                onOpen={() => {
                  setForm({ category });
                }}
              />
            ))}
          </ul>
          <p className="group-note">A category that entries use can be renamed or recolored at any time; to remove it, move its entries to another {kindLabels[kind].toLowerCase()} category.</p>
        </section>
      )}
      {form ? (
        <CategoryFormDialog
          {...(form.category ? { category: form.category } : {})}
          initialKind={kind}
          workspace={{ ledger, save: workspace.save }}
          onClose={() => {
            setForm(null);
          }}
        />
      ) : null}
    </div>
  );
}
