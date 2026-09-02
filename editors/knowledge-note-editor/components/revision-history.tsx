/**
 * The note as it stood at any revision, and how it changed.
 *
 * Every operation the reactor holds for this note is listed with who signed
 * it; a slider (or a click on a row) picks a revision, and the note is
 * replayed to that point with the model's own reducer — see
 * `lib/revisions.ts`. "Compare with current" turns the snapshot into a
 * line diff against the head, so a reader can see not just that a claim
 * changed but exactly which sentences did.
 */
import { useEffect, useMemo, useState } from "react";
import { MarkdownPreview } from "../../shared/markdown-preview.js";
import { SignerBadge } from "../../shared/signer-badge.js";
import {
  collapseUnchanged,
  diffLines,
  summarizeDiff,
} from "../../shared/text-diff.js";
import { useSignatureVerification } from "../../shared/use-signature-verification.js";
import { useNoteRevisions } from "../hooks/use-note-revisions.js";
import {
  describeOperation,
  effectiveOperations,
  lastSignature,
  operationKind,
  replayToRevision,
  type NoteOperation,
} from "../lib/revisions.js";

const KIND_COLOR: Record<ReturnType<typeof operationKind>, string> = {
  content: "#cba6f7",
  lifecycle: "#a6e3a1",
  links: "#89b4fa",
  topics: "#f9e2af",
  metadata: "#94e2d5",
  other: "#6c7086",
};

