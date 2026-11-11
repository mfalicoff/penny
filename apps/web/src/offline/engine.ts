import type { LedgerChange } from "@domain/commands.ts";
import { dateKey, materialize, type Ledger } from "@domain/ledger.ts";
import { mergeLedger } from "@domain/merge.ts";
import { ApiError } from "../api/client";
import { withLock, openLedgerChannel, type LedgerChannel, type LockRunner } from "./coordination";
import { MemoryLedgerDatabase, StorageError, type LedgerDatabase } from "./database";
import { readLegacyCopy, removeLegacyAsideCopies, removeLegacyCopy, setLegacyCopyAside, type LegacyStorage } from "./legacy";
import { NOTHING_PENDING, pendingChanges, type PendingSummary } from "./pending";
import { accountScope, asideKey, isAsideKeyOf, parseRecord, RECORD_FORMAT, RecordError, recordKey, type AccountScope, type LedgerRecord } from "./record";
import { IncompatibleLedgerError, normalizeLedger, sameLedger, type ServerSnapshot } from "./wire";

/** Why the last sync didn't finish. Pending work is kept in every case. */
export type SyncIssueKind =
  | "offline"
  | "serverUnreachable"
  | "serverUnavailable"
  | "conflictRetriesExhausted"
  | "rejected"
  | "incompatibleServerData"
  | "storageWriteFailed"
  | "unexpected";

export interface SyncIssue {
  kind: SyncIssueKind;
  message: string;
  /** Whether Penny retries by itself (on reconnect or after a delay). Otherwise the next save or Retry does. */
  retries: boolean;
}

export type SyncPhase =
  | "loading"
  | "upToDate"
  | "syncing"
  | "pending"
  | "offline"
  | "failed"
  | "sessionExpired"
  | "storageUnavailable"
  | "storageUnreadable"
  | "storageNewerFormat";

export interface LedgerSyncState {
  phase: SyncPhase;
  issue: SyncIssue | null;
  /** The ledger to show: the server's copy plus this browser's unsynced changes. Null until the first download. */
  ledger: Ledger | null;
  pending: PendingSummary;
  lastSyncedAt: string | null;
  /** Whether saves are kept durably. False when the browser refuses storage: the ledger is shown but saves are refused. */
  durable: boolean;
  /** A copy left by the legacy web app that couldn't be read. It is kept, and counts as pending for sign-out, until set aside. */
  legacyUnreadable: boolean;
  /**
   * `Date.now()` of the last change to what the ledger shows after it first loaded: a save here or
   * in another tab, or a sync that brought something new. Server search results older than this
   * may show deleted or stale rows.
   */
  changedAt: number;
}

export type SaveErrorKind = "notLoaded" | "unavailable" | "storageUnavailable" | "storageUnreadable" | "storageNewerFormat" | "writeFailed" | "rule";

/** A save that was not kept. Nothing changed on this browser or the server; the form keeps the draft. */
export class LedgerSaveError extends Error {
  readonly kind: SaveErrorKind;

  constructor(kind: SaveErrorKind, message?: string, options?: { cause?: unknown }) {
    super(message ?? SAVE_MESSAGES[kind], options);
    this.name = "LedgerSaveError";
    this.kind = kind;
  }
}

const SAVE_MESSAGES: Record<SaveErrorKind, string> = {
  notLoaded: "Wait for your ledger to download before saving. Your draft is still here.",
  unavailable: "Penny is signing out or switching accounts. Your draft is still here.",
  storageUnavailable: "This browser isn't letting Penny store data (private browsing or a site setting), so changes can't be saved here. Your draft is still here.",
  storageUnreadable: "Penny can't read what it saved in this browser. Set that copy aside to keep working. Your draft is still here.",
  storageNewerFormat: "A newer version of Penny saved data in this browser. Reload the page to update Penny. Your draft is still here.",
  writeFailed: "This browser couldn't save the change. It may be out of space. Your draft is still here.",
  rule: "This change can't be saved.",
};

export interface SaveReceipt {
  /** True when the change is kept on this browser and waits for the network ("Saved on this device"). */
  savedOffline: boolean;
}

