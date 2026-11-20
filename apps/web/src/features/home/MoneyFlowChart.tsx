import { layoutMoneyFlow, type FlowNode, type MoneyFlow } from "@domain/selectors/moneyFlow.ts";
import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type CSSProperties, type ReactNode, type RefObject } from "react";
import type { Category } from "@domain/ledger.ts";
import { cx } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { formatCents, Money } from "../../design/Money";
import { flowColor, flowNodeIcon, flowNodeSummary, percentOf, shortLabel } from "./model";

type Side = "in" | "out";
type Node = FlowNode & { side: Side };

/**
 * Sankey geometry in viewBox units; the SVG scales to its card. A narrow card (the phone Money
 * flow screen, `iphone-money-flow`) gets a narrower viewBox, so its labels stay readable at 320px
 * without horizontal scrolling.
 */
const BAR = 8;
const GEOMETRY = {
  wide: { width: 760, left: 168, right: 574, label: 18 },
  narrow: { width: 380, left: 84, right: 262, label: 13 },
} as const;
type Geometry = (typeof GEOMETRY)[keyof typeof GEOMETRY];
/** Below this card width the narrow geometry is used. */
const NARROW_BELOW = 560;

function ribbon(x: number, y: number, endX: number, endY: number, height: number) {
  const bend = (x + endX) / 2;
  return `M ${String(x)} ${String(y)} C ${String(bend)} ${String(y)}, ${String(bend)} ${String(endY)}, ${String(endX)} ${String(endY)} L ${String(endX)} ${String(endY + height)} C ${String(bend)} ${String(endY + height)}, ${String(bend)} ${String(y + height)}, ${String(x)} ${String(y + height)} Z`;
}

interface MoneyFlowChartProps {
  flow: MoneyFlow;
  currency: string | undefined;
  monthLabel: string;
  /**
   * `panel` (desktop Home and Insights, `web-home`, `web-insights`): a "Follow your money" card
   * whose header carries the focus hint, kept short enough for the fold. `page` (the Money flow
   * screen, `iphone-money-flow`): the totals, the diagram in its own card, then the focus card.
   */
  variant: "panel" | "page";
  /** A link beside the hint, such as Home's "Open full view" (panel only). */
  action?: ReactNode;
  /** The ledger's categories, for the focus card's icon tile (page only). */
  categories?: readonly Pick<Category, "id" | "icon">[];
}

const HINT = "Select a band or label to focus it, again to clear";

/**
 * "Follow your money" (cards `iphone-money-flow`, `ipad-home`, `web-home`, `web-insights`): where
 * the month's recorded money came from and where it went (never expected or scheduled entries, so
 * it matches Left to spend, as on iOS), from the shared `buildMoneyFlow` (your share of split
 * expenses, at most five categories per side plus "N more", Invested and Left over as
 * destinations, "Beyond income" as a source in a deficit month).
 *
 * Every node is a button: click, Enter or Space focuses it (and again clears), arrow keys move
 * between nodes, Escape clears. The focus hint and "Show as a table" (which lists every value)
 * are on the cards since MAZ-224. The selection is announced politely: on the page in the focus
 * card, on a panel in the hint ("Home selected · …").
 */
