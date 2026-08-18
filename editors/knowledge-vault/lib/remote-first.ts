/**
 * Remote-first mode: route the vault's document reads and writes to the
 * Switchboard instead of the browser replica.
 *
 * ## Why
 *
 * Connect's default worker reactor replicates every document in the
 * drive into PGlite-on-IndexedDB. For this vault (1,500+ docs, ~26k
 * operations) that replica serialises past Chrome's hard 127 MiB
 * per-IndexedDB-value limit, so persistence fails forever, sync never
 * converges, and the UI drowns in `Document not found` retries. The
 * app's list/search/graph views already read from the server-side
 * subgraph — the replica's only remaining jobs were per-document editor
 * reads and dispatches, which this module reroutes.
 *
 * ## How
 *
 * Two swaps, both using upstream-supported globals, both reversible on
 * unmount so other drives in the same Connect session are untouched:
 *
 * 1. **Reads** — `setDocumentCache(new GraphQLClientDocumentCache())`.
 *    Every `useDocument`-based hook (all ten document editors included)
 *    then fetches document state from the Switchboard. The cache
 *    refetches whenever a `MutateDocument` window event announces a
 *    change.
 *
 * 2. **Writes** — `setReactorClient(hybrid)`, where `hybrid` delegates
 *    everything to the original worker client EXCEPT `get`, `execute`,
 *    `getOperations` and `deleteDocument`, which it routes to a
 *    `GraphQLReactorClient` for every document other than the drive
 *    itself. `queueActions` — the single funnel all editor dispatches go
 *    through — resolves `window.ph.reactorClient` at dispatch time, so
 *    this one swap redirects every editor's writes with no per-editor
 *    changes.
 *
 * The drive document deliberately stays on the worker client: the
 * companion sync-scoping in `use-remote-first.ts` filters the drive's
 * sync channel down to just the drive document, so the local tree stays
 * live (and instant) while the corpus never replicates.
 *
 * NOT a global mode switch: `GraphQLReactorClient` implements only the
 * document surface (`get`/`execute`/`create`/`deleteDocument`/
 * `getOperations`/`subscribe`) — the shell's drive management, package
 * loading and sync-status plumbing still need the worker client, which
 * is why this is a delegating hybrid rather than a wholesale
 * replacement.
 */
import {
  GraphQLReactorClient,
  addPromiseState,
  setDocumentCache,
  setReactorClient,
  createClient,
} from "@powerhousedao/reactor-browser";
import type {
  IDocumentCache,
  IReactorBrowserClient,
} from "@powerhousedao/reactor-browser";
import type { PHDocument } from "document-model";
import { announceDocumentMutation } from "./remote-reactor.js";

/**
 * The `window.ph` slots this module swaps. `getGlobal`'s key union lags
 * the runtime (these slots are written by `setReactorClient` /
 * `setDocumentCache` but missing from `PowerhouseGlobal`), so read them
 * through a local view of the ambient global instead.
 */
type PHSlots = {
  reactorClient?: IReactorBrowserClient;
  documentCache?: IDocumentCache;
};

function phSlots(): PHSlots {
  return ((window as unknown as { ph?: PHSlots }).ph ?? {});
}

type AnyClient = Record<string | symbol, unknown>;

export type RemoteFirstHandle = {
  /** Restore the original client + cache (other drives unaffected). */
  restore: () => void;
  /** The GraphQL client used for remote document reads/writes. */
  remoteClient: GraphQLReactorClient;
};

let active: { driveId: string; handle: RemoteFirstHandle } | null = null;

/**
 * Silence one known-benign upstream crash: Connect's Sentry integration
 * bundles web-vitals, whose `reportAllChanges` reads `startTime` off a
 * performance entry that can legitimately be missing (hidden tabs,
 * automation, bfcache). It throws as an UNCAUGHT error on a timer —
 * outside any React boundary — and spams the console on every vault
 * session. Suppression is narrowly scoped to that exact signature;
 * everything else propagates untouched.
 */
let vitalsNoiseSuppressed = false;
function suppressSentryWebVitalsNoise(): void {
  if (vitalsNoiseSuppressed) return;
  vitalsNoiseSuppressed = true;
  window.addEventListener("error", (event) => {
    const message = event.message ?? "";
    const stack = (event.error as { stack?: string } | undefined)?.stack ?? "";
    if (
      message.includes("reading 'startTime'") &&
      stack.includes("reportAllChanges")
    ) {
      event.preventDefault();
    }
  });
}

