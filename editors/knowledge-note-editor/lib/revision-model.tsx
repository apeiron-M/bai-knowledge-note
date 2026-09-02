/**
 * What the history view needs to know about a knowledge note: how to replay
 * it, how to name its operations, what a snapshot of one looks like, and
 * which of its fields to report when comparing two revisions.
 */
import { MarkdownPreview } from "../../shared/markdown-preview.js";
import { RevisionChip } from "../../shared/revision-history.js";
import type {
  RevisionField,
  RevisionModel,
} from "../../shared/use-revision-history.js";
import { describeOperation, operationKind, replayToRevision } from "./revisions.js";

export type NoteSnapshot = ReturnType<
  typeof replayToRevision
>["document"]["state"]["global"];

/** Empty strings are "unset", not a value that changed to blank. */
function text(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s === "" ? null : s;
}

function list(v: readonly string[] | null | undefined): string | null {
  return v && v.length > 0 ? v.join(", ") : null;
}

/**
 * Every field worth noticing. The history view keeps only the ones that
 * differ between the two revisions, so listing a field that rarely moves —
 * most of the note's metadata — costs nothing.
 */
function snapshotFields(s: NoteSnapshot): RevisionField[] {
  return [
    { label: "Status", value: text(s.status) },
    { label: "Type", value: text(s.noteType) },
    {
      label: "Topics",
      value: s.topics.length > 0 ? s.topics.map((t) => `#${t.name}`).join(" ") : null,
    },
    { label: "Author", value: text(s.provenance?.author) },
    { label: "Origin", value: text(s.provenance?.sourceOrigin) },
    { label: "Session", value: text(s.provenance?.sessionId) },
    { label: "Scope", value: text(s.scope) },
    { label: "Confidence", value: text(s.confidence) },
    { label: "Severity", value: text(s.severity) },
    { label: "Editor", value: text(s.editor) },
    { label: "Model ID", value: text(s.modelId) },
    { label: "Version", value: text(s.version) },
    { label: "File path", value: text(s.filePath) },
    { label: "Computes", value: text(s.computes) },
    { label: "Context", value: text(s.context) },
    { label: "Decision status", value: text(s.decisionStatus) },
    { label: "Model", value: text(s.model) },
    { label: "Source type", value: text(s.sourceType) },
    { label: "Target type", value: text(s.targetType) },
    { label: "Relation type", value: text(s.relationType) },
    { label: "Cardinality", value: text(s.cardinality) },
    { label: "Error message", value: text(s.errorMessage) },
    { label: "Root cause", value: text(s.rootCause) },
    { label: "Correct pattern", value: text(s.correctPattern) },
    { label: "Models", value: list(s.models) },
    { label: "Modules", value: list(s.modules) },
    { label: "Hooks used", value: list(s.hooksUsed) },
    { label: "Dispatch targets", value: list(s.dispatchTargets) },
    { label: "Inputs", value: list(s.inputs) },
    { label: "Outputs", value: list(s.outputs) },
    { label: "Consumed by", value: list(s.consumedBy) },
    { label: "Alternatives", value: list(s.alternatives) },
    { label: "Consequences", value: list(s.consequences) },
  ];
}

export const NOTE_REVISION_MODEL: RevisionModel<NoteSnapshot> = {
  subject: "note",
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
        <RevisionChip>{s.status ?? "DRAFT"}</RevisionChip>
        {s.noteType && <RevisionChip>{s.noteType}</RevisionChip>}
        {s.topics.length > 0 && (
          <span style={{ color: "var(--bai-text-faint)" }}>
            {s.topics.map((t) => `#${t.name}`).join(" ")}
          </span>
        )}
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
        <MarkdownPreview content={s.content} />
      ) : (
        <p className="text-xs" style={{ color: "var(--bai-text-faint)" }}>
          (no content at this revision)
        </p>
      )}
    </div>
  ),
};
