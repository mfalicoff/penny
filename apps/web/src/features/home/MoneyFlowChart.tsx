import { layoutMoneyFlow, type FlowNode, type MoneyFlow } from "@domain/selectors/moneyFlow.ts";
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cx } from "../../design/controls";
import { formatCents, Money } from "../../design/Money";
import { flowColor, flowNodeSummary, percentOf, shortLabel } from "./model";

type Side = "in" | "out";
type Node = FlowNode & { side: Side };

/** Sankey geometry in viewBox units; the SVG scales to its card. */
const WIDTH = 760;
const BAR = 8;
const LEFT_X = 168;
const RIGHT_X = WIDTH - 186;
const MIDDLE_X = WIDTH / 2 - BAR / 2;

function ribbon(x: number, y: number, endX: number, endY: number, height: number) {
  const bend = (x + endX) / 2;
  return `M ${String(x)} ${String(y)} C ${String(bend)} ${String(y)}, ${String(bend)} ${String(endY)}, ${String(endX)} ${String(endY)} L ${String(endX)} ${String(endY + height)} C ${String(bend)} ${String(endY + height)}, ${String(bend)} ${String(y + height)}, ${String(x)} ${String(y + height)} Z`;
}

interface MoneyFlowChartProps {
  flow: MoneyFlow;
  currency: string | undefined;
  monthLabel: string;
  /** Heading level of the card title (2 on Insights, 3 inside Home's Explore your month). */
  level?: 2 | 3;
  /** Scheduled income not received yet, which the flow includes (the legacy money-flow input). */
  expectedIncome?: number;
}

/**
 * "Follow your money" (specimen `money-flow`, web cards `web-home` and `web-insights`): where the
 * month's money came from and where it went, from the shared `buildMoneyFlow` (your share of
 * split expenses, at most five categories per side plus "Other", Invested and Left over as
 * destinations, "Beyond income" as a source in a deficit month).
 *
 * Two renderings of the same nodes, chosen by the card's width (a container query): a Sankey on
 * wide cards and a stacked bar flow on phones, which fits 320px without scrolling. Every node is
 * a button: click, Enter or Space focuses it (and again clears), arrow keys move between nodes,
 * Escape clears. The focus card announces the selection, and "Show as a table" lists every value.
 */
export function MoneyFlowChart({ flow, currency, monthLabel, level = 2, expectedIncome = 0 }: MoneyFlowChartProps) {
  const headingId = useId();
  const hintId = useId();
  const [selected, setSelected] = useState<string | null>(null);
  const nodes: Node[] = useMemo(() => [...flow.sources.map((node) => ({ ...node, side: "in" as const })), ...flow.destinations.map((node) => ({ ...node, side: "out" as const }))], [flow]);
  const active = nodes.find((node) => node.id === selected) ?? null;
  const Heading = level === 2 ? "h2" : "h3";
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

  return (
    <section className="card flow" aria-labelledby={headingId}>
      <div className="card__head">
        <Heading id={headingId} className="panel__title">
          Follow your money
        </Heading>
        <span className="muted flow__hint" id={hintId}>
          Select a band or label to focus it, again to clear
        </span>
      </div>
      {!flow.total ? (
        <p className="muted">Nothing came in or went out in {monthLabel} yet. Add income, an expense or an investment to see where your money goes.</p>
      ) : (
        <>
          <dl className="flow__totals">
            <div>
              <dt>Came in</dt>
              <dd>
                <Money cents={flow.income} currency={currency} tone="income" />
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
                <Money cents={flow.gap || flow.remaining} currency={currency} tone={flow.gap ? "expense" : "income"} />
              </dd>
            </div>
          </dl>
          <FocusCard active={active} flow={flow} currency={currency} />
          <Sankey flow={flow} nodes={nodes} selected={selected} describe={describe} toggle={toggle} onKeyDown={onKeyDown} hintId={hintId} />
          <Stacked flow={flow} nodes={nodes} selected={selected} describe={describe} toggle={toggle} onKeyDown={onKeyDown} hintId={hintId} />
          <p className="note">
            Your share of split and shared expenses only. Investments are contributions, not spending, and come out of what's left.
            {expectedIncome > 0 ? ` Came in includes ${money(expectedIncome)} of expected recurring income not recorded yet.` : ""}
          </p>
          <FlowTable flow={flow} nodes={nodes} currency={currency} monthLabel={monthLabel} />
        </>
      )}
    </section>
  );
}

function FocusCard({ active, flow, currency }: { active: Node | null; flow: MoneyFlow; currency: string | undefined }) {
  return (
    <p className="flow__focus" aria-live="polite">
      {active ? (
        <>
          <span className="flow__swatch" style={{ background: flowColor(active) }} aria-hidden="true" />
          <strong>{active.label}</strong> <Money cents={active.amount} currency={currency} /> · {flowNodeSummary(active, flow, active.side)}
        </>
      ) : (
        <span className="muted">Nothing focused</span>
      )}
    </p>
  );
}