export function MoneyFlowChart({ flow, currency, monthLabel, variant, action, categories = [] }: MoneyFlowChartProps) {
  const headingId = useId();
  const hintId = useId();
  const [selected, setSelected] = useState<string | null>(null);
  // A pointer over a band emphasises it, as the cards draw a hovered band (`web-home`), without selecting it.
  const [hovered, setHovered] = useState<string | null>(null);
  const nodes: Node[] = useMemo(() => [...flow.sources.map((node) => ({ ...node, side: "in" as const })), ...flow.destinations.map((node) => ({ ...node, side: "out" as const }))], [flow]);
  const active = nodes.find((node) => node.id === selected) ?? null;
  const money = (cents: number) => formatCents(cents, currency);
  const describe = (node: Node) => `${node.side === "in" ? "Came in" : "Went out"}: ${node.label}, ${money(node.amount)}, ${flowNodeSummary(node, flow, node.side)}`;
  const toggle = (id: string) => {
    setSelected((current) => (current === id ? null : id));
  };
  const onKeyDown = (event: KeyboardEvent, index: number, scope: HTMLElement | null) => {
    const keys: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
    if (event.key === "Escape" && selected) {
      event.preventDefault();
      event.stopPropagation();
      setSelected(null);
      return;
    }
    if (event.key === "Home" || event.key === "End" || event.key in keys) {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? nodes.length - 1 : (index + (keys[event.key] ?? 0) + nodes.length) % nodes.length;
      scope?.querySelectorAll<HTMLElement | SVGElement>("[data-flow-node]")[next]?.focus();
    }
  };
  const empty = <p className="muted">Nothing came in or went out in {monthLabel} yet. Add income, an expense or an investment to see where your money goes.</p>;
  const sankey = <Sankey flow={flow} nodes={nodes} selected={selected} hovered={hovered} onHover={setHovered} currency={currency} describe={describe} toggle={toggle} onKeyDown={onKeyDown} hintId={hintId} />;
  const table = <FlowTable flow={flow} nodes={nodes} currency={currency} monthLabel={monthLabel} />;

  if (variant === "panel") {
    return (
      <section className="card flow flow--panel" aria-labelledby={headingId}>
        <div className="card__head">
          <h2 id={headingId} className="panel__title">
            Follow your money
          </h2>
          <span className="muted flow__hint" id={hintId} aria-live="polite">
            {active ? `${active.label} selected · select a band or label to focus it, again to clear` : HINT}
          </span>
          {action}
        </div>
        {!flow.total ? (
          empty
        ) : (
          <>
            {sankey}
            {table}
          </>
        )}
      </section>
    );
  }

  return (
    <div className="flow flow--page">
      {!flow.total ? (
        empty
      ) : (
        <>
          <dl className="flow__totals">
            <div>
              <dt>Came in</dt>
              <dd>
                <Money cents={flow.income} currency={currency} />
              </dd>
            </div>
            <div>
              <dt>Went out</dt>
              <dd>
                <Money cents={flow.expense + flow.investment} currency={currency} />
              </dd>
            </div>
            <div>
              <dt>{flow.gap ? "Beyond income" : "Left over"}</dt>
              <dd>
                <Money cents={flow.gap || flow.remaining} currency={currency} />
              </dd>
            </div>
          </dl>
          <div className="card flow__chart">
            <p className="flow__columns" aria-hidden="true">
              <span>Income</span>
              <span>Where it goes</span>
            </p>
            {sankey}
          </div>
          <FocusCard
            active={active}
            flow={flow}
            currency={currency}
            categories={categories}
            onClear={() => {
              setSelected(null);
            }}
          />
          <p className="muted flow__hint" id={hintId}>
            {HINT}
          </p>
          {table}
        </>
      )}
    </div>
  );
}

/** The page's focus card (`iphone-money-flow`): the focused node, its share, and a button that clears it. */
function FocusCard({ active, flow, currency, categories, onClear }: { active: Node | null; flow: MoneyFlow; currency: string | undefined; categories: readonly Pick<Category, "id" | "icon">[]; onClear: () => void }) {
  return (
    <div aria-live="polite" className={active ? "card flow__focus" : "visually-hidden"}>
      {active ? (
        <>
          <span className="category-dot flow__tile" style={{ "--tile": flowColor(active) } as CSSProperties} aria-hidden="true">
            <Icon name={flowNodeIcon(active, categories)} size={18} />
          </span>
          <p className="flow__focus-text">
            <strong>
              {active.label} · <Money cents={active.amount} currency={currency} />
            </strong>
            <span>{flowNodeSummary(active, flow, active.side)}</span>
          </p>
          <button type="button" className="flow__clear" aria-label={`Clear focus on ${active.label}`} onClick={onClear}>
            <Icon name="close" size={15} />
          </button>
        </>
      ) : (
        "Nothing focused"
      )}
    </div>
  );
}

interface ViewProps {
  flow: MoneyFlow;
  nodes: Node[];
  selected: string | null;
  hovered: string | null;
  onHover: (id: string | null) => void;
  currency: string | undefined;
  describe: (node: Node) => string;
  toggle: (id: string) => void;
  onKeyDown: (event: KeyboardEvent, index: number, scope: HTMLElement | null) => void;
  hintId: string;
}

/** The card's width, to pick the Sankey's geometry; wide until measured (and where ResizeObserver is missing). */
function useNarrow(ref: RefObject<HTMLElement | null>) {
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setNarrow(entry.contentRect.width < NARROW_BELOW);
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [ref]);
  return narrow;
}

