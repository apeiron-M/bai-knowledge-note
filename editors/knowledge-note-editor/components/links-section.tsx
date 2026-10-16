import { useEffect, useMemo, useRef, useState } from "react";
import { useEventCallback } from "../../shared/use-event-callback.js";
import { setSelectedNode } from "@powerhousedao/reactor-browser";
import { useVaultDocIndex } from "../../shared/use-vault-doc-index.js";
import type { LinkType } from "document-models/knowledge-note";
import {
  CONFIDENCE_LABELS,
  EDGE_CONFIDENCE_LEVELS,
  isEdgeConfidence,
  type EdgeConfidence,
  type LinkArticulation,
} from "../../shared/edge-articulation.js";
import {
  candidateLabel,
  linkCandidates,
  linkedTargets,
  pastedIdMatch,
  searchCandidates,
  type LinkCandidate,
} from "../lib/link-targets.js";

// Links now come from the subgraph projection of DocumentRelationship
// rows, so the prop shape is the loose projection type, not the
// model-generated `NoteLink` (which is going away once Phase 5 lands).
type LinkRow = {
  id: string;
  targetDocumentId: string | null;
  targetTitle: string | null;
  linkType: string | null;
  /** The articulation stored on the edge; null when never given. */
  reason: string | null;
  confidence: string | null;
};

type LinksSectionProps = {
  links: LinkRow[];
  currentDocId: string;
  /** Add a link: a document of this vault, the kind of link, and why it exists. */
  onAddLink: (
    targetDocumentId: string,
    linkType: LinkType,
    articulation: LinkArticulation,
  ) => void;
  onRemoveLink: (id: string) => void;
  onUpdateLinkType: (id: string, linkType: LinkType) => void;
  /** Set or replace the edge's reason / confidence (UPDATE_RELATIONSHIP). */
  onArticulate: (id: string, articulation: LinkArticulation) => void;
  /**
   * Point a link at another document, its reason restated: REMOVE the old
   * pair and ADD the new one in one dispatch.
   */
  onChangeTarget: (
    id: string,
    targetDocumentId: string,
    articulation: LinkArticulation,
  ) => void;
};

const CONFIDENCE_COLORS: Record<EdgeConfidence, string> = {
  grounded: "text-[var(--bai-ok)]/80",
  established: "text-[var(--bai-status-review)]/80",
  speculative: "text-[var(--bai-warn)]/80",
};

const LINK_TYPES: LinkType[] = [
  "RELATES_TO",
  "BUILDS_ON",
  "CONTRADICTS",
  "SUPERSEDES",
  "DERIVED_FROM",
];
const LINK_TYPE_LABELS: Record<LinkType, string> = {
  RELATES_TO: "Relates to",
  BUILDS_ON: "Builds on",
  CONTRADICTS: "Contradicts",
  SUPERSEDES: "Supersedes",
  DERIVED_FROM: "Derived from",
};
const LINK_TYPE_COLORS: Record<LinkType, string> = {
  RELATES_TO: "bg-[var(--bai-hover)] text-[var(--bai-text-muted)]",
  BUILDS_ON:
    "bg-[var(--bai-status-review)]/15 text-[var(--bai-status-review)]",
  CONTRADICTS: "bg-[var(--bai-danger-soft)] text-[var(--bai-danger)]",
  SUPERSEDES: "bg-[var(--bai-accent-soft)] text-[var(--bai-accent)]",
  DERIVED_FROM: "bg-[var(--bai-warn-soft)] text-[var(--bai-warn)]",
};

/** Where a link may point: the vault's documents for a kind of link, and a pasted id. */
export type TargetFinder = {
  candidates: (linkType: LinkType) => LinkCandidate[];
  pasted: (query: string, linkType: LinkType) => LinkCandidate | null;
};

const kindOf = (link: LinkRow): LinkType => (link.linkType ?? "RELATES_TO") as LinkType;

