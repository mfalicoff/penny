import { cx, Icon, formatMoney } from "./foundation";
import type { ReactNode } from "react";

export interface FlowBarProps {
  /** Your share of expenses this month. */
  spent: number;
  /** Investment contributions. */
  invested: number;
  /** Income minus spent and invested (not an account balance). */
  left: number;
  /** Show the Spent / Invested / Left legend with rounded amounts. Default true. */
  legend?: boolean;
}
/** Horizontal split of the month's income: spent (neutral), invested (indigo), left (green). */
export function FlowBar({ spent, invested, left, legend = true }: FlowBarProps) {
  const total = spent + invested + Math.max(left, 0) || 1;
  const seg = [
    { label: "Spent", v: spent, c: "var(--pk-label)", o: 0.82 },
    { label: "Invested", v: invested, c: "var(--pk-invest)", o: 1 },
    { label: "Left", v: Math.max(left, 0), c: "var(--pk-income)", o: 1 },
  ].filter((s) => s.v > 0);
  return (
    <div>
      <div className="pk-flow">{seg.map((s) => <i key={s.label} style={{ width: `${(s.v / total) * 100}%`, background: s.c, opacity: s.o }} />)}</div>
      {legend && <div className="pk-legend">{seg.map((s) => (
        <span key={s.label}><i className="pk-dot" style={{ background: s.c, opacity: s.o }} />{s.label} <b className="pk-num">{formatMoney(s.v, true)}</b></span>
      ))}</div>}
    </div>
  );
}

export interface FlowCardProps extends FlowBarProps {
  title?: string;
  /** Right-side header control, e.g. an Insights pill. */
  action?: ReactNode;
  onOpen?: () => void;
}
/** Home's "Follow your money" card: a glass card with the FlowBar that opens the MoneyFlow screen. */
export function FlowCard({ title = "Follow your money", action, onOpen, ...bar }: FlowCardProps) {
  return (
    <div className="pk-card pk-glass pk-inset" style={{ padding: "16px 18px 18px" }}>
      <div className="pk-flowcard__head">
        <button type="button" className="pk-flowcard__title" onClick={onOpen}>{title}
          <span style={{ color: "var(--pk-label-3)" }}><Icon name="chevron-forward" size={14} weight={56} /></span></button>
        {action}
      </div>
      <FlowBar {...bar} />
    </div>
  );
}

export interface FlowNode {
  id: string;
  label: string;
  amount: number;
  /** CSS color; defaults by side (income green / category gray). */
  color?: string;
}
export interface MoneyFlowProps {
  /** Income sources (left column). Add a "Beyond income" node in a deficit month. */
  sources: FlowNode[];
  /** Expense categories (max five + "N more"), then Invested and Left over. */
  destinations: FlowNode[];
  /** Node id to focus; other bands dim. */
  highlight?: string;
  width?: number;
  height?: number;
  /** Show the INCOME / WHERE IT GOES column headers. Default true. */
  headers?: boolean;
}
/**
 * "Follow your money" Sankey: income sources -> the month's total -> categories, Invested and Left over.
 * Band width is proportional to the amount. Mirrors src/features/overview/moneyFlow.ts.
 */
