/**
 * State → projection row, for every document type the graph indexes.
 *
 * The live processor (`index.ts`, from `context.resultingState`) and the
 * reindex mutation (`subgraphs/knowledge-graph/helpers/reindex.ts`, from a
 * fresh `reactorClient.get`) used to carry two copies of this mapping, and
 * they drifted more than once (MoC `created_at` was null on one path and set
 * on the other). One function, two callers, and a row looks the same however
 * it got there.
 *
 * ## What is indexed
 *
 *   - `bai/knowledge-note`  the atomic claims — the graph proper
 *   - `bai/moc`             maps of content — navigation over the graph
 *   - `bai/research-claim`  methodology claims — knowledge nodes with a
 *                           different provenance shape
 *   - `bai/tension`         an unresolved contradiction BETWEEN claims
 *   - `bai/observation`     a signal ABOUT the methodology or process
 *   - `powerhouse/scopeofwork`  a scope of work: envelopes (projects),
 *                           deliverables, milestones, contributors
 *   - `bai/wbs`             a work breakdown: the goal tree that delivers
 *                           one envelope
 *
 * Tensions and observations are meta-documents: they are indexed so that
 * search finds them and a note can show "involved in tension X", not so
 * that they count as knowledge. Scopes and work breakdowns are execution
 * documents: indexed so a search for "payments demo" finds the project that
 * delivers it and a note shows which project cites it (`CITES`), again
 * without counting as knowledge. `document_type` on the row lets every
 * consumer draw that line itself (`isKnowledgeNodeType`), and the orphan
 * predicate excludes all four — a tension or a scope has, by design,
 * nothing pointing at it.
 *
 * ## Conventions kept from the old mapping
 *
 * The frontend recognises MoCs by `note_type` starting with `MOC (` and by
 * `status === "MOC"`; that stays exactly as it was. The new kinds follow the
 * same pattern for `note_type` (`Tension (OPEN)`, `Observation (FRICTION)`,
 * `Claim (research)`, `Scope (IN_PROGRESS)`, `WBS (BLOCKED)`) so a badge can
 * render any node without knowing every type. `status` carries the
 * document's OWN lifecycle value for tensions and observations (OPEN /
 * RESOLVED / DISSOLVED, PENDING / PROMOTED / …) — real states a user filters
 * on that never collide with a note's. A scope's lifecycle (DRAFT,
 * IN_PROGRESS, DELIVERED, …) DOES collide with the note lifecycle, and a
 * DRAFT scope must not surface in "draft notes" or inflate STALE_NOTES, so
 * scopes and work breakdowns take a sentinel like MoCs — `SCOPE` / `WBS` —
 * and carry the real state in `note_type`. `nodesByStatus("SCOPE")` lists
 * every scope the way `("MOC")` lists every map.
 */
import type { DerivedLinkType } from "./link-types.js";
import type { ScopeOfWorkState } from "document-models/scope-of-work";
import type { WorkBreakdownStructureState } from "document-models/work-breakdown-structure";
import {
  envelopeList,
  goalProgress,
  goalSummary,
  renderScope,
  renderWbs,
  wbsPhase,
} from "./work-outline.js";

export const INDEXED_DOCUMENT_TYPES = [
  "bai/knowledge-note",
  "bai/moc",
  "bai/research-claim",
  "bai/tension",
  "bai/observation",
  "powerhouse/scopeofwork",
  "bai/wbs",
] as const;

export type IndexedDocumentType = (typeof INDEXED_DOCUMENT_TYPES)[number];

const INDEXED_DOCUMENT_TYPE_SET: ReadonlySet<string> = new Set<string>(
  INDEXED_DOCUMENT_TYPES,
);

export function isIndexedDocumentType(
  documentType: string | null | undefined,
): documentType is IndexedDocumentType {
  return documentType != null && INDEXED_DOCUMENT_TYPE_SET.has(documentType);
}

/**
 * Node kinds that ARE knowledge: they take part in orphan detection and in
 * the "every note has ≥ 2 connections" standard. Tensions and observations
 * are about the graph, not in it; scopes and work breakdowns use it.
 */