type ResolvedTarget = { title: string; kind: string | null };

/**
 * The graph denormalises `targetTitle` onto the edge at link time, but only
 * for targets it indexes (knowledge notes and MoCs). A `DERIVED_FROM` edge
 * points at a `bai/source`, which is not indexed, so the edge carries no
 * title and the row used to show a bare id. The drive index resolves any
 * document to at least its node name, so fall back to that — and say what
 * kind of document it is when it is not a note, so a source reads as one.
 */
function resolveTarget(
  link: LinkRow,
  byId: Map<string, { title: string; documentType: string }>,
): ResolvedTarget {
  const doc = link.targetDocumentId
    ? byId.get(link.targetDocumentId)
    : undefined;
  const title =
    link.targetTitle || doc?.title || link.targetDocumentId || "Untitled";
  const type = doc?.documentType ?? null;
  const kind =
    type && type !== "bai/knowledge-note"
      ? type.replace(/^bai\//, "").replace(/-/g, " ")
      : null;
  return { title, kind };
}

export function LinksSection({
  links,
  currentDocId,
  onAddLink,
  onRemoveLink,
  onUpdateLinkType,
  onArticulate,
  onChangeTarget,
}: LinksSectionProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [editingLinkId, setEditingLinkId] = useState<string | null>(null);

  // Picker candidates from the lightweight index (subgraph + drive
  // tree) — real titles, no full-state loads.
  const { knowledgeDocs, byId } = useVaultDocIndex();
  // A target may not be one this note already links to with the same kind.
  const targets = useMemo<TargetFinder>(
    () => ({
      candidates: (linkType) =>
        linkCandidates({
          linkType,
          noteId: currentDocId,
          knowledgeDocs,
          byId,
          exclude: linkedTargets(links, linkType),
        }),
      pasted: (query, linkType) =>
        pastedIdMatch(query, {
          noteId: currentDocId,
          byId,
          exclude: linkedTargets(links, linkType),
        }),
    }),
    [currentDocId, knowledgeDocs, byId, links],
  );

  function handleAdd(
    targetId: string,
    linkType: LinkType,
    articulation: LinkArticulation,
  ) {
    onAddLink(targetId, linkType, articulation);
    setIsAdding(false);
  }

  if (links.length === 0 && !isAdding) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--bai-border)] p-4 text-center">
        <p className="mb-2 text-sm text-[var(--bai-text-muted)]">No linked notes yet</p>
        <button
          type="button"
          onClick={() => setIsAdding(true)}
          className="text-sm font-medium text-[var(--bai-accent)] hover:text-[var(--bai-accent)]/80"
        >
          + Add link
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {links.map((link) => (
        <LinkCard
          key={link.id}
          link={link}
          resolved={resolveTarget(link, byId)}
          isEditing={editingLinkId === link.id}
          targets={targets}
          onStartEdit={() => setEditingLinkId(link.id)}
          onCancelEdit={() => setEditingLinkId(null)}
          onUpdateLinkType={onUpdateLinkType}
          onRemoveLink={onRemoveLink}
          onArticulate={onArticulate}
          onChangeTarget={(targetId, articulation) => {
            onChangeTarget(link.id, targetId, articulation);
            setEditingLinkId(null);
          }}
        />
      ))}

      {isAdding ? (
        <AddLinkForm
          targets={targets}
          onAdd={handleAdd}
          onCancel={() => setIsAdding(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setIsAdding(true)}
          className="mt-3 w-full rounded-lg border border-dashed border-[var(--bai-border)] py-2.5 text-xs text-[var(--bai-text-muted)] hover:border-[var(--bai-accent)]/30 hover:text-[var(--bai-accent)]"
        >
          + Add link
        </button>
      )}
    </div>
  );
}

