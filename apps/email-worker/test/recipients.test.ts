import { describe, expect, it, vi } from "vitest";
import { RecipientList, RecipientListUnavailable, type ListResponse } from "../src/recipients.ts";

function setup(responses: Array<ListResponse | Error>) {
  let now = 1_000_000;
  const fetchList = vi.fn(async (_version: string | undefined): Promise<ListResponse> => {
    const next = responses.shift() ?? new Error("no response");
    if (next instanceof Error) throw next;
    return next;
  });
  const list = new RecipientList({ ttlMs: 60_000, now: () => now, fetchList });
  return { list, fetchList, advance: (ms: number) => (now += ms) };
}

const listOf = (version: string, ...hashes: string[]): ListResponse => ({ status: "list", version, hashes });

describe("RecipientList", () => {
  it("caches the list for the TTL and revalidates with the version", async () => {
    const { list, fetchList, advance } = setup([listOf("v1", "a"), { status: "unchanged" }]);
    expect(await list.has("a")).toBe(true);
    advance(59_000);
    expect(await list.has("a")).toBe(true);
    expect(fetchList).toHaveBeenCalledTimes(1);
    advance(1_000);
    expect(await list.has("a")).toBe(true);
    expect(fetchList).toHaveBeenCalledTimes(2);
    expect(fetchList).toHaveBeenLastCalledWith("v1");
  });

  it("refreshes once on a miss so a new address works within seconds", async () => {
    const { list, fetchList, advance } = setup([listOf("v1", "a"), listOf("v2", "a", "b")]);
    expect(await list.has("a")).toBe(true);
    advance(11_000);
    expect(await list.has("b")).toBe(true);
    expect(fetchList).toHaveBeenCalledTimes(2);
  });

  it("refreshes at most every 10 seconds on a flood of unknown recipients", async () => {
    const { list, fetchList, advance } = setup([listOf("v1", "a"), listOf("v1", "a"), listOf("v1", "a")]);
    expect(await list.has("a")).toBe(true);
    for (let index = 0; index < 50; index++) expect(await list.has(`junk-${index}`)).toBe(false);
    expect(fetchList).toHaveBeenCalledTimes(1);
    advance(10_000);
    expect(await list.has("junk")).toBe(false);
    expect(fetchList).toHaveBeenCalledTimes(2);
  });

  it("shares one request between concurrent callers", async () => {
    const { list, fetchList } = setup([listOf("v1", "a")]);
    expect(await Promise.all([list.has("a"), list.has("a"), list.has("b")])).toEqual([true, true, false]);
    expect(fetchList).toHaveBeenCalledTimes(1);
  });

  it("uses the last good list for up to an hour while Penny is unreachable, then fails closed", async () => {
    const failures = Array.from({ length: 400 }, () => new Error("down"));
    const { list, advance } = setup([listOf("v1", "a"), ...failures]);
    expect(await list.has("a")).toBe(true);
    advance(59 * 60_000);
    expect(await list.has("a")).toBe(true);
    expect(await list.has("b")).toBe(false);
    advance(60_001);
    await expect(list.has("a")).rejects.toBeInstanceOf(RecipientListUnavailable);
  });

  it("fails closed when there never was a list", async () => {
    const { list } = setup([new Error("down")]);
    await expect(list.has("a")).rejects.toBeInstanceOf(RecipientListUnavailable);
  });

  it("recovers once Penny answers again", async () => {
    const { list, advance } = setup([new Error("down"), listOf("v1", "a")]);
    await expect(list.has("a")).rejects.toBeInstanceOf(RecipientListUnavailable);
    advance(10_000);
    expect(await list.has("a")).toBe(true);
  });
});