export const KNOWLEDGE_NODE_TYPES = [
  "bai/knowledge-note",
  "bai/moc",
  "bai/research-claim",
] as const;

export const KNOWLEDGE_NODE_TYPE_LIST: string[] = [...KNOWLEDGE_NODE_TYPES];

const KNOWLEDGE_NODE_TYPE_SET: ReadonlySet<string> = new Set<string>(
  KNOWLEDGE_NODE_TYPES,
);

export function isKnowledgeNodeType(
  documentType: string | null | undefined,
): boolean {
  return documentType != null && KNOWLEDGE_NODE_TYPE_SET.has(documentType);
}

/** A derived edge, reconciled from the owning document's state. */
export type DerivedEdge = {
  linkType: DerivedLinkType;
  targetId: string;
};

export type ProjectedNode = {
  title: string | null;
  description: string | null;
  note_type: string | null;
  status: string | null;
  content: string | null;
  author: string | null;
  source_origin: string | null;
  created_at: string | null;
  document_type: IndexedDocumentType;
  /** Topic names in document order (ids are assigned by the caller). */
  topics: string[];
  /** Edges implied by the document's own refs — see `DERIVED_LINK_TYPES`. */
  derivedEdges: DerivedEdge[];
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function strList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((item) =>
      typeof item === "string"
        ? item
        : item && typeof item === "object"
          ? ((item as Record<string, unknown>).name as string | undefined)
          : undefined,
    )
    .filter((name): name is string => typeof name === "string" && name !== "");
}

function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/**
 * The reducer-validated state, with every collection present. A document
 * that has only just been created may carry the model's initial state with
 * the arrays already there; anything older is complete by construction.
 */
function scopeFromGlobal(g: Record<string, unknown>): ScopeOfWorkState {
  return {
    title: str(g.title) ?? "",
    description: str(g.description) ?? "",
    status: (str(g.status) ?? "DRAFT") as ScopeOfWorkState["status"],
    deliverables: arr(g.deliverables),
    projects: arr(g.projects),
    roadmaps: arr(g.roadmaps),
    contributors: arr(g.contributors),
  };
}

function wbsFromGlobal(
  g: Record<string, unknown>,
): WorkBreakdownStructureState {
  return {
    projectRef: str(g.projectRef),
    owner: str(g.owner),
    goals: arr(g.goals),
    references: arr(g.references),
    sowRef: str(g.sowRef),
    sowProjectId: str(g.sowProjectId),
  };
}

/** The indexer sees one document at a time: no joins, ids stand alone. */
const NO_WBS = new Map<string, WorkBreakdownStructureState>();
const NO_TITLES = new Map<string, string>();

/**
 * Project a document's global state onto a `graph_nodes` row.
 *
 * `global` is the document's global scope (`state.global`), as either the
 * processor's parsed `resultingState` or `reactorClient.get(...).state`
 * yields it. Unknown types are the caller's job to filter out first — this
 * throws rather than guess a shape.
 */