/**
 * A concurrency-capped, server-backed document cache.
 *
 * Why not upstream's `GraphQLClientDocumentCache`:
 *
 *  1. Its fetcher issues ONE uncapped HTTP request per document id.
 *     Connect's generic drive explorer calls `useDocumentsInSelectedDrive`
 *     — all 1,540 ids at once — which exhausted the browser's request
 *     pool (`net::ERR_INSUFFICIENT_RESOURCES`) and took every other
 *     query down with it. This cache runs at most
 *     {@link FETCH_CONCURRENCY} requests in flight.
 *
 *  2. Its fetch transform (`phDocumentHeaderFromQuery`) omits
 *     `header.revision`, which Connect's editor wrapper reads unguarded
 *     (`document.header.revision.global`). This cache fetches through
 *     `GraphQLReactorClient.get`, whose transform populates the revision
 *     map from `revisionsList`.
 *
 * Contract-compatible with `IDocumentCache`: promises carry the
 * `status`/`value` bookkeeping React's `use()` relies on (via
 * `addPromiseState`), and `MutateDocument` window events invalidate and
 * refetch, notifying subscribers.
 */
const FETCH_CONCURRENCY = 8;

/** Retries per document read for transient transport failures. */
const FETCH_RETRIES = 3;

/**
 * Errors worth retrying: connection resets and timeouts from the
 * reactor's internal gateway hop (`/graphql` → `/graphql/r`), which
 * shows up under host memory pressure. A rejection like
 * "Document not found" is deterministic and must NOT be retried.
 */
function describeError(error: unknown): string {
  if (error == null) return "";
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "number" || typeof error === "boolean") {
    return String(error);
  }
  // Objects reaching here would stringify as "[object Object]", which
  // would silently defeat the pattern match below.
  try {
    return JSON.stringify(error) ?? "";
  } catch {
    return "";
  }
}

function isTransientFetchError(error: unknown): boolean {
  const message = describeError(error);
  return /ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket hang up|network|Failed to fetch|INSUFFICIENT_RESOURCES|terminated/i.test(
    message,
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run an async read with backoff on transient transport failures
 * (connection resets from the reactor's internal gateway hop under
 * host load). Deterministic failures propagate immediately.
 */
export async function withTransientRetry<T>(
  task: () => Promise<T>,
  attempts = 3,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (!isTransientFetchError(error)) break;
      await delay(300 * (attempt + 1));
    }
  }
  throw lastError;
}

/**
 * A promise that is ALREADY fulfilled as far as React's `use()` is
 * concerned. `addPromiseState` marks a promise "pending" synchronously
 * and only flips to "fulfilled" in a `.then` microtask, so handing a
 * freshly-resolved promise to `use()` still suspends for one render —
 * which unmounts the subtree to the Suspense fallback. Stamping the
 * state up front makes a background revalidation invisible.
 */
function fulfilledPromiseState<T>(value: T): ReturnType<typeof addPromiseState<T>> {
  const promise = Promise.resolve(value) as Promise<T> & {
    status?: string;
    value?: T;
  };
  promise.status = "fulfilled";
  promise.value = value;
  return promise as ReturnType<typeof addPromiseState<T>>;
}

/**
 * Identity of a document *version*, used to decide whether a
 * revalidation actually changed anything. When it didn't, we skip the
 * cache swap and the notify entirely, so a poll on an idle document
 * costs zero renders.
 */
function versionKey(doc: PHDocument): string {
  const header = (doc as { header?: Record<string, unknown> }).header ?? {};
  return JSON.stringify([header.revision ?? null, header.lastModifiedAtUtcIso ?? null]);
}

class VaultDocumentCache implements IDocumentCache {
  private documents = new Map<string, ReturnType<typeof addPromiseState<PHDocument>>>();
  private listeners = new Map<string, Set<() => void>>();
  private queue: Array<() => void> = [];
  private inFlight = 0;
  /** Ids with a background revalidation already running. */
  private revalidating = new Set<string>();
  /**
   * Batch promises must be IDENTITY-STABLE across renders: `useDocuments`
   * passes them straight into React's `use()`, which treats a fresh
   * promise per render as "suspended by an uncached promise" and
   * replays forever. Keyed by the id list; reused while every per-id
   * promise is unchanged (mirrors upstream `GraphQLClientDocumentCache`).
   */
  private batchPromises = new Map<
    string,
    {
      parts: Array<Promise<PHDocument>>;
      promise: ReturnType<typeof addPromiseState<PHDocument[]>>;
    }
  >();