export interface LedgerApi {
  get(): Promise<ServerSnapshot>;
  put(snapshot: ServerSnapshot): Promise<ServerSnapshot>;
}

export interface EngineOptions {
  /** The page's origin. */
  server: string;
  email: string;
  api: LedgerApi;
  /** Opens the durable database. When it fails, the engine keeps working in memory without accepting saves. */
  openDatabase: () => Promise<LedgerDatabase>;
  /** `localStorage`, where the legacy web app kept its copy. Null when unavailable. */
  legacyStorage: LegacyStorage | null;
  /** Called once when the server answers 401 for this account. The engine changes nothing. */
  onSessionExpired?: () => void;
  /** Called whenever a sync recorded a server snapshot; `changed` when it differs from the previous base. */
  onServerSnapshot?: (snapshot: ServerSnapshot, changed: boolean) => void;
  online?: () => boolean;
  /** Whether this tab is visible. Hidden tabs don't run retry timers. */
  visible?: () => boolean;
  today?: () => string;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  lock?: LockRunner;
  channel?: (onChange: (key: string) => void) => LedgerChannel;
  /** Window-like target for `online` and `visibilitychange`; null in tests that drive triggers by hand. */
  events?: { window: Window; document: Document } | null;
  requestPersistence?: () => void;
}

/** 0.2, 0.4, 0.8, 1.6 s plus up to 50% jitter, then give up for this sync (the native `ConflictRetryPolicy.standard`). */
const CONFLICT_DELAYS = [200, 400, 800, 1600];
const MAX_PASSES = 3;
const BACKOFF_FIRST = 15_000;
const BACKOFF_MAX = 5 * 60_000;

class ConflictRetriesExhausted extends Error {}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * One signed-in account's durable offline ledger and its sync with `GET`/`PUT /api/ledger`,
 * following the native engine's rules (docs/ios-offline-sync.md):
 *
 * - A save is applied to `local`, materialized, written to IndexedDB, and only then acknowledged.
 * - One sync per account at a time across tabs: read, merge (`src/domain/merge.ts`), PUT on the
 *   revision just read, retry 409s with jitter, then record the answer as `base` and merge in saves
 *   that landed meanwhile. The server never merges.
 * - Unreadable, newer-format and blocked storage are reported, never overwritten.
 * - A 401 changes nothing locally: the work waits for the same account to sign in again.
 */
export class LedgerSyncEngine {
  readonly scope: AccountScope;
  readonly key: string;
  private readonly options: EngineOptions;
  private readonly listeners = new Set<() => void>();
  private state: LedgerSyncState;

  private database: Promise<LedgerDatabase> | null = null;
  private record: LedgerRecord | null = null;
  private loaded = false;
  private durable = true;
  private storageProblem: "unreadable" | "newerFormat" | null = null;
  private legacyUnreadable = false;
  private issue: SyncIssue | null = null;
  private sessionExpired = false;
  private syncing = false;
  private holding = false;
  private changedAt = 0;
  private lastDay: string;

  private started = false;
  private generation = 0;
  private running: Promise<void> | null = null;
  private followUp: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = 0;
  /** The delay of a retry that `beginSignOut` cancelled, so `cancelSignOut` can schedule it again. */
  private heldRetry: number | null = null;
  private backoffStep = 0;
  /** `pendingChanges` of the last record seen, keyed by identity: emits that don't change the record reuse it. */
  private pendingOf: { record: LedgerRecord; summary: PendingSummary } | null = null;
  private syncWhenVisible = false;
  private channel: LedgerChannel | null = null;
  private detach: (() => void) | null = null;
  private persisted = false;

  constructor(options: EngineOptions) {
    this.options = options;
    this.scope = accountScope(options.server, options.email);
    this.key = recordKey(this.scope);
    this.lastDay = this.today();
    this.state = this.snapshot();
  }

  // MARK: observation

  getState = (): LedgerSyncState => this.state;