export function projectNode(
  documentType: IndexedDocumentType,
  global: Record<string, unknown>,
): ProjectedNode {
  switch (documentType) {
    case "bai/knowledge-note": {
      const provenance = (global.provenance ?? undefined) as
        | { author?: string; sourceOrigin?: string; createdAt?: string }
        | undefined;
      return {
        title: str(global.title),
        description: str(global.description),
        note_type: str(global.noteType),
        status: str(global.status) ?? "DRAFT",
        content: str(global.content),
        author: str(provenance?.author),
        source_origin: str(provenance?.sourceOrigin),
        created_at: str(global.createdAt) ?? str(provenance?.createdAt),
        document_type: documentType,
        topics: strList(global.topics),
        derivedEdges: [],
      };
    }
    case "bai/moc":
      return {
        title: str(global.title),
        description: str(global.description),
        note_type: `MOC (${str(global.tier) ?? "TOPIC"})`,
        // Sentinel the frontend already keys on; a MoC has no note lifecycle.
        status: "MOC",
        content: str(global.orientation),
        author: null,
        source_origin: null,
        created_at: str(global.createdAt),
        document_type: documentType,
        topics: [],
        derivedEdges: [],
      };
    case "bai/research-claim":
      return {
        title: str(global.title),
        description: str(global.description),
        note_type: `Claim (${str(global.kind) ?? "research"})`,
        // Research claims have no lifecycle; they are established by
        // construction. CANONICAL keeps "what is settled?" filters honest.
        status: "CANONICAL",
        content: str(global.content),
        author: null,
        // The methodology corpus is imported material, never authored here.
        source_origin: "IMPORT",
        created_at: null,
        document_type: documentType,
        topics: strList(global.topics),
        derivedEdges: [],
      };
    case "bai/tension": {
      const involved = strList(global.involvedRefs);
      const status = str(global.status) ?? "OPEN";
      return {
        title: str(global.title),
        description: str(global.description),
        note_type: `Tension (${status})`,
        status,
        content: str(global.content),
        author: str(global.observedBy),
        source_origin: null,
        created_at: str(global.observedAt),
        document_type: documentType,
        topics: [],
        derivedEdges: involved.map((targetId) => ({
          linkType: "INVOLVES",
          targetId,
        })),
      };
    }
    case "bai/observation": {
      const status = str(global.status) ?? "PENDING";
      const promotedTo = str(global.promotedTo);
      return {
        title: str(global.title),
        description: str(global.description),
        note_type: `Observation (${str(global.category) ?? "PROCESS"})`,
        status,
        content: str(global.content),
        author: str(global.observedBy),
        source_origin: null,
        created_at: str(global.observedAt),
        document_type: documentType,
        topics: [],
        derivedEdges: promotedTo
          ? [{ linkType: "PROMOTED_TO", targetId: promotedTo }]
          : [],
      };
    }
    case "powerhouse/scopeofwork": {
      const scope = scopeFromGlobal(global);
      // One edge per (type, target) however many envelopes share a ref.
      const seen = new Set<string>();
      const derivedEdges: DerivedEdge[] = [];
      for (const env of scope.projects) {
        const refs: DerivedEdge[] = [
          ...(env.wbsRef
            ? [{ linkType: "DELIVERED_BY" as const, targetId: env.wbsRef }]
            : []),
          ...envelopeList(env, "knowledgeRefs").map((targetId) => ({
            linkType: "CITES" as const,
            targetId,
          })),
        ];
        for (const e of refs) {
          const key = `${e.linkType}:${e.targetId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          derivedEdges.push(e);
        }
      }
      return {
        title: str(scope.title),
        description: str(scope.description),
        note_type: `Scope (${scope.status})`,
        // Sentinel, like MoCs — see the file comment for why not the real
        // lifecycle value.
        status: "SCOPE",
        // The outline is the searchable body: deliverable titles, owners,
        // milestones and contributors all live in arrays otherwise.
        content: renderScope({
          id: "",
          scope,
          wbsById: NO_WBS,
          noteTitles: NO_TITLES,
        }).text,
        author: null,
        source_origin: null,
        created_at: null,
        document_type: documentType,
        topics: [],
        derivedEdges,
      };
    }
    case "bai/wbs": {
      const wbs = wbsFromGlobal(global);
      const progress = goalProgress(wbs.goals);
      return {
        // A work breakdown has no title of its own; the envelope it delivers
        // names it in the editor and the chat. From state alone, say what
        // it is and how far along.
        title: `Work breakdown${wbs.owner ? ` — ${wbs.owner}` : ""} (${progress.completed}/${progress.total} goals done)`,
        description: goalSummary(wbs.goals),
        note_type: `WBS (${wbsPhase(wbs.goals)})`,
        status: "WBS",
        content: renderWbs(wbs, { id: "" }).text,
        author: str(wbs.owner),
        source_origin: null,
        created_at: null,
        document_type: documentType,
        topics: [],
        // The scope owns the scope↔WBS edge (`DELIVERED_BY`): the editor
        // links both ways, and one owner keeps the pair from doubling.
        derivedEdges: [],
      };
    }
  }
}
