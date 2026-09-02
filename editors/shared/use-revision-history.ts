/**
 * All the state behind a history view, in one hook.
 *
 * The scrubber, the snapshot and the operation list are placed in different
 * parts of an editor's layout — the first two in the main column, the list
 * in the sidebar — so they cannot be one component. They share this hook
 * instead: it owns the fetch, the selected revision, the compare mode and
 * the replay, and the presentational parts in `revision-history.tsx` read it.
 *
 * A `RevisionModel` is the only model-specific part: it says how to replay a
 * document, how to name its operations, which of its fields carry prose, and
 * which carry everything else.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  effectiveOperations,
  lastSignature,
  type DocumentOperation,
  type OperationKind,
  type ReplayFailure,
} from "./document-revisions.js";
import {
  collapseUnchanged,
  diffLines,
  diffWords,
  summarizeDiff,
  toDiffRows,
  type DiffRow,
  type DiffSummary,
  type DiffToken,
} from "./text-diff.js";
import { useDocumentRevisions } from "./use-document-revisions.js";
import { useSignatureVerification } from "./use-signature-verification.js";
import type { VerificationResult } from "./verify-signature.js";

/**
 * The document's prose. `body` is whichever field carries it — `content` on
 * a note or source, `orientation` on a MoC — mapped by the model. This is
 * the text the diff treats as the subject; everything else is a field.
 */
export type RevisionText = {
  title: string | null;
  description: string | null;
  body: string | null;
};

/**
 * One non-prose field, flattened to a label and a display value. A model
 * lists everything worth noticing; the hook keeps only what changed, so
 * declaring a field that rarely moves costs nothing.
 */
export type RevisionField = { label: string; value: string | null };

/** What one document model has to say about its own history. */
export type RevisionModel<TSnapshot> = {
  /** Noun for the empty state, e.g. "note" or "source". */
  subject: string;
  /** What the prose body is called in this model, for diff labels. */
  bodyLabel: string;
  replay: (
    ops: DocumentOperation[],
    upToIndex: number,
  ) => { snapshot: TSnapshot; failures: ReplayFailure[] };
  snapshotText: (snapshot: TSnapshot) => RevisionText;
  /** Fields beyond title/description/body: status, topics, counts, … */
  snapshotFields?: (snapshot: TSnapshot) => RevisionField[];
  describeOperation: (op: DocumentOperation) => string;
  /**
   * Which part of the document an operation touched. The `content` kind is
   * a contract: it must be exactly the operations that write the text in
   * `snapshotText`, because the scrubber's ◂ ▸ steppers navigate by it.
   */
  operationKind: (type: string) => OperationKind;
  renderSnapshot: (snapshot: TSnapshot) => ReactNode;
};

/** A field that differs between the two revisions being compared. */
export type RevisionFieldChange = {
  label: string;
  before: string | null;
  after: string | null;
  /** Word-level alignment, or null when the two values share nothing. */
  tokens: DiffToken[] | null;
};

/**
 * What the selected revision is compared against.
 *
 *   previous  what this operation changed  (the default — works at the head)
 *   current   what has changed since this revision, up to now
 */
export type CompareBase = "previous" | "current";

export type RevisionDiff = {
  base: CompareBase;
  /** The older side of the comparison. */
  before: RevisionText;
  /** The newer side. */
  after: RevisionText;
  /** Line counts for the prose body. */
  summary: DiffSummary;
  /** The body diff, collapsed and paired into rewrite rows. */
  rows: DiffRow[];
  /** Title, description and every model field that differs. */
  fields: RevisionFieldChange[];
  /** False when the two sides are identical in every reported respect. */
  anyChange: boolean;
  /** True when the older side is the empty document (revision 1). */
  fromEmpty: boolean;
};