  constructor(private fetchDocument: (id: string) => Promise<PHDocument>) {
    const onMutated = (event: Event) => {
      const identifier = (event as CustomEvent<{ identifier?: string }>)
        .detail?.identifier;
      if (identifier && this.documents.has(identifier)) {
        void this.get(identifier, true);
      }
    };
    window.addEventListener("MutateDocument", onMutated);
    window.addEventListener("MutateDocumentAsync", onMutated);
  }

  /** Fetch with backoff so a transient reactor blip doesn't fail a pane. */
  private async fetchWithRetry(id: string): Promise<PHDocument> {
    let lastError: unknown;
    for (let attempt = 0; attempt < FETCH_RETRIES; attempt += 1) {
      try {
        return await this.fetchDocument(id);
      } catch (error) {
        lastError = error;
        if (!isTransientFetchError(error)) break;
        await delay(300 * (attempt + 1));
      }
    }
    throw lastError;
  }

  /** Run `task` when a concurrency slot frees up. */
  private schedule<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        this.inFlight += 1;
        task()
          .then(resolve, reject)
          .finally(() => {
            this.inFlight -= 1;
            const next = this.queue.shift();
            if (next) next();
          });
      };
      if (this.inFlight < FETCH_CONCURRENCY) run();
      else this.queue.push(run);
    });
  }

  get(id: string, refetch?: boolean) {
    const current = this.documents.get(id);
    if (current) {
      if (current.status === "pending" || !refetch) return current;
      // Stale-while-revalidate. Replacing a fulfilled entry with a fresh
      // pending promise makes every consumer of `use()` suspend, which
      // unmounts the open editor to the Suspense fallback and destroys
      // transient UI state (scroll position, an in-progress textarea).
      // Keep serving the resolved document and swap it in place only if
      // the server actually has a newer version.
      if (current.status === "fulfilled") {
        this.revalidate(id, current, current.value);
        return current;
      }
    }
    const promise = addPromiseState(
      this.schedule(() => this.fetchWithRetry(id)).then((doc) => {
        this.notify(id);
        return doc;
      }),
    );
    // Keep a rejected promise cached: getSnapshot must return a stable
    // value or React loops ("getSnapshot should be cached"). The entry
    // clears on the next explicit refetch or MutateDocument event.
    promise.catch(() => this.notify(id));
    this.documents.set(id, promise);
    return promise;
  }

  /**
   * Background freshness poll. Unlike `get(id, true)` this can NEVER
   * introduce a suspension: if nothing is cached yet, or the cached entry
   * is still pending, there is nothing on screen to refresh and we do
   * nothing at all. Only an already-resolved document is revalidated, and
   * that path swaps in place without handing React a pending promise.
   */
  revalidateInBackground(id: string): void {
    const current = this.documents.get(id);
    if (!current || current.status !== "fulfilled") return;
    this.revalidate(id, current, current.value);
  }

  getBatch(ids: string[]): Promise<PHDocument[]> {
    const key = ids.join(",");
    const parts = ids.map((id) => this.get(id));
    const cached = this.batchPromises.get(key);
    if (cached && parts.every((part, index) => part === cached.parts[index])) {
      return cached.promise;
    }
    // When every part is already resolved, publish a synchronously
    // fulfilled batch. Otherwise a background revalidation that changed
    // one document would hand `use()` a pending promise and suspend the
    // whole list — the same flash this class avoids for single documents.
    const resolved: PHDocument[] = [];
    let allFulfilled = true;
    for (const part of parts) {
      if (part.status === "fulfilled") resolved.push(part.value);
      else allFulfilled = false;
    }
    if (allFulfilled) {
      const settled = fulfilledPromiseState(resolved);
      this.batchPromises.set(key, { parts, promise: settled });
      return settled;
    }
    const promise = addPromiseState(
      Promise.allSettled(parts).then((results) => {
        const documents: PHDocument[] = [];
        for (const result of results) {
          if (result.status === "fulfilled") documents.push(result.value);
        }
        return documents;
      }),
    );
    this.batchPromises.set(key, { parts, promise });
    return promise;
  }

  subscribe(idOrIds: string | string[], callback: () => void): () => void {
    const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
    for (const id of ids) {
      let set = this.listeners.get(id);
      if (!set) {
        set = new Set();
        this.listeners.set(id, set);
      }
      set.add(callback);
    }
    return () => {
      for (const id of ids) this.listeners.get(id)?.delete(callback);
    };
  }

  /**
   * Fetch in the background and publish only on a real change. Failures
   * are swallowed: the last good document stays on screen and the next
   * tick tries again — a transient reactor blip must not blank a pane.
   */
  private revalidate(
    id: string,
    current: ReturnType<typeof addPromiseState<PHDocument>>,
    previous: PHDocument,
  ): void {
    if (this.revalidating.has(id)) return;
    this.revalidating.add(id);
    void this.schedule(() => this.fetchWithRetry(id))
      .then((doc) => {
        // Only supersede the entry we started from; a write that landed
        // mid-flight must win over this older read.
        if (this.documents.get(id) !== current) return;
        if (versionKey(previous) === versionKey(doc)) return;
        this.documents.set(id, fulfilledPromiseState(doc));
        this.batchPromises.clear();
        this.notify(id);
      })
      .catch(() => {
        /* keep the last good document */
      })
      .finally(() => {
        this.revalidating.delete(id);
      });
  }

  private notify(id: string): void {
    for (const callback of this.listeners.get(id) ?? []) {
      try {
        callback();
      } catch {
        /* a broken subscriber must not break the rest */
      }
    }
  }
}

