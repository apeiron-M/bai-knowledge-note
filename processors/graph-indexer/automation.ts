/**
 * The vault maintaining itself: derived documents written by the indexer.
 *
 * A processor is not only a read model. The host hands the factory an
 * `IProcessorHostModule` whose `client` is the full `IReactorClient` — the
 * same API the Switchboard's GraphQL mutations sit on. So when the indexer
 * observes a fact that IMPLIES a document should exist, it can create it,
 * server-side, replayably, without waiting for a human or an agent to
 * notice.
 *
 * First automation: a `CONTRADICTS` relationship between two notes is, by
 * the vault's own methodology, a tension — "unresolved contradictions
 * between knowledge claims" (AGENT.md). Recording the edge and forgetting
 * to open the tension was the most common `/health` finding. Now the edge
 * opens it:
 *
 *   ADD_RELATIONSHIP(a, b, "CONTRADICTS")
 *     → no OPEN or settled tension already covers {a, b}?
 *     → create `bai/tension` in the drive's `/ops` folder
 *         title "A" ⟂ "B", involvedRefs [a, b], observedBy "graph-indexer"
 *     → ADD_TENSION on every MoC that holds a or b as a CORE_IDEA
 *         (entry id = the tension document id, so the link is explicit)
 *
 * Deliberately NOT automated: resolving or dissolving. Which side is right
 * is a human judgement; the automation only makes sure the question is
 * asked, in the place the methodology says to ask it.
 *
 * ## Safety
 *
 * - Idempotent per unordered pair: an existing tension whose INVOLVES edges
 *   cover both notes — any status — suppresses a new one. A pair that is
 *   resolved and later re-contradicted is a human's call to reopen.
 * - Race-guarded in memory: `a→b` and `b→a` arriving in one batch share a
 *   pair key and produce one tension.
 * - Loop-free by construction: the automation creates a tension and MoC
 *   entries, never a `CONTRADICTS` relationship, so its own writes cannot
 *   re-trigger it. Its operations are still indexed like anyone else's.
 * - Detached from the cursor: `onOperations` fires and forgets; a write
 *   failure is logged and never stalls indexing.
 * - Server-only: the browser instance (Connect) never automates, or two
 *   hosts would each open a tension.
 * - Drive-scoped: `ProcessorFilter` has no drive dimension, so EVERY
 *   instance on the host receives every matching operation — a second
 *   vault, or a legacy drive the factory failed open for, sees this
 *   drive's CONTRADICTS too. Observed live: two instances, two tensions,
 *   one filed into the wrong drive. So the automation first reads its own
 *   drive's node tree and acts only when BOTH notes are members; the
 *   instance that owns the notes is the only one that writes.
 */
import type { Kysely } from "kysely";
import type { IReactorClient } from "@powerhousedao/reactor";
import type { PHDocument } from "document-model";
import {
  actions as tensionActions,
  utils as tensionUtils,
} from "document-models/tension";
import { actions as mocActions } from "document-models/moc";
import type { DB } from "./schema.js";

export const AUTOMATION_ACTOR = "graph-indexer";

/** Folder (top-level, by name) that tensions are filed under. */
export const TENSIONS_FOLDER_NAME = "ops";

export type AutomationLogger = {
  info: (message: string) => void;
  warn: (message: string, error?: unknown) => void;
};

export type TensionAutomationDeps = {
  driveId: string;
  client: Pick<IReactorClient, "get" | "execute" | "drives">;
  log?: AutomationLogger;
  /** Injectable clock for tests. */
  now?: () => string;
};

/** Unordered pair key — `a→b` and `b→a` are the same contradiction. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "for",
  "from", "by", "with", "without", "is", "are", "be", "been", "was", "were",
  "it", "its", "this", "that", "these", "those", "as", "than", "then", "when",
  "while", "if", "not", "no", "never", "always", "may", "must", "should",
  "can", "cannot", "will", "would", "every", "any", "all", "some", "none",
  "into", "over", "under", "about", "after", "before", "only", "also", "both",
  "each", "such", "via", "per", "does", "do", "did", "has", "have", "had",
  "comes", "come", "carries", "carry", "read", "reads", "uses", "use", "using",
]);

function significantWords(title: string | null): string[] {
  if (!title) return [];
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

function firstWords(title: string | null, id: string, max = 5): string {
  if (!title || title.trim() === "") return id.slice(0, 8);
  const words = title.trim().split(/\s+/);
  return words.length > max ? `${words.slice(0, max).join(" ")}…` : words.join(" ");
}

/**
 * A SHORT title for the tension document. A title is a label, not the
 * argument — the two claims in full go in the description. Best case names
 * what the disagreement is about (topics the notes share, else words their
 * titles share); worst case abbreviates both titles to their first words.
 */