function LinkCard({
  link,
  resolved,
  isEditing,
  targets,
  onStartEdit,
  onCancelEdit,
  onUpdateLinkType,
  onRemoveLink,
  onArticulate,
  onChangeTarget,
}: {
  link: LinkRow;
  /** Display title and kind for the target, resolved beyond the graph's denormalised title. */
  resolved: ResolvedTarget;
  isEditing: boolean;
  targets: TargetFinder;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onUpdateLinkType: (id: string, linkType: LinkType) => void;
  onRemoveLink: (id: string) => void;
  onArticulate: (id: string, articulation: LinkArticulation) => void;
  onChangeTarget: (targetId: string, articulation: LinkArticulation) => void;
}) {
  const editRef = useRef<HTMLDivElement>(null);
  const [isArticulating, setIsArticulating] = useState(false);
  // The target picked, while the person says why the note links to it.
  const [newTarget, setNewTarget] = useState<LinkCandidate | null>(null);
  const confidence = isEdgeConfidence(link.confidence) ? link.confidence : null;

  // The parent supplies `onCancelEdit` as an inline arrow, so this
  // click-outside listener was re-subscribed on every render — once per link
  // card on the page. Leaving also drops a target picked but not saved.
  const cancelEdit = useEventCallback(() => {
    setNewTarget(null);
    onCancelEdit();
  });
  useEffect(() => {
    if (!isEditing) return;
    function handleClickOutside(e: MouseEvent) {
      if (editRef.current && !editRef.current.contains(e.target as Node)) {
        cancelEdit();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isEditing, cancelEdit]);

  if (isEditing) {
    const kind = kindOf(link);
    return (
      <div
        ref={editRef}
        className="rounded-lg border border-[var(--bai-accent)]/20 bg-[var(--bai-accent-soft)] p-2"
      >
        {newTarget ? (
          <RetargetReason
            target={newTarget}
            initial={{ reason: link.reason ?? "", confidence }}
            onSave={(articulation) => {
              onChangeTarget(newTarget.id, articulation);
              setNewTarget(null);
            }}
            onCancel={cancelEdit}
          />
        ) : (
          <>
            <p className="mb-1.5 text-[10px] font-medium uppercase text-[var(--bai-text-muted)]">
              Change target document
            </p>
            <DocumentSearch
              candidates={targets.candidates(kind)}
              pasted={(q) => targets.pasted(q, kind)}
              noun={kind === "DERIVED_FROM" ? "sources" : "notes"}
              onSelect={setNewTarget}
              onCancel={cancelEdit}
              autoFocus
            />
          </>
        )}
      </div>
    );
  }

  return (
    <div className="group rounded-lg border border-[var(--bai-border)] bg-[var(--bai-deep)] px-3 py-2">
    <div className="flex items-center gap-2">
      <select
        value={link.linkType ?? "RELATES_TO"}
        aria-label={`Link type, ${LINK_TYPE_LABELS[(link.linkType ?? "RELATES_TO") as LinkType]}`}
        onChange={(e) => onUpdateLinkType(link.id, e.target.value as LinkType)}
        className={`rounded-md border border-[var(--bai-border)] px-2 py-0.5 text-xs font-medium ${LINK_TYPE_COLORS[(link.linkType ?? "RELATES_TO") as LinkType] ?? ""} bg-transparent`}
      >
        {LINK_TYPES.map((lt) => (
          <option key={lt} value={lt}>
            {LINK_TYPE_LABELS[lt]}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => {
          if (link.targetDocumentId) setSelectedNode(link.targetDocumentId);
        }}
        className="flex-1 truncate text-left text-sm text-[var(--bai-text-secondary)] hover:text-[var(--bai-accent)] hover:underline"
        title={`Open: ${resolved.title}${resolved.kind ? ` (${resolved.kind})` : ""}`}
      >
        {resolved.kind && (
          <span className="mr-1.5 rounded bg-[var(--bai-hover)] px-1 py-px text-[9px] font-medium uppercase tracking-wide text-[var(--bai-text-tertiary)]">
            {resolved.kind}
          </span>
        )}{" "}
        {resolved.title}
        <svg
          className="ml-1 inline-block h-3 w-3 opacity-0 group-hover:opacity-50"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
      </button>
      <button
        type="button"
        onClick={onStartEdit}
        className="text-[var(--bai-text-faint)] opacity-0 transition-opacity hover:text-[var(--bai-accent)] group-hover:opacity-100"
        aria-label="Change target"
        title="Change target document"
      >
        <svg
          className="h-3.5 w-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => onRemoveLink(link.id)}
        className="text-[var(--bai-text-faint)] opacity-0 transition-opacity hover:text-[var(--bai-danger)] group-hover:opacity-100"
        aria-label="Remove link"
      >
        &times;
      </button>
    </div>
    {/* The articulation — why this edge exists. Lives on the edge itself
        (relationship metadata), so it survives the note being rewritten
        and can be checked by the health report. */}
    {isArticulating ? (
      <ArticulationForm
        initial={{ reason: link.reason ?? "", confidence }}
        submitLabel="Save"
        onSubmit={(a) => {
          onArticulate(link.id, a);
          setIsArticulating(false);
        }}
        onCancel={() => setIsArticulating(false)}
      />
    ) : link.reason ? (
      <button
        type="button"
        onClick={() => setIsArticulating(true)}
        className="mt-1 flex w-full items-start gap-1.5 text-left"
        title="Edit why this link exists"
      >
        <span className="mt-px shrink-0 text-[10px] text-[var(--bai-text-tertiary)]">because</span>
        <span className="flex-1 text-xs italic leading-snug text-[var(--bai-text-secondary)] group-hover:text-[var(--bai-text)]">
          {link.reason}
        </span>
        {confidence && (
          <span
            className={`shrink-0 text-[10px] ${CONFIDENCE_COLORS[confidence]}`}
            title={CONFIDENCE_LABELS[confidence]}
          >
            {confidence}
          </span>
        )}
      </button>
    ) : (
      <button
        type="button"
        onClick={() => setIsArticulating(true)}
        className="mt-1 text-[10px] text-[var(--bai-warn)]/60 hover:text-[var(--bai-warn)]"
        title="This link has no recorded reason. Say why it exists — the articulation test."
      >
        + why does this link exist?
      </button>
    )}
    </div>
  );
}

/**
 * The reason for a link's new target. The old reason and confidence are
 * filled in — they may still hold — and Save is the only way the new target
 * lands: REMOVE and ADD go together, so the edge is never without a reason.
 */
export function RetargetReason({
  target,
  initial,
  onSave,
  onCancel,
}: {
  target: LinkCandidate;
  initial: LinkArticulation;
  onSave: (articulation: LinkArticulation) => void;
  onCancel: () => void;
}) {
  return (
    <div>
      <p className="text-[12px] font-medium text-[var(--bai-text-secondary)]">
        {`Why does this note link to “${target.title}”?`}
      </p>
      <ArticulationForm
        initial={initial}
        submitLabel="Save"
        onSubmit={onSave}
        onCancel={onCancel}
      />
    </div>
  );
}

/**
 * Reason + confidence. Used both when creating a link (reason required —
 * a link nobody can explain is an address-book entry, not knowledge) and
 * when articulating an existing one after the fact.
 */
function ArticulationForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: LinkArticulation;
  submitLabel: string;
  onSubmit: (articulation: LinkArticulation) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState(initial.reason);
  const [confidence, setConfidence] = useState<EdgeConfidence | null>(
    initial.confidence,
  );
  const canSubmit = reason.trim().length > 0;
  return (
    <div className="mt-2 space-y-1.5 rounded border border-[var(--bai-accent)]/20 bg-[var(--bai-accent-soft)] p-2">
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        autoFocus
        rows={2}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSubmit)
            onSubmit({ reason: reason.trim(), confidence });
        }}
        placeholder="This note connects to that one because…"
        className="w-full resize-none rounded border border-[var(--bai-border)] bg-[var(--bai-deep)] px-2 py-1 text-xs text-[var(--bai-text-secondary)] outline-none placeholder:text-[var(--bai-text-faint)] focus:border-[var(--bai-accent)]/50"
      />
      <div className="flex items-center gap-2">
        <select
          value={confidence ?? ""}
          onChange={(e) =>
            setConfidence(
              isEdgeConfidence(e.target.value) ? e.target.value : null,
            )
          }
          className="rounded border border-[var(--bai-border)] bg-[var(--bai-deep)] px-2 py-1 text-[11px] text-[var(--bai-text-secondary)]"
          title="How well-founded is this link?"
        >
          <option value="">confidence…</option>
          {EDGE_CONFIDENCE_LEVELS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-2 py-1 text-[11px] text-[var(--bai-text-muted)] hover:bg-[var(--bai-hover)]"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => onSubmit({ reason: reason.trim(), confidence })}
          className="rounded bg-[var(--bai-accent)] px-2 py-1 text-[11px] font-medium text-[var(--bai-accent-text)] hover:bg-[var(--bai-accent)]/80 disabled:opacity-40"
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

/**
 * A new link: its kind, a document of this vault — from the list or a pasted
 * id — and the reason. Add wakes only with a document and a reason: the
 * articulation test, enforced where the edge is born. The agent's pre-write
 * hook holds the CLI to the same rule.
 */
export function AddLinkForm({
  targets,
  onAdd,
  onCancel,
  initialSelected = null,
}: {
  targets: TargetFinder;
  onAdd: (
    targetId: string,
    linkType: LinkType,
    articulation: LinkArticulation,
  ) => void;
  onCancel: () => void;
  /** A document already chosen — for tests, as TypeToConfirmPanel's `initialTyped`. */
  initialSelected?: LinkCandidate | null;
}) {
  const [linkType, setLinkType] = useState<LinkType>("RELATES_TO");
  const [selected, setSelected] = useState<LinkCandidate | null>(initialSelected);
  const [reason, setReason] = useState("");
  const [confidence, setConfidence] = useState<EdgeConfidence | null>(null);
  const candidates = useMemo(() => targets.candidates(linkType), [targets, linkType]);

  const hasReason = reason.trim().length > 0;
  const canAdd = selected !== null && hasReason;

  function handleSubmit() {
    if (!selected || !hasReason) return;
    onAdd(selected.id, linkType, { reason: reason.trim(), confidence });
  }

  return (
    <div className="space-y-2 rounded-lg border border-[var(--bai-accent)]/20 bg-[var(--bai-accent-soft)] p-3">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-[var(--bai-text-muted)]">This note</span>
        <select
          value={linkType}
          aria-label="Kind of link"
          onChange={(e) => setLinkType(e.target.value as LinkType)}
          className="rounded border border-[var(--bai-border)] bg-[var(--bai-deep)] px-2 py-1 text-sm text-[var(--bai-text-secondary)]"
        >
          {LINK_TYPES.map((lt) => (
            <option key={lt} value={lt}>
              {LINK_TYPE_LABELS[lt]}
            </option>
          ))}
        </select>
      </div>

      {selected ? (
        <div className="flex items-center gap-2 rounded border border-[var(--bai-border)] bg-[var(--bai-deep)] px-3 py-1.5">
          <span className="flex-1 truncate text-sm text-[var(--bai-text-secondary)]">
            {candidateLabel(selected)}
          </span>
          <span className="text-[10px] font-mono text-[var(--bai-text-tertiary)]">
            {selected.id.slice(0, 8)}
          </span>
          <button
            type="button"
            onClick={() => setSelected(null)}
            aria-label="Choose another document"
            className="text-[var(--bai-text-muted)] hover:text-[var(--bai-danger)]"
          >
            &times;
          </button>
        </div>
      ) : (
        <DocumentSearch
          candidates={candidates}
          pasted={(q) => targets.pasted(q, linkType)}
          noun={linkType === "DERIVED_FROM" ? "sources" : "notes"}
          onSelect={setSelected}
          onCancel={onCancel}
          autoFocus
        />
      )}

      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        placeholder="Why does this link exist? — this note connects to that one because…"
        title="The articulation test: a link without a reason is an address-book entry, not knowledge."
        className="w-full resize-none rounded border border-[var(--bai-border)] bg-[var(--bai-deep)] px-3 py-1.5 text-xs text-[var(--bai-text-secondary)] outline-none placeholder:text-[var(--bai-text-faint)] focus:border-[var(--bai-accent)]/50"
      />

      <div className="flex items-center gap-2">
        <select
          value={confidence ?? ""}
          onChange={(e) =>
            setConfidence(
              isEdgeConfidence(e.target.value) ? e.target.value : null,
            )
          }
          className="rounded border border-[var(--bai-border)] bg-[var(--bai-deep)] px-2 py-1.5 text-xs text-[var(--bai-text-secondary)]"
          title="How well-founded is this link?"
        >
          <option value="">confidence…</option>
          {EDGE_CONFIDENCE_LEVELS.map((c) => (
            <option key={c} value={c} title={CONFIDENCE_LABELS[c]}>
              {c}
            </option>
          ))}
        </select>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-3 py-1 text-xs text-[var(--bai-text-muted)] hover:bg-[var(--bai-hover)]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canAdd}
          title={
            !selected
              ? "Choose a document from this vault first"
              : !hasReason
                ? "Say why this link exists first"
                : undefined
          }
          className="rounded bg-[var(--bai-accent)] px-3 py-1 text-xs font-medium text-[var(--bai-accent-text)] hover:bg-[var(--bai-accent)]/80 disabled:opacity-40"
        >
          Add
        </button>
      </div>
    </div>
  );
}

function DocumentSearch({
  candidates,
  pasted,
  noun,
  onSelect,
  onCancel,
  autoFocus,
}: {
  candidates: LinkCandidate[];
  /** A pasted id that names a document in this drive, of any kind. */
  pasted: (query: string) => LinkCandidate | null;
  /** What the list holds, for the placeholder. */
  noun: "notes" | "sources";
  onSelect: (doc: LinkCandidate) => void;
  onCancel: () => void;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(
    () => searchCandidates(query, candidates, pasted(query)),
    [query, candidates, pasted],
  );

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
        placeholder={`Search ${noun} by title, or paste an id`}
        className="w-full rounded border border-[var(--bai-border)] bg-[var(--bai-deep)] px-3 py-1.5 text-sm text-[var(--bai-text-secondary)] outline-none focus:border-[var(--bai-accent)]/50"
      />

      {isOpen && filtered.length > 0 && (
        <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-[var(--bai-border)] bg-[var(--bai-surface)] shadow-xl">
          {filtered.map((doc) => (
            <button
              key={doc.id}
              type="button"
              onClick={() => {
                onSelect(doc);
                setIsOpen(false);
                setQuery("");
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--bai-hover)]"
            >
              <span className="flex-1 truncate text-sm text-[var(--bai-text-secondary)]">
                {candidateLabel(doc)}
              </span>
              <span className="shrink-0 text-[10px] font-mono text-[var(--bai-text-tertiary)]">
                {doc.id.slice(0, 8)}
              </span>
            </button>
          ))}
        </div>
      )}

      {isOpen && query.trim() && filtered.length === 0 && (
        <div className="absolute z-10 mt-1 w-full rounded-lg border border-[var(--bai-border)] bg-[var(--bai-surface)] px-3 py-2 shadow-xl">
          <p className="text-xs text-[var(--bai-text-muted)]">Nothing in this vault matches</p>
        </div>
      )}
    </div>
  );
}