  /** The server revision the stored base was read or written at (null before the first sync of an imported copy). */
  get baseRevision(): number | null {
    return this.record?.baseRevision ?? null;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private snapshot(): LedgerSyncState {
    const record = this.record;
    let pending = NOTHING_PENDING;
    if (record) {
      if (this.pendingOf?.record !== record) this.pendingOf = { record, summary: pendingChanges(record.base, record.local) };
      pending = this.pendingOf.summary;
    }
    return {
      phase: this.phase(pending),
      issue: this.issue,
      ledger: record?.local ?? null,
      pending,
      lastSyncedAt: record?.lastSyncedAt ?? null,
      durable: this.durable,
      legacyUnreadable: this.legacyUnreadable,
      changedAt: this.changedAt,
    };
  }

  private phase(pending: PendingSummary): SyncPhase {
    if (this.storageProblem === "newerFormat") return "storageNewerFormat";
    if (this.storageProblem === "unreadable") return "storageUnreadable";
    if (this.sessionExpired) return "sessionExpired";
    if (!this.durable) return "storageUnavailable";
    if (!this.loaded) return "loading";
    if (this.syncing) return "syncing";
    if (this.issue?.kind === "offline") return "offline";
    if (this.issue) return "failed";
    if (!this.record) return "loading";
    return pending.count > 0 ? "pending" : "upToDate";
  }

  private emit() {
    this.state = this.snapshot();
    for (const listener of this.listeners) listener();
  }

  // MARK: lifecycle

  /** Opens storage, imports the legacy copy, shows what is stored and starts a sync. Safe to call again after `stop`. */
  start(): void {
    if (this.started) return;
    this.started = true;
    const generation = ++this.generation;
    this.channel = (this.options.channel ?? openLedgerChannel)((key) => {
      if (key === this.key && generation === this.generation) void this.reload(generation);
    });
    this.attachEvents(generation);
    void this.boot(generation);
  }

  /** Stops timers, listeners and the channel. Late answers from requests already sent are dropped. Stored data is untouched. */
  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.generation += 1;
    this.cancelRetry();
    this.heldRetry = null;
    this.detach?.();
    this.detach = null;
    this.followUp = null;
    this.channel?.close();
    this.channel = null;
    const database = this.database;
    this.database = null;
    void database?.then(
      (db) => {
        db.close();
      },
      () => undefined,
    );
  }

  private attachEvents(generation: number) {
    const target = this.options.events === undefined ? (typeof window === "undefined" ? null : { window, document }) : this.options.events;
    if (!target) return;
    const onOnline = () => {
      if (generation !== this.generation) return;
      this.backoffStep = 0;
      void this.sync();
    };
    const onOffline = () => {
      if (generation === this.generation) this.emit();
    };
    const onVisibility = () => {
      if (generation !== this.generation || target.document.visibilityState !== "visible") return;
      void this.becameVisible(generation);
    };
    target.window.addEventListener("online", onOnline);
    target.window.addEventListener("offline", onOffline);
    target.document.addEventListener("visibilitychange", onVisibility);
    this.detach = () => {
      target.window.removeEventListener("online", onOnline);
      target.window.removeEventListener("offline", onOffline);
      target.document.removeEventListener("visibilitychange", onVisibility);
    };
  }

  private async boot(generation: number) {
    const db = await this.db();
    if (generation !== this.generation) return;
    await this.importLegacy(db, generation);
    if (generation !== this.generation) return;
    await this.reload(generation);
    if (generation !== this.generation) return;
    this.loaded = true;
    this.emit();
    await this.catchUp(generation);
    if (generation === this.generation) void this.sync();
  }

  /** The durable database, or an in-memory stand-in (reads and syncs only) when the browser refuses storage. */
  private db(): Promise<LedgerDatabase> {
    this.database ??= this.options.openDatabase().catch(() => {
      this.durable = false;
      return new MemoryLedgerDatabase();
    });
    return this.database;
  }

  /** Another tab wrote, or this tab became visible: show what is stored now. */
  private async reload(generation: number) {
    let next: LedgerRecord | null;
    try {
      next = parseRecord(await (await this.db()).get(this.key), this.scope);
    } catch (error) {
      if (generation !== this.generation) return;
      this.noteStorageProblem(error);
      this.emit();
      return;
    }
    if (generation !== this.generation) return;
    this.storageProblem = null;
    if (this.loaded && this.record && next && !sameLedger(this.record.local, next.local)) this.changedAt = this.now().getTime();
    this.record = next;
    this.emit();
  }