export function tensionTitle(
  a: { id: string; title: string | null },
  b: { id: string; title: string | null },
  sharedTopics: string[] = [],
): string {
  const topics = sharedTopics.filter((t) => t.trim() !== "").slice(0, 2);
  if (topics.length > 0) return `Contradiction on ${topics.join(", ")}`;

  const wordsB = new Set(significantWords(b.title));
  const common = significantWords(a.title).filter((w) => wordsB.has(w));
  const unique = [...new Set(common)].slice(0, 2);
  if (unique.length > 0) return `Contradiction on ${unique.join(", ")}`;

  return `Contradiction: ${firstWords(a.title, a.id)} / ${firstWords(b.title, b.id)}`;
}

/**
 * The description carries what the title leaves out: both claims, in full
 * (each capped so a pair of long titles still reads as one paragraph), and
 * what a reader is expected to do about it.
 */
export function tensionDescription(
  a: { id: string; title: string | null },
  b: { id: string; title: string | null },
): string {
  const quote = (n: { id: string; title: string | null }) =>
    n.title && n.title.trim() !== ""
      ? `“${truncate(n.title.trim(), 140)}”`
      : `note ${n.id.slice(0, 8)}`;
  return (
    `${quote(a)} contradicts ${quote(b)}. ` +
    "Opened automatically from a CONTRADICTS link — resolve if one side is right, dissolve if both hold in different contexts."
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function tensionContent(
  a: { id: string; title: string | null },
  b: { id: string; title: string | null },
  observedAt: string,
): string {
  const line = (n: { id: string; title: string | null }) =>
    `- ${n.title ? n.title : "(untitled)"} — \`${n.id}\``;
  return [
    "## Involved claims",
    "",
    line(a),
    line(b),
    "",
    "## Why this exists",
    "",
    `A \`CONTRADICTS\` relationship was recorded between these two notes at ${observedAt}. ` +
      "The vault treats a recorded contradiction as an open question, not a fact to leave implicit: " +
      "until someone resolves or dissolves this tension, both claims stand and readers should see that they disagree.",
    "",
    "## How to close it",
    "",
    "- **Resolve** when one claim is correct: say which, and consider `SUPERSEDES` on the winner.",
    "- **Dissolve** when both are right in different scopes: state the boundary in each note's content.",
  ].join("\n");
}

type DriveNode = {
  id: string;
  kind: string;
  name: string;
  parentFolder: string | null;
};

export class TensionAutomation {
  private readonly pending = new Set<string>();
  private readonly log: AutomationLogger;
  private readonly now: () => string;

  constructor(
    private readonly db: Kysely<DB>,
    private readonly deps: TensionAutomationDeps,
  ) {
    this.log = deps.log ?? {
      info: (m) => console.log(`[GraphIndexer:automation] ${m}`),
      warn: (m, e) => console.warn(`[GraphIndexer:automation] ${m}`, e ?? ""),
    };
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  /**
   * A CONTRADICTS edge landed. Returns the created tension's id, or null
   * when nothing was created (already covered, in flight, or failed).
   */
  async onContradiction(
    sourceId: string,
    targetId: string,
  ): Promise<string | null> {
    if (!sourceId || !targetId || sourceId === targetId) return null;
    const key = pairKey(sourceId, targetId);
    if (this.pending.has(key)) return null;
    this.pending.add(key);
    try {
      const tree = await this.driveTree();
      if (!tree) return null; // cannot prove ownership → do not write
      const owned = tree.ids.has(sourceId) && tree.ids.has(targetId);
      if (!owned) return null; // another drive's notes; its instance acts

      if (await this.tensionExistsFor(sourceId, targetId)) {
        this.log.info(
          `contradiction ${key.slice(0, 17)}… already has a tension; nothing to do`,
        );
        return null;
      }
      const [a, b] = await this.notes(sourceId, targetId);
      const observedAt = this.now();
      const folderId = tree.folderId(TENSIONS_FOLDER_NAME);
      const title = tensionTitle(a, b, await this.sharedTopics(sourceId, targetId));
      const description = tensionDescription(a, b);

      const doc = tensionUtils.createDocument();
      doc.header.name = title;
      const created = await this.deps.client.drives.addFile(
        this.deps.driveId,
        doc as unknown as PHDocument,
        folderId ?? undefined,
      );
      const tensionId = created.header.id;

      await this.deps.client.execute(tensionId, "main", [
        tensionActions.createTension({
          title,
          description,
          content: tensionContent(a, b, observedAt),
          involvedRefs: [sourceId, targetId],
          observedAt,
          observedBy: AUTOMATION_ACTOR,
        }),
      ]);
      this.log.info(
        `opened tension ${tensionId.slice(0, 8)} for ${sourceId.slice(0, 8)} ⟂ ${targetId.slice(0, 8)}${folderId ? ` in /${TENSIONS_FOLDER_NAME}` : " at drive root (no /ops folder)"}`,
      );

      await this.attachToMocs(tensionId, [sourceId, targetId], description, observedAt);
      return tensionId;
    } catch (error) {
      this.log.warn(`could not open a tension for ${key}:`, error);
      return null;
    } finally {
      this.pending.delete(key);
    }
  }

  /** Does any indexed tension already involve BOTH notes? */
  private async tensionExistsFor(a: string, b: string): Promise<boolean> {
    const rows = await this.db
      .selectFrom("graph_edges")
      .innerJoin(
        "graph_nodes",
        "graph_nodes.document_id",
        "graph_edges.source_document_id",
      )
      .where("graph_edges.link_type", "=", "INVOLVES")
      .where("graph_edges.target_document_id", "in", [a, b])
      .where("graph_nodes.document_type", "=", "bai/tension")
      .select("graph_edges.source_document_id as tension_id")
      .select("graph_edges.target_document_id as note_id")
      .execute();
    const byTension = new Map<string, Set<string>>();
    for (const r of rows) {
      const set = byTension.get(r.tension_id) ?? new Set<string>();
      set.add(r.note_id);
      byTension.set(r.tension_id, set);
    }
    for (const set of byTension.values()) {
      if (set.has(a) && set.has(b)) return true;
    }
    return false;
  }

  private async notes(
    a: string,
    b: string,
  ): Promise<[{ id: string; title: string | null }, { id: string; title: string | null }]> {
    const rows = await this.db
      .selectFrom("graph_nodes")
      .where("document_id", "in", [a, b])
      .select(["document_id", "title"])
      .execute();
    const title = (id: string) =>
      rows.find((r) => r.document_id === id)?.title ?? null;
    return [
      { id: a, title: title(a) },
      { id: b, title: title(b) },
    ];
  }

  /** Topic names both notes carry — the best available name for what they disagree about. */
  private async sharedTopics(a: string, b: string): Promise<string[]> {
    try {
      const rows = await this.db
        .selectFrom("graph_topics")
        .where("document_id", "in", [a, b])
        .select(["document_id", "name"])
        .execute();
      const ofA = new Set(rows.filter((r) => r.document_id === a).map((r) => r.name));
      return [...new Set(rows.filter((r) => r.document_id === b && ofA.has(r.name)).map((r) => r.name))];
    } catch {
      return [];
    }
  }

  /**
   * This drive's node tree: the membership set (which documents are ours)
   * and a folder lookup. One read per event; null when the drive cannot be
   * read, in which case the caller must not write.
   */
  private async driveTree(): Promise<{
    ids: Set<string>;
    folderId: (name: string) => string | null;
  } | null> {
    try {
      const drive = await this.deps.client.get(this.deps.driveId);
      const nodes = (
        drive.state as unknown as { global?: { nodes?: DriveNode[] } }
      ).global?.nodes;
      if (!nodes) return null;
      return {
        ids: new Set(nodes.map((n) => n.id)),
        folderId: (name) =>
          nodes.find(
            (n) =>
              n.kind === "folder" &&
              n.name.toLowerCase() === name &&
              (n.parentFolder === null || n.parentFolder === undefined),
          )?.id ?? null,
      };
    } catch (error) {
      this.log.warn("could not read the drive tree:", error);
      return null;
    }
  }

  /**
   * Add the tension to every MoC that owns either note as a CORE_IDEA. The
   * entry id IS the tension document id, which makes the link navigable and
   * a repeat call a no-op.
   */
  private async attachToMocs(
    tensionId: string,
    noteIds: string[],
    description: string,
    addedAt: string,
  ): Promise<void> {
    const owners = await this.db
      .selectFrom("graph_edges")
      .where("link_type", "=", "CORE_IDEA")
      .where("target_document_id", "in", noteIds)
      .select("source_document_id")
      .distinct()
      .execute();
    for (const { source_document_id: mocId } of owners) {
      try {
        const moc = await this.deps.client.get(mocId);
        const tensions = (
          moc.state as unknown as {
            global?: { tensions?: Array<{ id: string }> };
          }
        ).global?.tensions;
        if (tensions?.some((t) => t.id === tensionId)) continue;
        await this.deps.client.execute(mocId, "main", [
          mocActions.addTension({
            id: tensionId,
            description,
            involvedRefs: noteIds,
            addedAt,
          }),
        ]);
        this.log.info(`noted tension ${tensionId.slice(0, 8)} on MoC ${mocId.slice(0, 8)}`);
      } catch (error) {
        this.log.warn(`could not add tension to MoC ${mocId}:`, error);
      }
    }
  }
}
