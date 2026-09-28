import React, { createContext, useContext, useState } from "react";
import { dateKey, type Kind, type Recurring, type Transaction } from "../domain/ledger";

export type EntryFormState = { entry?: Transaction; rule?: Recurring };

// Shared only because navigation must preserve filters and unfinished entry drafts.
function useWorkspaceState() {
  const [month, setMonth] = useState(dateKey().slice(0, 7));
  const [day, setDay] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | Kind>("all");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<EntryFormState | null>(null);
  const [transactionFilters, setTransactionFilters] = useState<{
    month: string; period: "month" | "year"; filter: "all" | Kind; search: string; page: number;
  }>({
    month: dateKey().slice(0, 7), period: "month", filter: "all", search: "", page: 0,
  });
  return { month, setMonth, day, setDay, filter, setFilter, search, setSearch, form, setForm, transactionFilters, setTransactionFilters };
}

const WorkspaceContext = createContext<ReturnType<typeof useWorkspaceState> | null>(null);

export function WorkspaceProvider({ children }: React.PropsWithChildren) {
  const value = useWorkspaceState();
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return value;
}