  private async becameVisible(generation: number) {
    await this.reload(generation);
    if (this.today() !== this.lastDay) await this.catchUp(generation);
    if (generation !== this.generation) return;
    this.syncWhenVisible = false;
    void this.sync();
  }

  // MARK: legacy import

  /**
   * Imports the legacy web app's copy into IndexedDB. Idempotent and safe to interrupt: the copy is
   * read-only here, the import is one transaction, and the record remembers the copy's fingerprint
   * so a second run (another tab, a reload) imports nothing twice. If the record already exists,
   * the copy's own unsynced edits are merged onto it. The copy is removed only after a sync that
   * leaves nothing pending (`finishLegacy`).
   */
  private async importLegacy(db: LedgerDatabase, generation: number) {
    const copy = readLegacyCopy(this.options.legacyStorage, this.scope.email);
    if (generation !== this.generation) return;
    this.legacyUnreadable = copy.kind === "unreadable";
    if (copy.kind !== "readable") return;
    const now = this.now().toISOString();
    try {
      await db.update(this.key, (raw) => {
        let current: LedgerRecord | null;
        try {
          current = parseRecord(raw, this.scope);
        } catch {
          // Never import onto a copy that can't be read: the copy stays where it is.
          return { result: null };
        }
        if (current?.legacy?.fingerprint === copy.fingerprint) return { result: null };
        const legacy = { fingerprint: copy.fingerprint, importedAt: now };
        if (!current) {
          const record: LedgerRecord = {
            format: RECORD_FORMAT,
            server: this.scope.server,
            email: this.scope.email,
            baseRevision: null,
            base: copy.base,
            local: copy.local,
            lastSyncedAt: null,
            savedAt: now,
            legacy,
          };
          return { next: record, result: null };
        }
        const local = sameLedger(copy.base, copy.local) ? current.local : normalizeLedger(mergeLedger(copy.base, copy.local, current.local));
        return { next: { ...current, local, savedAt: now, legacy }, result: null };
      });
      this.broadcast();
    } catch {
      // Storage refused the import (for example, no space). The legacy copy is untouched and the
      // next start tries again; sign-out counts its pending edits meanwhile.
    }
  }

  /** After a clean sync: the server holds everything the legacy copy had, so the copy can go. */
  private async finishLegacy(generation: number) {
    const record = this.record;
    if (!record?.legacy || record.legacy.removedAt || pendingChanges(record.base, record.local).count > 0) return;
    const fingerprint = record.legacy.fingerprint;
    if (!removeLegacyCopy(this.options.legacyStorage, this.scope.email, fingerprint)) {
      // The copy changed since it was imported (the legacy app ran again here): import that too.
      const copy = readLegacyCopy(this.options.legacyStorage, this.scope.email);
      if (copy.kind === "readable" && copy.fingerprint !== fingerprint) {
        await this.importLegacy(await this.db(), generation);
        await this.reload(generation);
        // Runs after this sync ends and sends what the copy added.
        void this.sync();
      }
      return;
    }
    const removedAt = this.now().toISOString();
    try {
      const updated = await (
        await this.db()
      ).update(this.key, (raw) => {
        const current = parseRecord(raw, this.scope);
        if (!current?.legacy || current.legacy.fingerprint !== fingerprint) return { result: current };
        const next = { ...current, legacy: { ...current.legacy, removedAt } };
        return { next, result: next };
      });
      if (generation === this.generation) this.record = updated;
    } catch {
      // Only the bookkeeping failed; the copy is gone and the record is unchanged.
    }
  }

  /** Moves an unreadable legacy copy aside so it no longer blocks sign-out. */
  setLegacyCopyAside(): void {
    setLegacyCopyAside(this.options.legacyStorage, this.scope.email, this.now().toISOString());
    this.legacyUnreadable = false;
    this.emit();
  }

  // MARK: saving

