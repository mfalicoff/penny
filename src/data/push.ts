/** An allowlisted route from a household push payload. Never navigate to arbitrary URLs from a notification. */
export function householdPushPath(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const payload = data as Record<string, unknown>;
  if (typeof payload.householdId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(payload.householdId)) return null;
  if (typeof payload.month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(payload.month)) return null;
  const params = new URLSearchParams({ month: payload.month });
  if (payload.expenseId !== undefined) {
    if (typeof payload.expenseId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(payload.expenseId)) return null;
    params.set("expenseId", payload.expenseId);
  }
  return `/households/${encodeURIComponent(payload.householdId)}?${params.toString()}`;
}
