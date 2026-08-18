/**
 * Exhaustive reads of the reactor's relationship API.
 *
 * ## The upstream cap
 *
 * `IReactorClient.getOutgoingRelationships` cannot return more than 100
 * targets, and offers no way to ask for more. In
 * `@powerhousedao/reactor`:
 *
 * ```js
 * const targetIds = (await this.documentIndexer.getOutgoing(
 *   sourceId, [relationshipType], void 0, void 0, signal   // paging: void 0
 * )).results.map((rel) => rel.targetId);
 * return this.find({ ids: targetIds }, view, paging, signal);
 * ```
 *
 * `documentIndexer.getOutgoing` defaults to `limit = paging?.limit || 100`
 * and *does* return a usable `next()` / `nextCursor` — but the client
 * passes `void 0` for paging and discards both. The caller's own `paging`
 * reaches only `find()`, which then pages the already-truncated 100-item
 * id list. That is why the API reports `totalCount: 100` and
 * `hasNextPage: false`: from `findByIds`' point of view there really are
 * only 100 ids. No argument a caller can pass lifts the cap.
 *
 * This is especially damaging during a reindex, which deletes a
 * document's existing edges before writing back what it read — so a
 * truncated read becomes a truncated write, and running the "repair"
 * tool is what destroys data. A MoC with 430 core ideas kept 100.
 *
 * ## The workaround
 *
 * Read the other direction. An edge is the same row whichever end you
 * ask from, and the two directions have very different fan-out: a MoC
 * has 430 outgoing CORE_IDEA edges but each note has at most 5 incoming.
 * So when an outgoing read comes back saturated, the caller re-derives
 * that relationship type from the target side, where it fits under the
 * cap. Both endpoints would have to exceed 100 for this to lose an edge.
 *
 * The fallback is triggered by *observed* saturation rather than applied
 * unconditionally, so a drive with no oversized fan-out pays nothing —
 * which is why this bug stayed invisible on smaller vaults.
 */

/** The reactor's hard page size for relationship reads. */
export const RELATIONSHIP_PAGE_LIMIT = 100;

/**
 * A page is 100 rows, so this bounds one (document, type) pair at 100k
 * edges — far above anything real. It exists so a `next()` that never
 * advances fails loudly instead of hanging the reindex.
 */
export const MAX_RELATIONSHIP_PAGES = 1000;

export type RelationshipRow = { header?: { id?: string }; id?: string };

export type RelationshipPage = {
  results?: RelationshipRow[];
  next?: () => Promise<RelationshipPage>;
  nextCursor?: string;
};

/** Fetches one page; called again with a cursor if the API offers one. */
export type FetchRelationshipPage = (
  paging?: { cursor: string; limit: number },
) => Promise<RelationshipPage | undefined>;

export type CollectedIds = {
  /** Document ids, first-seen order, de-duplicated. */
  ids: string[];
  /**
   * The read ended exactly on a page boundary with no way to continue —
   * the signature of the upstream cap. The result is probably
   * incomplete and the caller should try the opposite direction.
   */
  saturated: boolean;
  /** The page cap was hit; the result is definitely incomplete. */
  truncated: boolean;
  pages: number;
};

function idOf(row: RelationshipRow): string | undefined {
  return row.header?.id ?? row.id;
}

/**
 * Walk a relationship read to exhaustion.
 *
 * Follows `next()` when present and falls back to re-fetching with
 * `nextCursor`, because the two layers of the reactor populate different
 * fields. De-duplicates: a paged read can repeat a row across a
 * boundary, and the caller feeds these into an `INSERT ... ON CONFLICT
 * DO UPDATE`, which Postgres rejects outright if the same conflict key
 * appears twice in one statement ("cannot affect row a second time") —
 * that would fail the whole batch, not one row.
 */
export async function collectRelationshipIds(
  fetchPage: FetchRelationshipPage,
  options: { maxPages?: number; pageLimit?: number } = {},
): Promise<CollectedIds> {
  const maxPages = options.maxPages ?? MAX_RELATIONSHIP_PAGES;
  const pageLimit = options.pageLimit ?? RELATIONSHIP_PAGE_LIMIT;

  const seen = new Set<string>();
  const ids: string[] = [];
  let page = await fetchPage();
  let pages = 0;
  let lastPageSize = 0;

  while (page) {
    const results = page.results ?? [];
    lastPageSize = results.length;
    // An empty page ends the walk even if a cursor is still offered, so
    // a server handing out empty pages forever cannot spin.
    if (results.length === 0) break;

    let added = 0;
    for (const row of results) {
      const id = idOf(row);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
      added += 1;
    }

    pages += 1;
    if (pages >= maxPages) {
      return { ids, saturated: false, truncated: true, pages };
    }
    // A page that repeats what we already have means the cursor is not
    // advancing — stop rather than loop on identical rows.
    if (added === 0) break;

    if (page.next) {
      page = await page.next();
    } else if (page.nextCursor) {
      page = await fetchPage({ cursor: page.nextCursor, limit: pageLimit });
    } else {
      page = undefined;
    }
  }

  // Ending flush on a page boundary with nothing further on offer is how
  // the upstream cap presents itself. A set that genuinely happens to be
  // a multiple of the page size is only mis-flagged into doing one extra
  // read from the other side, which is harmless.
  const saturated = lastPageSize === pageLimit && ids.length % pageLimit === 0;

  return { ids, saturated, truncated: false, pages };
}