  /**
   * Applies `change` to this browser's copy, records due recurring entries, and writes it to
   * storage before resolving. Throws `LedgerSaveError` when nothing was kept. A sync starts after.
   */
  async save(change: LedgerChange): Promise<SaveReceipt> {
    if (!this.started || this.holding) throw new LedgerSaveError("unavailable");
    if (this.storageProblem === "newerFormat") throw new LedgerSaveError("storageNewerFormat");
    if (this.storageProblem === "unreadable") throw new LedgerSaveError("storageUnreadable");
    const generation = this.generation;
    const db = await this.db();
    if (!this.durable) throw new LedgerSaveError("storageUnavailable");
    const today = this.today();
    let saved: LedgerRecord;
    try {
      saved = await db.update(this.key, (raw) => {
        const current = parseRecord(raw, this.scope);
        if (!current) throw new LedgerSaveError("notLoaded");
        let local: Ledger;
        try {
          local = normalizeLedger(materialize(change(current.local), today));
        } catch (error) {
          throw new LedgerSaveError("rule", error instanceof Error ? error.message : undefined, { cause: error });
        }
        if (sameLedger(local, current.local)) return { result: current };
        const next: LedgerRecord = { ...current, local, savedAt: this.now().toISOString() };
        return { next, result: next };
      });
    } catch (error) {
      if (error instanceof LedgerSaveError) throw error;
      const problem = this.noteStorageProblem(error);
      if (problem) {
        this.emit();
        throw new LedgerSaveError(problem === "newerFormat" ? "storageNewerFormat" : "storageUnreadable", undefined, { cause: error });
      }
      throw new LedgerSaveError("writeFailed", error instanceof StorageError && error.failure === "quota" ? "This browser is out of storage space for Penny, so the change wasn't saved. Free up space, then try again. Your draft is still here." : undefined, { cause: error });
    }
    // The change is on disk for this account even if the session moved on meanwhile.
    if (generation === this.generation) {
      this.record = saved;
      this.lastDay = today;
      this.changedAt = this.now().getTime();
      this.emit();
      this.broadcast();
      this.persist();
      void this.sync();
    }
    // What is known now, without waiting for the sync this save started: the browser's network
    // state, and whether the server was unreachable on the last attempt while online. A previous
    // `offline` issue says nothing once the browser is back online (the sync just started covers it).
    return { savedOffline: !this.online() || this.issue?.kind === "serverUnreachable" };
  }

  /** Records recurring entries that fell due (after midnight, or on start). Writes only if something changed. */
  private async catchUp(generation: number) {
    if (!this.durable || this.storageProblem || this.holding) return;
    const today = this.today();
    try {
      const updated = await (
        await this.db()
      ).update(this.key, (raw) => {
        const current = parseRecord(raw, this.scope);
        if (!current) return { result: null };
        const local = normalizeLedger(materialize(current.local, today));
        if (sameLedger(local, current.local)) return { result: null };
        const next: LedgerRecord = { ...current, local, savedAt: this.now().toISOString() };
        return { next, result: next };
      });
      if (generation !== this.generation) return;
      this.lastDay = today;
      if (updated) {
        this.record = updated;
        this.changedAt = this.now().getTime();
        this.emit();
        this.broadcast();
      }
    } catch (error) {
      // A failed catch-up is repeated by the next save or sync, which materialize too.
      if (generation === this.generation && this.noteStorageProblem(error)) this.emit();
    }
  }

  // MARK: sync

  /**
   * Starts a sync. If one is running, one more runs after it (requests made meanwhile share it), so
   * the returned promise always covers a sync that started after the call: a Retry after
   * reconnecting never just joins the attempt that failed. Never rejects; failures are in `state.issue`.
   */
  sync(): Promise<void> {
    if (!this.started) return Promise.resolve();
    if (this.running) {
      this.followUp ??= this.running.then(() => {
        this.followUp = null;
        return this.sync();
      });
      return this.followUp;
    }
    const generation = this.generation;
    const run = (this.options.lock ?? withLock)(`penny-ledger-sync:${this.key}`, () => this.syncLoop(generation)).finally(() => {
      if (this.running === run) this.running = null;
    });
    this.running = run;
    return run;
  }

  /** Retry: runs now even if the browser reports no network, and resets the backoff. */
  syncNow(): Promise<void> {
    this.backoffStep = 0;
    return this.sync();
  }

