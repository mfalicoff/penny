import { DataTable, CategoryIcon, Money, Badge, Avatar } from "@penny/ios-kit";

const Entry = ({ cat, title, tag }: { cat: Parameters<typeof CategoryIcon>[0]["category"]; title: string; tag?: React.ReactNode }) => (
  <span style={{ display: "flex", alignItems: "center", gap: 10 }}><CategoryIcon category={cat} size="sm" /><b>{title}</b>{tag}</span>
);
const cols = [{ key: "entry", label: "Entry" }, { key: "account", label: "Account" }, { key: "split", label: "Split" }, { key: "amount", label: "Amount", align: "right" as const }];

export const Activity = () => (
  <div style={{ width: 780, padding: 16, background: "var(--pk-bg)" }}>
    <DataTable columns={cols} groups={[
      { label: "Today · Monday, Nov 9", total: "−$55.30", rows: [
        { id: "1", cells: { entry: <Entry cat="groceries" title="Groceries" />, account: "Main chequing", amount: <b><Money value={48.9} kind="expense" /></b> } },
        { id: "2", selected: true, cells: { entry: <Entry cat="food" title="Coffee with Mira" />, account: "Visa", split: "2 people", amount: <b><Money value={6.4} kind="expense" /></b> } },
      ] },
      { label: "Friday, Nov 6", total: "−$262.00", rows: [
        { id: "3", cells: { entry: <Entry cat="investment" title="TFSA contribution" tag={<Badge icon="repeat">Monthly</Badge>} />, account: "Main chequing", amount: <b><Money value={200} kind="investment" /></b> } },
        { id: "4", cells: { entry: <Entry cat="transport" title="Transit pass" tag={<Badge icon="repeat">Monthly</Badge>} />, account: "Visa", amount: <b><Money value={62} kind="expense" /></b> } },
      ] },
    ]} />
  </div>
);

export const SharedExpenses = () => (
  <div style={{ width: 780, padding: 16, background: "var(--pk-bg)" }}>
    <DataTable columns={[{ key: "e", label: "Expense" }, { key: "by", label: "Paid by" }, { key: "total", label: "Total", align: "right" }, { key: "share", label: "Your share", align: "right" }, { key: "status", label: "Status" }]}
      rows={[
        { id: "r", cells: { e: <Entry cat="home" title="Rent" />, by: <span style={{ display: "flex", gap: 8, alignItems: "center" }}><Avatar initials="MF" size={24} />You</span>, total: "$2,900.00", share: "$1,450.00", status: <Badge tone="pending">Settles Nov 30</Badge> } },
        { id: "c", cells: { e: <Entry cat="groceries" title="Costco run" />, by: <span style={{ display: "flex", gap: 8, alignItems: "center" }}><Avatar initials="JS" size={24} />Jo</span>, total: "$184.20", share: "$61.40", status: <Badge tone="income" icon="checkmark">Paid</Badge> } },
      ]} />
  </div>
);