export type RevisionHistory<TSnapshot> = {
  model: RevisionModel<TSnapshot>;
  /** Every operation fetched, including ones undo took out of effect. */
  operations: DocumentOperation[];
  /** The operations in effect — the revisions a reader can visit. */
  revisions: DocumentOperation[];
  isLoading: boolean;
  error: string | null;
  /** Position in `revisions`, not an operation index. */
  pos: number;
  selected: DocumentOperation | undefined;
  atHead: boolean;
  /** Select by position; selecting the last one follows the head again. */
  selectPos: (pos: number) => void;
  jumpToCurrent: () => void;
  /** Positions of the operations that wrote the document's text. */
  contentPositions: number[];
  /** Nearest text-writing operation before / after the selection. */
  prevContentPos: number | null;
  nextContentPos: number | null;
  /** Whether the reader has asked to see changes rather than the snapshot. */
  compare: boolean;
  toggleCompare: () => void;
  /** The reader's preferred base … */
  compareBase: CompareBase;
  setCompareBase: (base: CompareBase) => void;
  /** … and the one in use: "current" means nothing at the head. */
  effectiveBase: CompareBase;
  snapshot: TSnapshot | undefined;
  failures: ReplayFailure[];
  /** Non-null exactly when `compare` is on and a snapshot exists. */
  diff: RevisionDiff | null;
  /** Verification verdict for an operation; undefined while checking. */
  verdictFor: (op: DocumentOperation) => VerificationResult | undefined;
};

/** Values short enough that an inline word diff reads better than two rows. */
const INLINE_DIFF_MAX = 600;

/** Replays kept per document — enough for a scrub back and forth. */
const REPLAY_CACHE_SIZE = 64;

export function fieldChanges(
  before: RevisionField[],
  after: RevisionField[],
): RevisionFieldChange[] {
  const afterByLabel = new Map(after.map((f) => [f.label, f.value ?? null]));
  const seen = new Set<string>();
  const out: RevisionFieldChange[] = [];

  const push = (label: string, b: string | null, a: string | null) => {
    out.push({
      label,
      before: b,
      after: a,
      tokens:
        b !== null &&
        a !== null &&
        b.length <= INLINE_DIFF_MAX &&
        a.length <= INLINE_DIFF_MAX
          ? diffWords(b, a)
          : null,
    });
  };

  for (const f of before) {
    seen.add(f.label);
    const b = f.value ?? null;
    const a = afterByLabel.get(f.label) ?? null;
    if (b !== a) push(f.label, b, a);
  }
  // A model may include a field only when it has a value (extraction stats,
  // say), so the newer side can carry labels the older one never had.
  for (const f of after) {
    if (!seen.has(f.label) && (f.value ?? null) !== null) {
      push(f.label, null, f.value ?? null);
    }
  }
  return out;
}

/**
 * Compare two snapshots of one document. Pure, so it can be tested with a
 * model and two replayed states and no React around it.
 */
export function buildRevisionDiff<TSnapshot>(
  model: RevisionModel<TSnapshot>,
  older: TSnapshot,
  newer: TSnapshot,
  base: CompareBase,
  fromEmpty = false,
): RevisionDiff {
  const before = model.snapshotText(older);
  const after = model.snapshotText(newer);
  const lines = diffLines(before.body ?? "", after.body ?? "");
  const summary = summarizeDiff(lines);

  // Title and description are prose too, but one line of it: they read
  // better as inline field changes than as blocks above the body.
  const fields = fieldChanges(
    [
      { label: "Title", value: before.title },
      { label: "Description", value: before.description },
      ...(model.snapshotFields?.(older) ?? []),
    ],
    [
      { label: "Title", value: after.title },
      { label: "Description", value: after.description },
      ...(model.snapshotFields?.(newer) ?? []),
    ],
  );

  return {
    base,
    before,
    after,
    summary,
    rows: toDiffRows(collapseUnchanged(lines, 3)),
    fields,
    anyChange: summary.changed || fields.length > 0,
    fromEmpty,
  };
}

