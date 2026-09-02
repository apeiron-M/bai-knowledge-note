/**
 * What the history view needs to know about a source: how to replay it, how
 * to name its operations, and what a snapshot of one looks like.
 *
 * The reason this matters for a source: raw material gets re-ingested (the
 * Edit form re-dispatches INGEST_SOURCE), and when it does, every claim
 * already extracted from it was extracted from text that no longer exists.
 * "Compare with current" is how a reader sees that drift.
 */
import { MarkdownPreview } from "../../shared/markdown-preview.js";
import { RevisionChip } from "../../shared/revision-history.js";
import type {
  RevisionField,
  RevisionModel,
} from "../../shared/use-revision-history.js";
import { describeOperation, operationKind, replayToRevision } from "./revisions.js";

export type SourceSnapshot = ReturnType<
  typeof replayToRevision
>["document"]["state"]["global"];

/** Empty strings are "unset", not a value that changed to blank. */
function text(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

/**
 * The claim list is reported as a count, not as 117 UUIDs: the useful fact
 * when comparing revisions is that it grew, and by how much.
 */
function snapshotFields(s: SourceSnapshot): RevisionField[] {
  const stats = s.extractionStats;
  return [
    { label: "Status", value: text(s.status) },
    { label: "Type", value: text(s.sourceType) },
    { label: "Author", value: text(s.provenance?.author) },
    { label: "URL", value: text(s.provenance?.url) },
    { label: "Published", value: text(s.provenance?.publishedAt) },
    { label: "Method", value: text(s.provenance?.method) },
    { label: "Tool", value: text(s.provenance?.tool) },
    { label: "Ingested by", value: text(s.createdBy) },
    { label: "Claims linked", value: String(s.extractedClaims.length) },
    { label: "Claims extracted", value: stats ? String(stats.claimCount) : null },
    { label: "Skipped", value: stats ? String(stats.skippedCount) : null },
    {
      label: "Skip rate",
      value: stats ? `${(stats.skipRate * 100).toFixed(1)}%` : null,
    },
    { label: "Extracted by", value: text(stats?.extractedBy) },
  ];
}

export const SOURCE_REVISION_MODEL: RevisionModel<SourceSnapshot> = {
  subject: "source",
  bodyLabel: "Content",
  describeOperation,
  operationKind,
  snapshotFields,
  replay: (ops, upToIndex) => {
    const { document, failures } = replayToRevision(ops, upToIndex);
    return { snapshot: document.state.global, failures };
  },
  snapshotText: (s) => ({
    title: s.title ?? null,
    description: s.description ?? null,
    body: s.content ?? null,
  }),
  renderSnapshot: (s) => (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-[10px]">
        <RevisionChip>{s.status ?? "INBOX"}</RevisionChip>
        {s.sourceType && <RevisionChip>{s.sourceType}</RevisionChip>}
        {s.provenance?.author && (
          <span style={{ color: "var(--bai-text-faint)" }}>
            {s.provenance.author}
          </span>
        )}
        <span style={{ color: "var(--bai-text-faint)" }}>
          {s.extractedClaims.length}{" "}
          {s.extractedClaims.length === 1 ? "claim" : "claims"}
          {s.extractionStats
            ? ` · ${(s.extractionStats.skipRate * 100).toFixed(1)}% skipped`
            : ""}
        </span>
      </div>
      <h3
        className="text-base font-semibold"
        style={{ color: "var(--bai-text-primary)" }}
      >
        {s.title || (
          <span style={{ color: "var(--bai-text-faint)" }}>(no title yet)</span>
        )}
      </h3>
      {s.description && (
        <p
          className="text-xs italic"
          style={{ color: "var(--bai-text-tertiary)" }}
        >
          {s.description}
        </p>
      )}
      {s.content ? (
        /* Source content is raw material and can run to tens of thousands
           of characters — cap it so the page does not become a mile long. */
        <div className="max-h-[500px] overflow-y-auto scrollbar-thin">
          <MarkdownPreview content={s.content} />
        </div>
      ) : (
        <p className="text-xs" style={{ color: "var(--bai-text-faint)" }}>
          (no content at this revision)
        </p>
      )}
    </div>
  ),
};