  private async syncLoop(generation: number) {
    if (generation !== this.generation || this.holding || this.storageProblem || this.sessionExpired) return;
    this.cancelRetry();
    this.syncing = true;
    this.emit();
    try {
      let more = true;
      for (let pass = 0; pass < MAX_PASSES && more; pass += 1) {
        more = await this.pass(generation);
        if (generation !== this.generation) return;
      }
      this.issue = null;
      if (more) {
        // Saves (here or in another tab) kept landing during every pass. Nothing failed, so no
        // issue is shown, but the rest must not wait for an unrelated trigger: try again after the
        // backoff, which grows if this keeps happening.
        this.scheduleRetry(this.nextBackoff());
      } else {
        this.backoffStep = 0;
        await this.finishLegacy(generation);
      }
    } catch (error) {
      if (generation === this.generation) this.fail(error);
    } finally {
      if (generation === this.generation) {
        this.syncing = false;
        this.emit();
      }
    }
  }

  /** One read–merge–write round trip. Returns whether changes are still pending (saved while it ran). */
  private async pass(generation: number): Promise<boolean> {
    const db = await this.db();
    const start = parseRecord(await db.get(this.key), this.scope);
    let remote = await this.options.api.get();
    if (generation !== this.generation) return false;
    const pending = start !== null && !sameLedger(start.base, start.local);
    let answer: ServerSnapshot;
    for (let attempt = 1; ; attempt += 1) {
      const today = this.today();
      const merged = normalizeLedger(materialize(pending ? mergeLedger(start.base, start.local, remote.ledger) : remote.ledger, today));
      if (sameLedger(merged, remote.ledger)) {
        answer = remote;
        break;
      }
      try {
        answer = await this.options.api.put({ revision: remote.revision, ledger: merged });
        break;
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 409) throw error;
        if (attempt >= CONFLICT_DELAYS.length + 1) throw new ConflictRetriesExhausted();
        const delay = CONFLICT_DELAYS[attempt - 1] ?? 1600;
        await (this.options.sleep ?? defaultSleep)(delay * (1 + (this.options.random ?? Math.random)() * 0.5));
        if (generation !== this.generation) return false;
        remote = await this.options.api.get();
        if (generation !== this.generation) return false;
      }
    }
    if (generation !== this.generation) return false;