type Props = {
  documentId: string;
  /** Bumps when the live document changes — triggers a refetch. */
  revisionKey: number;
  /** The head state, for "compare with current". */
  current: { title: string | null; description: string | null; content: string | null };
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function RevisionHistory({ documentId, revisionKey, current }: Props) {
  const { operations, isLoading, error } = useNoteRevisions(documentId, revisionKey);

  // Only operations in effect can be revisions — an undone edit is history
  // of the history, not a state the note was ever left in.
  const revisions = useMemo(() => effectiveOperations(operations), [operations]);
  const latestIndex = revisions.length ? revisions[revisions.length - 1].index : -1;

  // Position in `revisions` (0..n-1), not the operation index, so the
  // slider is dense even when undo left gaps in the index sequence.
  const [pos, setPos] = useState<number | null>(null);
  const [compare, setCompare] = useState(false);
  // Follow the head until the reader picks a revision; a new operation
  // landing while they are looking at an old one must not yank the slider.
  useEffect(() => {
    if (pos !== null && pos > revisions.length - 1) setPos(null);
  }, [revisions.length, pos]);
  const effectivePos = pos ?? revisions.length - 1;
  const selected: NoteOperation | undefined = revisions[effectivePos];
  const atHead = selected !== undefined && selected.index === latestIndex;

  const replayed = useMemo(
    () => (selected ? replayToRevision(revisions, selected.index) : null),
    [revisions, selected],
  );
  const snapshot = replayed?.document.state.global;

  const sigItems = useMemo(
    () =>
      revisions.map((op) => ({
        id: `${op.index}`,
        signature: lastSignature(op),
      })),
    [revisions],
  );
  const verdicts = useSignatureVerification(sigItems);

  const diff = useMemo(() => {
    if (!compare || !snapshot) return null;
    const content = diffLines(snapshot.content ?? "", current.content ?? "");
    return {
      title: snapshot.title !== current.title,
      description: snapshot.description !== current.description,
      content,
      contentSummary: summarizeDiff(content),
      collapsed: collapseUnchanged(content, 3),
    };
  }, [compare, snapshot, current]);

  if (error) {
    return (
      <p className="py-2 text-xs" style={{ color: "#f38ba8" }}>
        Could not load history: {error}
      </p>
    );
  }
  if (revisions.length === 0) {
    return (
      <p className="py-2 text-center text-xs" style={{ color: "var(--bai-text-faint)" }}>
        {isLoading ? "Loading history…" : "No operations recorded for this note yet."}
      </p>
    );
  }

  const selectedSigner = selected?.action.context?.signer ?? null;

  return (
    <div className="space-y-4">
      {/* Scrubber */}
      <div
        className="rounded-lg p-3"
        style={{ backgroundColor: "var(--bai-deep)", border: "1px solid var(--bai-border)" }}
      >
        <div className="flex items-center justify-between gap-3 text-xs">
          <span style={{ color: "var(--bai-text-tertiary)" }}>
            Revision{" "}
            <span className="font-semibold tabular-nums" style={{ color: "var(--bai-text-secondary)" }}>
              {effectivePos + 1}
            </span>{" "}
            of {revisions.length}
            {atHead && (
              <span className="ml-1.5" style={{ color: "var(--bai-text-faint)" }}>
                (current)
              </span>
            )}
          </span>
          <div className="flex items-center gap-2">
            {!atHead && (
              <button
                type="button"
                onClick={() => setPos(null)}
                className="rounded px-2 py-0.5 text-[11px]"
                style={{ color: "var(--bai-text-tertiary)", backgroundColor: "var(--bai-hover)" }}
              >
                Jump to current
              </button>
            )}
            <button
              type="button"
              onClick={() => setCompare((v) => !v)}
              disabled={atHead}
              className="rounded px-2 py-0.5 text-[11px] disabled:opacity-40"
              style={{
                color: compare ? "#cba6f7" : "var(--bai-text-tertiary)",
                backgroundColor: compare ? "rgba(203, 166, 247, 0.15)" : "var(--bai-hover)",
              }}
              title={atHead ? "Pick an earlier revision to compare" : "Show what changed between this revision and now"}
            >
              Compare with current
            </button>
          </div>
        </div>
        <input
          type="range"
          min={0}
          max={revisions.length - 1}
          value={effectivePos}
          onChange={(e) => setPos(Number(e.target.value))}
          className="mt-2 w-full accent-[#cba6f7]"
          aria-label="Revision"
        />
        {selected && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
            <span className="flex items-center gap-1.5" style={{ color: "var(--bai-text-secondary)" }}>
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: KIND_COLOR[operationKind(selected.action.type)] }}
              />
              {describeOperation(selected)}
            </span>
            <span style={{ color: "var(--bai-text-faint)" }}>{fmtTime(selected.timestampUtcMs)}</span>
            <SignerBadge
              signer={
                selectedSigner
                  ? { address: selectedSigner.user?.address ?? null, app: selectedSigner.app?.name ?? null, key: selectedSigner.app?.key ?? null }
                  : null
              }
              verdict={verdicts.get(`${selected.index}`)}
            />
          </div>
        )}
        {replayed && replayed.failures.length > 0 && (
          <p className="mt-1.5 text-[11px]" style={{ color: "#f9e2af" }}>
            {replayed.failures.length} operation{replayed.failures.length === 1 ? "" : "s"} could not be
            replayed and {replayed.failures.length === 1 ? "was" : "were"} skipped (
            {replayed.failures.map((f) => `#${f.index} ${f.type}`).join(", ")}).
          </p>
        )}
      </div>

      {/* Snapshot or diff */}
      {snapshot && (
        <div
          className="rounded-lg p-4"
          style={{ backgroundColor: "var(--bai-surface)", border: "1px solid var(--bai-border)" }}
        >
          {diff ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3 text-[11px]" style={{ color: "var(--bai-text-tertiary)" }}>
                <span>
                  Changes since revision {effectivePos + 1}:
                </span>
                <span style={{ color: "#a6e3a1" }}>+{diff.contentSummary.added} lines</span>
                <span style={{ color: "#f38ba8" }}>−{diff.contentSummary.removed} lines</span>
                {diff.title && <span>title changed</span>}
                {diff.description && <span>description changed</span>}
                {!diff.contentSummary.changed && !diff.title && !diff.description && (
                  <span>no textual changes</span>
                )}
              </div>
              {diff.title && (
                <DiffField label="Title" before={snapshot.title ?? ""} after={current.title ?? ""} />
              )}
              {diff.description && (
                <DiffField label="Description" before={snapshot.description ?? ""} after={current.description ?? ""} />
              )}
              {diff.contentSummary.changed && (
                <pre
                  className="overflow-x-auto rounded p-2 text-[11px] leading-relaxed"
                  style={{ backgroundColor: "var(--bai-deep)", color: "var(--bai-text-secondary)" }}
                >
                  {diff.collapsed.map((l, i) =>
                    l.kind === "gap" ? (
                      <div key={i} style={{ color: "var(--bai-text-faint)" }}>
                        ⋯ {l.hidden} unchanged line{l.hidden === 1 ? "" : "s"}
                      </div>
                    ) : (
                      <div
                        key={i}
                        style={{
                          backgroundColor:
                            l.kind === "added"
                              ? "rgba(166, 227, 161, 0.12)"
                              : l.kind === "removed"
                                ? "rgba(243, 139, 168, 0.12)"
                                : "transparent",
                          color:
                            l.kind === "added" ? "#a6e3a1" : l.kind === "removed" ? "#f38ba8" : undefined,
                        }}
                      >
                        {l.kind === "added" ? "+ " : l.kind === "removed" ? "− " : "  "}
                        {l.text || " "}
                      </div>
                    ),
                  )}
                </pre>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-[10px]">
                <Chip>{snapshot.status ?? "DRAFT"}</Chip>
                {snapshot.noteType && <Chip>{snapshot.noteType}</Chip>}
                {snapshot.topics.length > 0 && (
                  <span style={{ color: "var(--bai-text-faint)" }}>
                    {snapshot.topics.map((t) => `#${t.name}`).join(" ")}
                  </span>
                )}
              </div>
              <h3 className="text-base font-semibold" style={{ color: "var(--bai-text-primary)" }}>
                {snapshot.title || <span style={{ color: "var(--bai-text-faint)" }}>(no title yet)</span>}
              </h3>
              {snapshot.description && (
                <p className="text-xs italic" style={{ color: "var(--bai-text-tertiary)" }}>
                  {snapshot.description}
                </p>
              )}
              {snapshot.content ? (
                <MarkdownPreview content={snapshot.content} />
              ) : (
                <p className="text-xs" style={{ color: "var(--bai-text-faint)" }}>
                  (no content at this revision)
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Operation list */}
      <div>
        <h4
          className="mb-2 text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--bai-text-muted)" }}
        >
          Operations ({revisions.length}
          {operations.length !== revisions.length ? `, ${operations.length - revisions.length} undone` : ""})
        </h4>
        <ol className="max-h-72 space-y-0.5 overflow-y-auto pr-1">
          {[...revisions].reverse().map((op, i) => {
            const p = revisions.length - 1 - i;
            const isSelected = p === effectivePos;
            const signer = op.action.context?.signer ?? null;
            return (
              <li key={op.index}>
                <button
                  type="button"
                  onClick={() => setPos(p === revisions.length - 1 ? null : p)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[11px]"
                  style={{
                    backgroundColor: isSelected ? "rgba(203, 166, 247, 0.12)" : "transparent",
                    color: "var(--bai-text-secondary)",
                  }}
                  aria-current={isSelected ? "true" : undefined}
                >
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: KIND_COLOR[operationKind(op.action.type)] }}
                  />
                  <span className="w-8 shrink-0 tabular-nums" style={{ color: "var(--bai-text-faint)" }}>
                    #{op.index}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{describeOperation(op)}</span>
                  <span className="shrink-0" style={{ color: "var(--bai-text-faint)" }}>
                    {fmtTime(op.timestampUtcMs)}
                  </span>
                  <SignerBadge
                    compact
                    signer={
                      signer
                        ? { address: signer.user?.address ?? null, app: signer.app?.name ?? null, key: signer.app?.key ?? null }
                        : null
                    }
                    verdict={verdicts.get(`${op.index}`)}
                  />
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="rounded px-1.5 py-0.5 font-medium uppercase tracking-wide"
      style={{ backgroundColor: "var(--bai-hover)", color: "var(--bai-text-tertiary)" }}
    >
      {children}
    </span>
  );
}

function DiffField({ label, before, after }: { label: string; before: string; after: string }) {
  return (
    <div className="text-[11px]">
      <div className="mb-0.5 font-semibold uppercase tracking-wider" style={{ color: "var(--bai-text-muted)" }}>
        {label}
      </div>
      <div className="rounded px-2 py-1" style={{ backgroundColor: "rgba(243, 139, 168, 0.12)", color: "#f38ba8" }}>
        − {before || <em>(empty)</em>}
      </div>
      <div className="rounded px-2 py-1" style={{ backgroundColor: "rgba(166, 227, 161, 0.12)", color: "#a6e3a1" }}>
        + {after || <em>(empty)</em>}
      </div>
    </div>
  );
}