function Sankey({ flow, selected, hovered, onHover, currency, describe, toggle, onKeyDown, hintId }: ViewProps) {
  const scope = useRef<HTMLDivElement>(null);
  const narrow = useNarrow(scope);
  const geometry: Geometry = narrow ? GEOMETRY.narrow : GEOMETRY.wide;
  const { width, left: leftX, right: rightX } = geometry;
  const middleX = width / 2 - BAR / 2;
  const layout = useMemo(() => layoutMoneyFlow(flow), [flow]);
  const positioned = [...layout.sources.map((node) => ({ ...node, side: "in" as const })), ...layout.destinations.map((node) => ({ ...node, side: "out" as const }))];
  // The selection wins over the pointer; either one emphasises its band and dims the rest.
  const emphasis = selected ?? hovered;
  const opacity = (id: string) => (!emphasis ? 0.34 : emphasis === id ? 0.72 : 0.08);
  const centers = positioned.map((node) => node.y + node.height / 2);
  return (
    <div className={cx("flow__sankey", narrow && "flow__sankey--narrow")} ref={scope} role="group" aria-label="Money flow diagram" aria-describedby={hintId}>
      <svg viewBox={`0 0 ${String(width)} ${String(layout.height)}`} className="flow__svg" focusable="false">
        <rect x={middleX} y={layout.middleY} width={BAR} height={layout.bandHeight} rx={3} className="flow__middle" />
        {positioned.map((node, index) => {
          const color = flowColor(node);
          const left = node.side === "in";
          const path = left ? ribbon(leftX + BAR, node.y, middleX, node.middleY, node.height) : ribbon(middleX + BAR, node.middleY, rightX, node.y, node.height);
          const labelX = left ? leftX - 10 : rightX + BAR + 10;
          const center = node.y + node.height / 2;
          const on = selected === node.id;
          const lit = emphasis === node.id;
          // The 44-unit hit ring, cut at the midpoint to each neighbour on its side, so a thin band's
          // ring never covers the next label (MAZ-235): a pointer always lands on the label it is over.
          const before = positioned[index - 1]?.side === node.side ? centers[index - 1] : undefined;
          const after = positioned[index + 1]?.side === node.side ? centers[index + 1] : undefined;
          const ringTop = Math.max(center - 22, before === undefined ? -Infinity : (before + center) / 2);
          const ringBottom = Math.min(center + 22, after === undefined ? Infinity : (center + after) / 2);
          return (
            <g
              key={node.id}
              data-flow-node=""
              role="button"
              tabIndex={0}
              aria-pressed={on}
              aria-label={describe(node)}
              className={cx("flow-node", on && "flow-node--on", lit && "flow-node--lit", emphasis && !lit && "flow-node--dim")}
              onPointerEnter={(event) => {
                if (event.pointerType === "mouse") onHover(node.id);
              }}
              onPointerLeave={() => {
                onHover(null);
              }}
              onClick={() => {
                toggle(node.id);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  toggle(node.id);
                  return;
                }
                onKeyDown(event, index, scope.current);
              }}
            >
              <title>{`${node.label}: ${formatCents(node.amount, currency)}`}</title>
              <path d={path} fill={color} fillOpacity={opacity(node.id)} />
              <rect x={left ? leftX : rightX} y={node.y} width={BAR} height={Math.max(2, node.height)} rx={3} fill={color} />
              <rect className="flow-node__ring" x={left ? 4 : rightX - 4} y={ringTop} width={left ? leftX : width - rightX} height={ringBottom - ringTop} rx={8} />
              <text x={labelX} y={center - 4} textAnchor={left ? "end" : "start"} className="flow-node__label">
                {shortLabel(node.label, geometry.label)}
              </text>
              <text x={labelX} y={center + 14} textAnchor={left ? "end" : "start"} className="flow-node__amount" fill={color}>
                {formatCents(node.amount, currency)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function FlowTable({ flow, nodes, currency, monthLabel }: { flow: MoneyFlow; nodes: Node[]; currency: string | undefined; monthLabel: string }) {
  return (
    <details className="flow__table">
      <summary>
        Show as a table
        <Icon name="chevron-down" size={14} />
      </summary>
      <div className="table-scroll">
        <table>
          <caption className="visually-hidden">Money flow for {monthLabel}</caption>
          <thead>
            <tr>
              <th scope="col">Direction</th>
              <th scope="col">Item</th>
              <th scope="col" className="num">
                Amount
              </th>
              <th scope="col" className="num">
                Of the flow
              </th>
            </tr>
          </thead>
          <tbody>
            {nodes.map((node) => (
              <tr key={node.id}>
                <td>{node.side === "in" ? "Came in" : "Went out"}</td>
                <th scope="row">{node.label}</th>
                <td className="num">
                  <Money cents={node.amount} currency={currency} />
                </td>
                <td className="num">{percentOf(node.amount, flow.total)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
