// The Worker's copy of Penny's recipient list (MAZ-184, docs/plans/email-receipts.md#recipient-list):
// SHA-256 hashes of live local parts. It only filters noise, Penny still checks every
// forwarded message, so revocation stays immediate.
//
// - Refreshed when older than the TTL (60 s), with If-None-Match so an unchanged list is a 304.
// - On a miss, refreshed once before refusing, but at most once every 10 s per isolate.
// - When Penny is unreachable, the last good list is used for up to 1 hour. After that,
//   or when there never was a list, `has` throws: the message is retried later, never
//   forwarded blindly (fail closed).

export type ListResponse =
  | { status: "unchanged" }
  | { status: "list"; version: string; hashes: readonly string[] };

export interface RecipientListOptions {
  ttlMs: number;
  now: () => number;
  fetchList: (version: string | undefined) => Promise<ListResponse>;
  minRefreshIntervalMs?: number;
  maxStaleMs?: number;
}

export class RecipientListUnavailable extends Error {
  constructor() {
    super("The recipient list is unavailable.");
    this.name = "RecipientListUnavailable";
  }
}

export class RecipientList {
  private hashes: Set<string> | undefined;
  private version: string | undefined;
  private goodAt = Number.NEGATIVE_INFINITY;
  private attemptedAt = Number.NEGATIVE_INFINITY;
  private inflight: Promise<void> | undefined;
  private readonly minRefreshIntervalMs: number;
  private readonly maxStaleMs: number;

  constructor(private readonly options: RecipientListOptions) {
    this.minRefreshIntervalMs = options.minRefreshIntervalMs ?? 10_000;
    this.maxStaleMs = options.maxStaleMs ?? 60 * 60_000;
  }

  async has(hash: string): Promise<boolean> {
    if (this.options.now() - this.goodAt >= this.options.ttlMs) await this.refresh();
    if (this.usable().has(hash)) return true;
    await this.refresh();
    return this.usable().has(hash);
  }

  private usable(): Set<string> {
    if (this.hashes === undefined || this.options.now() - this.goodAt > this.maxStaleMs) {
      throw new RecipientListUnavailable();
    }
    return this.hashes;
  }

  // Concurrent callers share one request; attempts (failed ones too) are spaced out.
  private refresh(): Promise<void> {
    if (this.inflight) return this.inflight;
    if (this.options.now() - this.attemptedAt < this.minRefreshIntervalMs) return Promise.resolve();
    this.attemptedAt = this.options.now();
    this.inflight = this.load().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  private async load(): Promise<void> {
    let response: ListResponse;
    try {
      response = await this.options.fetchList(this.hashes === undefined ? undefined : this.version);
    } catch {
      return; // Keep the last good list; `usable` decides whether it is still good enough.
    }
    if (response.status === "list") {
      this.hashes = new Set(response.hashes);
      this.version = response.version;
    }
    if (this.hashes !== undefined) this.goodAt = this.options.now();
  }
}