    const syncedAt = this.now().toISOString();
    const previousBase = this.record?.base ?? null;
    const outcome = await db.update(this.key, (raw): { next?: LedgerRecord; result: LedgerRecord | null } => {
      const current = parseRecord(raw, this.scope);
      if (!current) {
        // Removed meanwhile (sign-out in another tab): never recreate it.
        if (start) return { result: null };
        const record: LedgerRecord = {
          format: RECORD_FORMAT,
          server: this.scope.server,
          email: this.scope.email,
          baseRevision: answer.revision,
          base: answer.ledger,
          local: answer.ledger,
          lastSyncedAt: syncedAt,
          savedAt: syncedAt,
        };
        return { next: record, result: record };
      }
      // Another tab already recorded a newer server ledger; this answer is older. Keep theirs.
      if (current.baseRevision !== null && current.baseRevision > answer.revision) return { result: current };
      // Saves that landed while this pass ran are merged on top of the answer and stay pending.
      const sent = start ? start.local : current.base;
      const local = sameLedger(current.local, sent) ? answer.ledger : normalizeLedger(mergeLedger(sent, current.local, answer.ledger));
      const record: LedgerRecord = { ...current, baseRevision: answer.revision, base: answer.ledger, local, lastSyncedAt: syncedAt };
      return { next: record, result: record };
    });
    if (generation !== this.generation) return false;
    if (!outcome) {
      this.record = null;
      this.emit();
      return false;
    }
    const changed = previousBase !== null && !sameLedger(previousBase, outcome.base);
    if (this.record && !sameLedger(this.record.local, outcome.local)) this.changedAt = this.now().getTime();
    this.record = outcome;
    this.loaded = true;
    this.emit();
    this.broadcast();
    this.options.onServerSnapshot?.({ revision: outcome.baseRevision ?? answer.revision, ledger: outcome.base }, changed);
    return !sameLedger(outcome.base, outcome.local);
  }

  private fail(error: unknown) {
    // Unusable or closed storage: reported as a storage state, never retried by a timer.
    if (this.noteStorageProblem(error)) return;
    if (error instanceof ApiError && error.status === 401) {
      this.sessionExpired = true;
      this.issue = null;
      this.emit();
      this.options.onSessionExpired?.();
      return;
    }
    this.issue = describeIssue(error, this.online());
    if (!this.issue.retries) return;
    if (this.issue.kind === "offline") return; // The `online` event resumes.
    this.scheduleRetry(this.nextBackoff());
  }

  private nextBackoff(): number {
    const delay = Math.min(BACKOFF_MAX, BACKOFF_FIRST * 2 ** this.backoffStep);
    this.backoffStep += 1;
    return delay;
  }

  private scheduleRetry(delay: number) {
    this.cancelRetry();
    const generation = this.generation;
    this.retryDelay = delay;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (generation !== this.generation) return;
      if (!this.visible()) {
        this.syncWhenVisible = true;
        return;
      }
      void this.sync();
    }, delay);
  }

  private cancelRetry() {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  /**
   * Records an unusable stored record (`RecordError`) or a connection closed for another tab's
   * upgrade as a storage state, and returns it (null when `error` was neither). A closed connection
   * shows as `storageNewerFormat` ("Penny was updated in another tab", Reload): this build can't reopen it.
   */
  private noteStorageProblem(error: unknown): "unreadable" | "newerFormat" | null {
    if (error instanceof RecordError) this.storageProblem = error.problem === "newerFormat" ? "newerFormat" : "unreadable";
    else if (error instanceof StorageError && error.failure === "closed") this.storageProblem = "newerFormat";
    else return null;
    return this.storageProblem;
  }

  /** Whether a retry is waiting for this tab to become visible (for tests and diagnostics). */
  get waitingForVisibility(): boolean {
    return this.syncWhenVisible;
  }

  /** Whether a retry timer is set (for tests and diagnostics). */
  get retryScheduled(): boolean {
    return this.retryTimer !== null;
  }

  // MARK: recovery

  /**
   * Sets an unreadable stored copy aside (kept under an `aside` key until the account is removed)
   * and downloads the ledger again. Changes that existed only in that copy can't be recovered.
   * A copy written by a newer version is never touched.
   */
  async recoverUnreadableStorage(): Promise<void> {
    if (this.storageProblem !== "unreadable") return;
    const db = await this.db();
    const raw = await db.get(this.key);
    await db.update(asideKey(this.scope, this.now().toISOString()), () => ({ next: raw ?? null, result: null }));
    await db.update(this.key, (current) => (JSON.stringify(current) === JSON.stringify(raw) ? { next: null, result: null } : { result: null }));
    this.storageProblem = null;
    this.record = null;
    await this.reload(this.generation);
    void this.sync();
  }

  // MARK: sign-out

  /** Unsynced changes for this account, read from storage (another tab may have saved). An unreadable copy counts as one. */
  async pendingCount(): Promise<number> {
    let count = 0;
    let importedFingerprint: string | undefined;
    try {
      const record = parseRecord(await (await this.db()).get(this.key), this.scope);
      if (record) count += pendingChanges(record.base, record.local).count;
      importedFingerprint = record?.legacy?.fingerprint;
    } catch (error) {
      if (error instanceof RecordError) count += 1;
    }
    const copy = readLegacyCopy(this.options.legacyStorage, this.scope.email);
    if (copy.kind === "unreadable") count += 1;
    else if (copy.kind === "readable" && copy.fingerprint !== importedFingerprint) count += pendingChanges(copy.base, copy.local).count;
    return count;
  }

  /** Holds saves and syncs (in this tab) and returns the pending count. Call `cancelSignOut` or `finishSignOut` next. */
  async beginSignOut(): Promise<number> {
    this.holding = true;
    // A sync already running finishes first; it may schedule a retry, which the hold then parks.
    await this.running;
    if (this.retryTimer !== null) this.heldRetry ??= this.retryDelay;
    this.cancelRetry();
    return this.pendingCount();
  }

  /** Sign-out didn't go ahead: lifts the hold, syncs what is pending and restores a retry the hold parked. */
  cancelSignOut(): void {
    this.holding = false;
    const held = this.heldRetry;
    this.heldRetry = null;
    if (this.state.pending.count > 0) void this.sync();
    else if (held !== null) this.scheduleRetry(held);
  }

  /**
   * The server session is gone: removes this account's copies from the browser (the record, records
   * set aside, and the legacy app's `localStorage` copies), but only if nothing became pending
   * meanwhile (another tab may have saved). Pending work is never removed here: like `pendingCount`,
   * a legacy copy with edits the record doesn't hold, or one that can't be read, stays.
   */
  async finishSignOut(): Promise<void> {
    const db = await this.db();
    const removed = await db.update(this.key, (raw): { next?: null; result: { imported: string | undefined } | null } => {
      let current: LedgerRecord | null;
      try {
        current = parseRecord(raw, this.scope);
      } catch {
        return { result: null };
      }
      if (current && !sameLedger(current.base, current.local)) return { result: null };
      return { ...(current ? { next: null } : {}), result: { imported: current?.legacy?.fingerprint } };
    });
    if (removed) {
      const storage = this.options.legacyStorage;
      const copy = readLegacyCopy(storage, this.scope.email);
      // The record held this copy and was clean, so the server has its edits; or the copy (an import
      // that storage refused) has nothing unsynced of its own.
      if (copy.kind === "readable" && (copy.fingerprint === removed.imported || pendingChanges(copy.base, copy.local).count === 0)) {
        removeLegacyCopy(storage, this.scope.email, copy.fingerprint);
      }
      removeLegacyAsideCopies(storage, this.scope.email);
      for (const key of await db.keys()) {
        if (isAsideKeyOf(this.scope, key)) await db.update(key, () => ({ next: null, result: null }));
      }
      this.broadcast();
    }
    this.stop();
  }

  // MARK: helpers

  private broadcast() {
    this.channel?.post(this.key);
  }

  private persist() {
    if (this.persisted) return;
    this.persisted = true;
    if (this.options.requestPersistence) {
      this.options.requestPersistence();
      return;
    }
    // Best effort: ask the browser not to evict Penny's storage under pressure.
    void (navigator as { storage?: Partial<StorageManager> }).storage?.persist?.().catch(() => false);
  }

  private online() {
    return this.options.online ? this.options.online() : typeof navigator === "undefined" || navigator.onLine;
  }

  private visible() {
    return this.options.visible ? this.options.visible() : typeof document === "undefined" || document.visibilityState !== "hidden";
  }

  private today() {
    return this.options.today ? this.options.today() : dateKey();
  }

  private now() {
    return this.options.now ? this.options.now() : new Date();
  }
}