export function MoneyFlow({ sources, destinations, highlight, width = 358, height = 388, headers = true }: MoneyFlowProps) {
  const total = Math.max(sources.reduce((s, n) => s + n.amount, 0), destinations.reduce((s, n) => s + n.amount, 0)) || 1;
  const leftLabel = width < 500 ? 74 : 96, rightLabel = width < 500 ? 104 : 130;
  const band = Math.min(height * 0.6, 230), slot = width < 500 ? 36 : 31, gap = 6, nodeW = 6, bar = 8;
  const k = band / total;
  const xL = leftLabel, xR = width - rightLabel - nodeW, xM = (xL + xR) / 2 - bar / 2, midTop = (height - band) / 2;
  const place = (nodes: FlowNode[]) => {
    const colH = nodes.reduce((s, n) => s + Math.max(slot, n.amount * k), 0) + (nodes.length - 1) * gap;
    let y = (height - colH) / 2, m = midTop;
    return nodes.map((n) => {
      const t = n.amount * k, s = Math.max(slot, t);
      const r = { ...n, y: y + (s - t) / 2, t, m, cy: y + s / 2 };
      y += s + gap; m += t;
      return r;
    });
  };
  const src = place(sources.map((n) => ({ ...n, color: n.color ?? "var(--pk-income)" })));
  const dst = place(destinations.map((n) => ({ ...n, color: n.color ?? "var(--pk-c-other)" })));
  const curve = (x0: number, y0: number, x1: number, y1: number, t: number) => {
    const c = (x1 - x0) * 0.5;
    return `M${x0},${y0} C${x0 + c},${y0} ${x1 - c},${y1} ${x1},${y1} L${x1},${y1 + t} C${x1 - c},${y1 + t} ${x0 + c},${y0 + t} ${x0},${y0 + t} Z`;
  };
  const op = (id: string) => (highlight ? (id === highlight ? 0.55 : 0.1) : 0.28);
  const lab = (id: string) => (highlight && id !== highlight ? 0.45 : 1);
  return (
    <div className="pk-sankey" style={{ width }}>
      {headers && <div className="pk-sankey__cols"><span>Income</span><span>Where it goes</span></div>}
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} style={{ display: "block", overflow: "visible" }}
        role="img" aria-label={`Money flow: ${formatMoney(total)} in`}>
        {src.map((n) => <path key={`b${n.id}`} d={curve(xL + nodeW, n.y, xM, n.m, n.t)} fill={n.color} opacity={op(n.id)} />)}
        {dst.map((n) => <path key={`b${n.id}`} d={curve(xM + bar, n.m, xR, n.y, n.t)} fill={n.color} opacity={op(n.id)} />)}
        <rect x={xM} y={midTop} width={bar} height={band} rx={bar / 2} fill="var(--pk-label)" />
        {src.map((n) => (
          <g key={n.id}>
            <rect x={xL} y={n.y} width={nodeW} height={Math.max(n.t, 3)} rx={3} fill={n.color} />
            <g opacity={lab(n.id)} textAnchor="end">
              <text x={xL - 8} y={n.cy - 2} fontSize={13} fontWeight={600} fill="var(--pk-label)">{n.label}</text>
              <text x={xL - 8} y={n.cy + 14} fontSize={12.5} fontWeight={600} fill={n.color} style={{ fontVariantNumeric: "tabular-nums" }}>{formatMoney(n.amount)}</text>
            </g>
          </g>
        ))}
        {dst.map((n) => (
          <g key={n.id}>
            <rect x={xR} y={n.y} width={nodeW} height={Math.max(n.t, 3)} rx={3} fill={n.color} />
            <g opacity={lab(n.id)}>
              <text x={xR + nodeW + 8} y={n.cy - 2} fontSize={13} fontWeight={n.id === highlight ? 700 : 600} fill="var(--pk-label)">{n.label}</text>
              <text x={xR + nodeW + 8} y={n.cy + 14} fontSize={12.5} fontWeight={600} fill={n.color === "var(--pk-c-other)" ? "var(--pk-label-2)" : n.color} style={{ fontVariantNumeric: "tabular-nums" }}>{formatMoney(n.amount)}</text>
            </g>
          </g>
        ))}
      </svg>
    </div>
  );
}

export interface StatProps {
  label: string;
  value: number;
  kind?: "neutral" | "income" | "investment";
}
/** Small labeled total, used in rows of two or three above charts ("Came in", "Went out", "Left over"). */
export function Stat({ label, value, kind = "neutral" }: StatProps) {
  return (
    <div style={{ fontSize: 13, color: "var(--pk-label-2)" }}>{label}
      <b className={cx("pk-num", kind !== "neutral" && `pk-money--${kind}`)} style={{ display: "block", fontSize: 20, fontWeight: 700, color: kind === "neutral" ? "var(--pk-label)" : undefined, marginTop: 2 }}>{formatMoney(value)}</b>
    </div>
  );
}
