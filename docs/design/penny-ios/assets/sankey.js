// Money-flow Sankey for the proposal renders. Mirrors src/features/overview/moneyFlow.ts:
// income sources → monthly total → expense categories, Invested and Left over.
const FLOW = {
  sources: [
    { id: "salary", label: "Salary", amount: 2800, color: "var(--income)" },
    { id: "freelance", label: "Freelance", amount: 400, color: "color-mix(in srgb, var(--income) 55%, white)" },
  ],
  destinations: [
    { id: "home", label: "Home", amount: 1450, color: "var(--c-home)" },
    { id: "groceries", label: "Groceries", amount: 158.77, color: "var(--c-groceries)" },
    { id: "transport", label: "Transport", amount: 156, color: "var(--c-transport)" },
    { id: "food", label: "Food & drinks", amount: 80.6, color: "var(--c-food)" },
    { id: "other", label: "2 more", amount: 37.98, color: "var(--label-3)" },
    { id: "invested", label: "Invested", amount: 200, color: "var(--invest)" },
    { id: "left", label: "Left over", amount: 1116.65, color: "var(--income)" },
  ],
};

const money = (n) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * opts: width, height, band (px of the middle column), slot (min row height),
 * gap, leftLabel, rightLabel (px reserved for labels), highlight (node id), compact (hide amounts on small nodes)
 */
function drawSankey(el, opts = {}) {
  const { width = 360, height = 360, band = 200, slot = 30, gap = 8, leftLabel = 84, rightLabel = 120, highlight = null, nodeW = 6, bar = 8 } = opts;
  const total = FLOW.sources.reduce((s, n) => s + n.amount, 0);
  const k = band / total;
  const xL = leftLabel, xR = width - rightLabel - nodeW, xM = (xL + xR) / 2 - bar / 2;
  const midTop = (height - band) / 2;
  const place = (nodes) => {
    const colH = nodes.reduce((s, n) => s + Math.max(slot, n.amount * k), 0) + (nodes.length - 1) * gap;
    let y = (height - colH) / 2, m = midTop;
    return nodes.map((n) => {
      const t = n.amount * k, s = Math.max(slot, t);
      const r = { ...n, y: y + (s - t) / 2, t, m, cy: y + s / 2 };
      y += s + gap; m += t;
      return r;
    });
  };
  const src = place(FLOW.sources), dst = place(FLOW.destinations);
  const curve = (x0, y0, x1, y1, t) => {
    const c = (x1 - x0) * 0.5;
    return `M${x0},${y0} C${x0 + c},${y0} ${x1 - c},${y1} ${x1},${y1} L${x1},${y1 + t} C${x1 - c},${y1 + t} ${x0 + c},${y0 + t} ${x0},${y0 + t} Z`;
  };
  const op = (id) => (highlight ? (id === highlight ? 0.55 : 0.10) : 0.28);
  const lab = (id) => (highlight && id !== highlight ? 0.45 : 1);
  let svg = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="display:block;overflow:visible;font-family:inherit">`;
  for (const n of src) svg += `<path d="${curve(xL + nodeW, n.y, xM, n.m, n.t)}" fill="${n.color}" opacity="${op(n.id)}"/>`;
  for (const n of dst) svg += `<path d="${curve(xM + bar, n.m, xR, n.y, n.t)}" fill="${n.color}" opacity="${op(n.id)}"/>`;
  svg += `<rect x="${xM}" y="${midTop}" width="${bar}" height="${band}" rx="${bar / 2}" fill="var(--label)"/>`;
  for (const n of src) {
    svg += `<rect x="${xL}" y="${n.y}" width="${nodeW}" height="${Math.max(n.t, 3)}" rx="3" fill="${n.color}"/>`;
    svg += `<g opacity="${lab(n.id)}" text-anchor="end"><text x="${xL - 8}" y="${n.cy - 2}" font-size="13" font-weight="600" fill="var(--label)">${n.label}</text>`;
    svg += `<text x="${xL - 8}" y="${n.cy + 14}" font-size="12.5" font-weight="600" fill="${n.color}" style="font-variant-numeric:tabular-nums">${money(n.amount)}</text></g>`;
  }
  for (const n of dst) {
    svg += `<rect x="${xR}" y="${n.y}" width="${nodeW}" height="${Math.max(n.t, 3)}" rx="3" fill="${n.color}"/>`;
    const bold = n.id === highlight ? 700 : 600;
    svg += `<g opacity="${lab(n.id)}"><text x="${xR + nodeW + 8}" y="${n.cy - 2}" font-size="13" font-weight="${bold}" fill="var(--label)">${n.label}</text>`;
    svg += `<text x="${xR + nodeW + 8}" y="${n.cy + 14}" font-size="12.5" font-weight="600" fill="${n.color === "var(--label-3)" ? "var(--label-2)" : n.color}" style="font-variant-numeric:tabular-nums">${money(n.amount)}</text></g>`;
  }
  el.innerHTML = svg + "</svg>";
}