/**
 * Methods rerouted to the GraphQL client. Each takes the document
 * identifier as its first argument — the routing contract this hybrid
 * depends on. The drive document is rerouted too: its local copy is a
 * stub (nothing syncs), while the server copy is always current.
 */
const REROUTED_METHODS = [
  "get",
  "execute",
  "getOperations",
  "deleteDocument",
  "create",
] as const;

/** Write-shaped methods that must announce the mutation to the cache. */
const ANNOUNCING_METHODS = new Set(["execute", "deleteDocument"]);

export function enableRemoteFirst(options: {
  endpoint: string;
  driveId: string;
  driveSlug?: string;
}): RemoteFirstHandle {
  // Re-entrant per drive: React StrictMode double-mounts effects, and
  // an editor remount must not stack proxies on top of proxies.
  if (active?.driveId === options.driveId) return active.handle;
  active?.handle.restore();

  suppressSentryWebVitalsNoise();
  const sdk = createClient(options.endpoint);
  const remoteClient = new GraphQLReactorClient({
    url: options.endpoint,
    graphqlClient: sdk,
  });

  const previousClient = phSlots().reactorClient;
  const previousCache = phSlots().documentCache;

  if (previousClient) {
    const worker = previousClient as unknown as AnyClient;
    const remote = remoteClient as unknown as AnyClient;

    const hybrid = new Proxy(worker, {
      get(target, prop, receiver) {
        if (
          (REROUTED_METHODS as readonly string[]).includes(prop as string)
        ) {
          return (...args: unknown[]) => {
            const identifier = args[0];
            const fn = remote[prop] as (...a: unknown[]) => unknown;
            const result = fn.apply(remote, args);
            if (
              ANNOUNCING_METHODS.has(prop as string) &&
              typeof identifier === "string" &&
              result instanceof Promise
            ) {
              // Announce after the server accepted the write so the
              // GraphQL document cache refetches for every subscriber.
              // `instanceof Promise` narrows `unknown` to `Promise<any>`,
              // so re-assert `unknown` to keep the return type safe.
              return (result as Promise<unknown>).then((value: unknown) => {
                announceDocumentMutation(identifier);
                return value;
              });
            }
            return result;
          };
        }
        const value = Reflect.get(target, prop, receiver);
        // Preserve `this` for pass-through methods on the worker client.
        if (typeof value === "function") {
          return (value as (...a: unknown[]) => unknown).bind(target);
        }
        return value;
      },
    });

    setReactorClient(hybrid as never);
  }

  setDocumentCache(
    new VaultDocumentCache((id) => remoteClient.get(id)),
  );

  const handle: RemoteFirstHandle = {
    remoteClient,
    restore: () => {
      if (previousClient) setReactorClient(previousClient);
      if (previousCache) setDocumentCache(previousCache);
      if (active?.driveId === options.driveId) active = null;
    },
  };
  active = { driveId: options.driveId, handle };
  return handle;
}