function describeIssue(error: unknown, online: boolean): SyncIssue {
  if (error instanceof ConflictRetriesExhausted)
    return { kind: "conflictRetriesExhausted", retries: true, message: "Your ledger kept changing on another device. Penny will try again shortly." };
  if (error instanceof StorageError)
    return { kind: "storageWriteFailed", retries: true, message: "This browser couldn't record the sync. Penny will try again. Nothing was lost." };
  if (error instanceof IncompatibleLedgerError)
    return { kind: "incompatibleServerData", retries: false, message: "The server sent a ledger this version of Penny can't read. Reload the page to update Penny." };
  if (error instanceof ApiError) {
    if (error.status === 0)
      return online
        ? { kind: "serverUnreachable", retries: true, message: "Penny can't reach the server. Changes stay in this browser and sync when it's back." }
        : { kind: "offline", retries: true, message: "Changes are saved in this browser and sync when you're back online." };
    if (error.status === 429 || error.status >= 500)
      return { kind: "serverUnavailable", retries: true, message: "The server is busy or restarting. Penny will try again shortly." };
    if (error.status >= 200 && error.status < 300)
      return { kind: "incompatibleServerData", retries: false, message: "The server sent a ledger this version of Penny can't read. Reload the page to update Penny." };
    return { kind: "rejected", retries: false, message: `The server refused this sync: ${error.message} Your changes are kept in this browser.` };
  }
  return { kind: "unexpected", retries: true, message: "Sync stopped unexpectedly. Penny will try again shortly." };
}
