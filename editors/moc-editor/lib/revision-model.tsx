/**
 * What the history view needs to know about a MoC: how to replay it, how to
 * name its operations, and what a snapshot of one looks like.
 *
 * The diffed body is `orientation` — the synthesis paragraph — so a reader
 * can see exactly how the framing of an area was re-stated over time.
 */
import { MarkdownPreview } from "../../shared/markdown-preview.js";
import { RevisionChip } from "../../shared/revision-history.js";
import type {
  RevisionField,
  RevisionModel,
} from "../../shared/use-revision-history.js";
import { describeOperation, operationKind, replayToRevision } from "./revisions.js";

export type MocSnapshot = ReturnType<
  typeof replayToRevision
>["document"]["state"]["global"];

/** Empty strings are "unset", not a value that changed to blank. */
function text(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

function count(n: number): string | null {
  return n > 0 ? String(n) : null;
}

/**
 * Membership and hierarchy live in the reactor's relationship table now, so
 * the inline counts here describe what this document's own state holds —
 * which is exactly what a replay can know.
 */
function snapshotFields(s: MocSnapshot): RevisionField[] {
  return [
    { label: "Tier", value: text(s.tier) },
    { label: "Inline core ideas", value: count(s.coreIdeas.length) },
    { label: "Tensions", value: count(s.tensions.length) },
    { label: "Open questions", value: count(s.openQuestions.length) },
    { label: "Agent notes", value: count(s.agentNotes.length) },
    { label: "Inline child MoCs", value: count(s.childRefs.length) },
    { label: "Parent", value: text(s.parentRef) },
    {
      label: "Note count",
      value: s.noteCount === null || s.noteCount === undefined ? null : String(s.noteCount),
    },
    { label: "Version", value: text(s.version) },
  ];
}

export const MOC_REVISION_MODEL: RevisionModel<MocSnapshot> = {
  subject: "MoC",
  bodyLabel: "Orientation",
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
    body: s.orientation ?? null,
  }),
  renderSnapshot: (s) => (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-[10px]">
        <RevisionChip>{s.tier ?? "TOPIC"}</RevisionChip>
        {/* Membership lives in the relationship table now, so these counts
            reflect only what inline state held at the time. */}
        {s.coreIdeas.length > 0 && (
          <span style={{ color: "var(--bai-text-faint)" }}>
            {s.coreIdeas.length} inline core{" "}
            {s.coreIdeas.length === 1 ? "idea" : "ideas"}
          </span>
        )}
        {s.tensions.length > 0 && (
          <span style={{ color: "#eba0ac" }}>
            {s.tensions.length} {s.tensions.length === 1 ? "tension" : "tensions"}
          </span>
        )}
        {s.openQuestions.length > 0 && (
          <span style={{ color: "var(--bai-text-faint)" }}>
            {s.openQuestions.length} open{" "}
            {s.openQuestions.length === 1 ? "question" : "questions"}
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
      {s.orientation ? (
        <MarkdownPreview content={s.orientation} />
      ) : (
        <p className="text-xs" style={{ color: "var(--bai-text-faint)" }}>
          (no orientation at this revision)
        </p>
      )}
    </div>
  ),
};