interface ViewProps {
  flow: MoneyFlow;
  nodes: Node[];
  selected: string | null;
  describe: (node: Node) => string;
  toggle: (id: string) => void;
  onKeyDown: (event: KeyboardEvent, index: number, scope: HTMLElement | null) => void;
  hintId: string;
}

function Sankey({ flow, selected, describe, toggle, onKeyDown, hintId }: ViewProps) {
  const scope = useRef<HTMLDivElement>(null);
  const layout = useMemo(() => layoutMoneyFlow(flow), [flow]);
  const positioned = [...layout.sources.map((node) => ({ ...node, side: "in" as const })), ...layout.destinations.map((node) => ({ ...node, side: "out" as const }))];
  const opacity = (id: string) => (!selected ? 0.34 : selected === id ? 0.72 : 0.08);
  return (
    <div className="flow__sankey" ref={scope} role="group" aria-label="Money flow diagram" aria-describedby={hintId}>
      <svg viewBox={`0 0 ${String(WIDTH)} ${String(layout.height)}`} className="flow__svg" focusable="false">
        <rect x={MIDDLE_X} y={layout.middleY} width={BAR} height={layout.bandHeight} rx={3} className="flow__middle" />
        {positioned.map((node, index) => {
          const color = flowColor(node);
          const left = node.side === "in";
          const path = left ? ribbon(LEFT_X + BAR, node.y, MIDDLE_X, node.middleY, node.height) : ribbon(MIDDLE_X + BAR, node.middleY, RIGHT_X, node.y, node.height);
          const labelX = left ? LEFT_X - 10 : RIGHT_X + BAR + 10;
          const center = node.y + node.height / 2;
          const on = selected === node.id;
          return (
            <g
              key={node.id}
              data-flow-node=""
              role="button"
              tabIndex={0}
              aria-pressed={on}
              aria-label={describe(node)}
              className={cx("flow-node", on && "flow-node--on", selected && !on && "flow-node--dim")}
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
              <title>{`${node.label}: ${formatCents(node.amount)}`}</title>
              <path d={path} fill={color} fillOpacity={opacity(node.id)} />
              <rect x={left ? LEFT_X : RIGHT_X} y={node.y} width={BAR} height={Math.max(2, node.height)} rx={3} fill={color} />
              <rect className="flow-node__ring" x={left ? 4 : RIGHT_X - 4} y={center - 22} width={left ? LEFT_X : WIDTH - RIGHT_X} height={44} rx={8} />
              <text x={labelX} y={center - 4} textAnchor={left ? "end" : "start"} className="flow-node__label">
                {shortLabel(node.label)}
              </text>
              <text x={labelX} y={center + 14} textAnchor={left ? "end" : "start"} className="flow-node__amount" fill={color}>
                {formatCents(node.amount)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Stacked({ flow, nodes, selected, describe, toggle, onKeyDown, hintId }: ViewProps) {
  const scope = useRef<HTMLDivElement>(null);
  const bar = (side: Side) => (
    <div className="flow__bar" aria-hidden="true">
      {nodes
        .filter((node) => node.side === side)
        .map((node) => (
          <span
            key={node.id}
            className={cx("flow__segment", selected && selected !== node.id && "flow__segment--dim")}
            style={{ width: `${String((node.amount / flow.total) * 100)}%`, background: flowColor(node) }}
          />
        ))}
    </div>
  );
  return (
    <div className="flow__stacked" ref={scope} role="group" aria-label="Money flow" aria-describedby={hintId}>
      <p className="flow__bar-label">Came in</p>
      {bar("in")}
      <p className="flow__bar-label">Went out</p>
      {bar("out")}
      <ul className="flow__legend">
        {nodes.map((node, index) => (
          <li key={node.id}>
            <button
              type="button"
              data-flow-node=""
              aria-pressed={selected === node.id}
              aria-label={describe(node)}
              className={cx("flow__item", selected === node.id && "flow__item--on")}
              onClick={() => {
                toggle(node.id);
              }}
              onKeyDown={(event) => {
                onKeyDown(event, index, scope.current);
              }}
            >
              <span className="flow__swatch" style={{ background: flowColor(node) }} aria-hidden="true" />
              <span className="flow__item-label">{node.label}</span>
              <span className="flow__item-amount">
                {formatCents(node.amount)} <span className="muted">· {String(percentOf(node.amount, flow.total))}%</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FlowTable({ flow, nodes, currency, monthLabel }: { flow: MoneyFlow; nodes: Node[]; currency: string | undefined; monthLabel: string }) {
  return (
    <details className="flow__table">
      <summary>Show as a table</summary>
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
