/**
 * Which documents belong to THIS processor's drive.
 *
 * The processor manager has no drive dimension: `ProcessorFilter` matches on
 * document type / scope / branch / id, and `OperationContext` carries no
 * driveId, so every instance of this processor is fed every drive's
 * operations. Without a membership gate each namespace ends up holding a
 * copy of every other vault on the server — measured locally as thirteen
 * namespaces (one per drive, twelve of them e2e leftovers) each indexing and
 * embedding the same 594 documents.
 *
 * Membership has one authoritative source and two live signals, all of
 * which this processor already receives:
 *
 *   1. the drive document's `state.global.nodes` — loaded once through the
 *      reactor client, and again (throttled) whenever the loaded set looks
 *      stale;
 *   2. `ADD_RELATIONSHIP (drive → document, "child")`, the containment edge
 *      the reactor writes in the document's own creation job — it arrives
 *      BEFORE the drive's `ADD_FILE`, in the same batch as the document's
 *      first state;
 *   3. `ADD_FILE` / `COPY_NODE` / `DELETE_NODE` on the drive document.
 *
 * Failure mode is deliberate: until the drive has been read successfully the
 * gate is OPEN (everything indexes, as before this module existed). A vault
 * that loses its index because its own drive could not be read for a moment
 * is far worse than a few foreign rows a reindex will prune.
 */

/** The subset of the reactor client the gate needs — kept narrow for tests. */
export type DriveReader = {
  get(identifier: string): Promise<unknown>;
};

export type DriveMembershipDeps = {
  driveId: string;
  /** Absent (unit tests, hosts without a client) → membership is unknown
   * and the gate stays open. */
  client?: DriveReader;
  /** Injectable clock (ms since epoch). */
  now?: () => number;
};

/** Minimum gap between two reads of the drive document. */
export const MEMBERSHIP_REFRESH_THROTTLE_MS = 5_000;

/** How many documents known to be another drive's are remembered; past it the memory starts again. */
export const MAX_REMEMBERED_FOREIGN = 50_000;

/** The reactor's relationship index, as far as membership needs it: who points at a document. */
type ContainmentIndex = {
  getIncoming(
    documentId: string,
    types?: string[],
  ): Promise<{ results: { sourceId: string; relationshipType?: string }[] }>;
};

/**
 * The reactor's relationship index behind a client, when the client is the in-process one: on the
 * client itself (a read half) or on its `read` (the facade). Null for clients without it.
 */
export function containmentIndexOf(client: unknown): ContainmentIndex | null {
  const holder = client as { documentIndexer?: unknown; read?: { documentIndexer?: unknown } } | null | undefined;
  for (const candidate of [holder?.documentIndexer, holder?.read?.documentIndexer]) {
    const index = candidate as Partial<ContainmentIndex> | undefined;
    if (index && typeof index.getIncoming === "function") return index as ContainmentIndex;
  }
  return null;
}

/** How the reactor labels its own containment relationship. */
export const CONTAINMENT_RELATIONSHIP_TYPE = "child";

type DriveNode = { id: string };

type MembershipSignal = {
  documentId: string;
  actionType: string;
  input: unknown;
};

export class DriveMembership {
  private ids: Set<string> | null = null;
  private lastReadMs = -Infinity;
  private inflight: Promise<void> | null = null;
  private warned = false;
  /** Documents the relationship index placed in another drive. */
  private readonly foreign = new Set<string>();

  constructor(private readonly deps: DriveMembershipDeps) {}

  get driveId(): string {
    return this.deps.driveId;
  }

  /** `true` once the drive document has been read at least once. */
  get known(): boolean {
    return this.ids !== null;
  }