export function useRevisionHistory<TSnapshot>(
  documentId: string,
  revisionKey: number,
  /**
   * The live document state — the "current" side of a comparison.
   * Undefined while the document is still loading.
   */
  head: TSnapshot | undefined,
  model: RevisionModel<TSnapshot>,
): RevisionHistory<TSnapshot> {
  const { operations, isLoading, error } = useDocumentRevisions(
    documentId,
    revisionKey,
  );

  // Only operations in effect can be revisions — an undone edit is history
  // of the history, not a state the document was ever left in.
  const revisions = useMemo(() => effectiveOperations(operations), [operations]);
  const latestIndex = revisions.length
    ? revisions[revisions.length - 1].index
    : -1;

  // Null means "follow the head": a new operation landing while the reader
  // looks at an old revision must not yank the slider, and a reader parked
  // on the newest revision should still move with it.
  const [pos, setPos] = useState<number | null>(null);
  const [compare, setCompare] = useState(false);
  const [compareBase, setCompareBase] = useState<CompareBase>("previous");
  useEffect(() => {
    if (pos !== null && pos > revisions.length - 1) setPos(null);
  }, [revisions.length, pos]);

  const effectivePos = pos ?? revisions.length - 1;
  // `.at` rather than `[]`: on the render right after an undo shrinks the
  // list, `effectivePos` can still point past the end, and `at` is typed
  // for the miss that `[]` hides.
  const selected = revisions.at(effectivePos);
  const atHead = selected !== undefined && selected.index === latestIndex;

  const selectPos = useCallback(
    (next: number) => setPos(next === revisions.length - 1 ? null : next),
    [revisions.length],
  );
  const jumpToCurrent = useCallback(() => setPos(null), []);
  const toggleCompare = useCallback(() => setCompare((v) => !v), []);

  // Comparing the head with itself means nothing, so at the head the base
  // is always the previous revision, whatever the reader last chose.
  const effectiveBase: CompareBase = atHead ? "previous" : compareBase;

  // Text-writing operations, for stepping past the ones that only linked a
  // claim or flipped a status. In a real log those are the majority.
  const contentPositions = useMemo(
    () =>
      revisions.flatMap((op, i) =>
        model.operationKind(op.action.type) === "content" ? [i] : [],
      ),
    [revisions, model],
  );
  const prevContentPos =
    contentPositions.filter((p) => p < effectivePos).at(-1) ?? null;
  const nextContentPos = contentPositions.find((p) => p > effectivePos) ?? null;

  // A small replay cache: with "previous" as the base every step needs two
  // replays, and the one you just left is the base of the one you arrive
  // at. Cleared whenever the log itself changes.
  const cacheRef = useRef<{
    revisions: DocumentOperation[];
    map: Map<number, { snapshot: TSnapshot; failures: ReplayFailure[] }>;
  }>({ revisions, map: new Map() });
  const replayAt = useCallback(
    (index: number) => {
      const cache = cacheRef.current;
      if (cache.revisions !== revisions) {
        cache.revisions = revisions;
        cache.map.clear();
      }
      const hit = cache.map.get(index);
      if (hit) return hit;
      const fresh = model.replay(revisions, index);
      cache.map.set(index, fresh);
      if (cache.map.size > REPLAY_CACHE_SIZE) {
        const oldest = cache.map.keys().next().value;
        if (oldest !== undefined) cache.map.delete(oldest);
      }
      return fresh;
    },
    [revisions, model],
  );

  const replayed = useMemo(
    () => (selected ? replayAt(selected.index) : null),
    [selected, replayAt],
  );
  const snapshot = replayed?.snapshot;

  const sigItems = useMemo(
    () =>
      revisions.map((op) => ({
        id: `${op.index}`,
        signature: lastSignature(op),
      })),
    [revisions],
  );
  const verdicts = useSignatureVerification(sigItems);
  const verdictFor = useCallback(
    (op: DocumentOperation) => verdicts.get(`${op.index}`),
    [verdicts],
  );

  const diff = useMemo<RevisionDiff | null>(() => {
    if (!compare || snapshot === undefined) return null;

    let older: TSnapshot;
    let newer: TSnapshot;
    let fromEmpty = false;
    if (effectiveBase === "current") {
      if (head === undefined) return null;
      older = snapshot;
      newer = head;
    } else {
      // Revision 1 is compared with the empty document: replaying up to an
      // index below every operation applies nothing.
      const prev = revisions.at(effectivePos - 1);
      older = replayAt(prev && effectivePos > 0 ? prev.index : -1).snapshot;
      newer = snapshot;
      fromEmpty = effectivePos === 0;
    }

    return buildRevisionDiff(model, older, newer, effectiveBase, fromEmpty);
  }, [compare, effectiveBase, snapshot, effectivePos, revisions, head, model, replayAt]);

  return {
    model,
    operations,
    revisions,
    isLoading,
    error,
    pos: effectivePos,
    selected,
    atHead,
    selectPos,
    jumpToCurrent,
    contentPositions,
    prevContentPos,
    nextContentPos,
    compare,
    toggleCompare,
    compareBase,
    setCompareBase,
    effectiveBase,
    snapshot,
    failures: replayed?.failures ?? [],
    diff,
    verdictFor,
  };
}
