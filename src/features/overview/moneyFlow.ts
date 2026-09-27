import type { Category, Transaction } from "../../domain/ledger";

export type FlowNode = {
  id: string;
  label: string;
  amount: number;
  color: string;
};
export type MoneyFlow = {
  sources: FlowNode[];
  destinations: FlowNode[];
  income: number;
  expense: number;
  total: number;
  gap: number;
  remaining: number;
};

function group(
  entries: Transaction[],
  categories: Category[],
  kind: "income" | "expense",
): FlowNode[] {
  const sums = new Map<string, number>();
  for (const entry of entries)
    if (entry.kind === kind && entry.share > 0)
      sums.set(
        entry.categoryId,
        (sums.get(entry.categoryId) ?? 0) + entry.share,
      );
  const nodes = [...sums]
    .map(([id, amount]) => {
      const category = categories.find((c) => c.id === id);
      return {
        id: `${kind}:${id}`,
        label: category?.name ?? "Uncategorized",
        amount,
        color: category?.color ?? "#839087",
      };
    })
    .sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id));
  // Keep labels readable while preserving every cent in the flow.
  if (nodes.length <= 6) return nodes;
  return [
    ...nodes.slice(0, 5),
    {
      id: `${kind}:overflow`,
      label: `Other ${kind} categories`,
      amount: nodes.slice(5).reduce((sum, node) => sum + node.amount, 0),
      color: "#839087",
    },
  ];
}

export function buildMoneyFlow(
  entries: Transaction[],
  categories: Category[],
): MoneyFlow {
  const sources = group(entries, categories, "income");
  const destinations = group(entries, categories, "expense");
  const income = sources.reduce((sum, node) => sum + node.amount, 0);
  const expense = destinations.reduce((sum, node) => sum + node.amount, 0);
  const gap = Math.max(0, expense - income);
  const remaining = Math.max(0, income - expense);
  // A deficit is a balancing gap, never invented income or an assumed loan.
  if (gap)
    sources.push({
      id: "balance:gap",
      label: "Beyond income",
      amount: gap,
      color: "#B88167",
    });
  if (remaining)
    destinations.push({
      id: "balance:remaining",
      label: "Left over",
      amount: remaining,
      color: "#528768",
    });
  return {
    sources,
    destinations,
    income,
    expense,
    total: Math.max(income, expense),
    gap,
    remaining,
  };
}

export type PositionedFlowNode = FlowNode & {
  y: number;
  height: number;
  middleY: number;
};
export function layoutMoneyFlow(flow: MoneyFlow) {
  const bandHeight = 160;
  const scale = flow.total ? bandHeight / flow.total : 0;
  const columnHeight = (nodes: FlowNode[]) =>
    nodes.reduce((sum, node) => sum + Math.max(40, node.amount * scale), 0) +
    Math.max(0, nodes.length - 1) * 10;
  const height =
    Math.max(200, columnHeight(flow.sources), columnHeight(flow.destinations)) +
    16;
  const middleY = (height - bandHeight) / 2;
  const position = (nodes: FlowNode[]): PositionedFlowNode[] => {
    let y = (height - columnHeight(nodes)) / 2;
    let middleOffset = middleY;
    return nodes.map((node) => {
      const thickness = node.amount * scale;
      const slot = Math.max(40, thickness);
      const result = {
        ...node,
        y: y + (slot - thickness) / 2,
        height: thickness,
        middleY: middleOffset,
      };
      y += slot + 10;
      middleOffset += thickness;
      return result;
    });
  };
  return {
    height,
    middleY,
    bandHeight,
    sources: position(flow.sources),
    destinations: position(flow.destinations),
  };
}