  /** Snapshot of the loaded set (tests, diagnostics). */
  get size(): number {
    return this.ids?.size ?? 0;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /**
   * Learn membership from an operation BEFORE deciding whether to index it.
   * Call this for every operation in a batch first, then `has()` — the
   * containment edge and the document's initial state travel together.
   */
  observe({ documentId, actionType, input }: MembershipSignal): void {
    const i = (input ?? {}) as {
      id?: string;
      targetId?: string;
      sourceId?: string;
      relationshipType?: string;
    };
    if (
      actionType === "ADD_RELATIONSHIP" &&
      i.sourceId === this.deps.driveId &&
      i.relationshipType === CONTAINMENT_RELATIONSHIP_TYPE &&
      i.targetId
    ) {
      this.add(i.targetId);
      return;
    }
    if (
      actionType === "REMOVE_RELATIONSHIP" &&
      i.sourceId === this.deps.driveId &&
      i.relationshipType === CONTAINMENT_RELATIONSHIP_TYPE &&
      i.targetId
    ) {
      this.ids?.delete(i.targetId);
      return;
    }
    if (documentId !== this.deps.driveId) return;
    switch (actionType) {
      case "ADD_FILE":
      case "ADD_FOLDER":
        if (i.id) this.add(i.id);
        return;
      case "COPY_NODE":
        if (i.targetId) this.add(i.targetId);
        return;
      case "DELETE_NODE":
        if (i.id) this.ids?.delete(i.id);
        return;
      default:
        return;
    }
  }

  /**
   * Is `documentId` one of ours? Open (true) while the drive is unknown;
   * a miss on a known set triggers at most one throttled re-read before
   * answering `false`.
   */
  async has(documentId: string): Promise<boolean> {
    if (documentId === this.deps.driveId) return true;
    if (this.ids === null) await this.load();
    if (this.ids === null) return true;
    if (this.ids.has(documentId)) return true;
    if (this.foreign.has(documentId)) return false;
    // Every drive's operations reach every instance, so most misses are another vault's documents.
    // Ask the relationship index which drive holds this one: one indexed lookup, where re-reading
    // this drive costs a whole drive document per foreign operation, and since 6.2.3-dev.85 a write
    // waits for its processors, so that read sat inside every other vault's writes.
    const containers = await this.containersOf(documentId);
    if (containers && containers.length > 0) {
      if (containers.includes(this.deps.driveId)) {
        this.add(documentId);
        return true;
      }
      if (this.foreign.size >= MAX_REMEMBERED_FOREIGN) this.foreign.clear();
      this.foreign.add(documentId);
      return false;
    }
    // The index cannot tell (none reachable, or no containment edge): the throttled re-read.
    if (this.now() - this.lastReadMs >= MEMBERSHIP_REFRESH_THROTTLE_MS) {
      await this.load();
      if (this.ids.has(documentId)) return true;
    }
    return false;
  }

  /** The drives holding `documentId` by their containment edge; null when the index cannot be asked. */
  private async containersOf(documentId: string): Promise<string[] | null> {
    const index = containmentIndexOf(this.deps.client);
    if (!index) return null;
    try {
      const page = await index.getIncoming(documentId, [CONTAINMENT_RELATIONSHIP_TYPE]);
      return page.results
        .filter((r) => (r.relationshipType ?? CONTAINMENT_RELATIONSHIP_TYPE) === CONTAINMENT_RELATIONSHIP_TYPE)
        .map((r) => r.sourceId);
    } catch {
      return null;
    }
  }

  private add(id: string): void {
    // Learned signals are only trustworthy relative to a loaded set; with no
    // set we are open anyway, and a partial set built from live signals would
    // silently exclude every pre-existing document.
    this.ids?.add(id);
    this.foreign.delete(id);
  }

  /** Read the drive document; on failure keep whatever we had. */
  private async load(): Promise<void> {
    if (!this.deps.client) return;
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      this.lastReadMs = this.now();
      try {
        const drive = (await this.deps.client!.get(this.deps.driveId)) as {
          state?: { global?: { nodes?: DriveNode[] } };
        };
        const nodes = drive.state?.global?.nodes;
        if (!Array.isArray(nodes)) throw new Error("drive has no node list");
        const next = new Set<string>(nodes.map((n) => n.id));
        // Keep ids learned from live signals that the snapshot may not have
        // caught up with yet (the containment edge precedes ADD_FILE).
        if (this.ids) for (const id of this.ids) next.add(id);
        this.ids = next;
      } catch (error) {
        if (!this.warned) {
          this.warned = true;
          console.warn(
            `[GraphIndexer] Could not read drive ${this.deps.driveId} for membership — indexing everything until it can be read:`,
            error instanceof Error ? error.message : error,
          );
        }
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }
}
