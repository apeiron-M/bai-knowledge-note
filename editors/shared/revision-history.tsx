/**
 * A document as it stood at any revision, and how it changed — in three
 * parts an editor can place where it likes.
 *
 *   <RevisionScrubber>       pick a revision; says what that operation did
 *   <RevisionSnapshotPanel>  the replayed document, or a diff against now
 *   <RevisionOperationList>  every operation, signed — sized for a sidebar
 *
 * All three read one `useRevisionHistory` result, so the list can live in
 * the sidebar while the snapshot fills the main column. Model-specific
 * behaviour arrives through `history.model`; nothing here knows which
 * document model it is showing.
 */
import { useEffect, useRef, useState } from "react";
import {
  OPERATION_KIND_COLOR,
  type DocumentOperation,
} from "./document-revisions.js";
import { SignerBadge } from "./signer-badge.js";
import { tokensForSide, type DiffRow, type DiffToken } from "./text-diff.js";
import type {
  RevisionFieldChange,
  RevisionHistory,
} from "./use-revision-history.js";

/* Change palette. Colour intensity tracks how much of a line changed: a
   whole added line is fully tinted, a rewritten line stays neutral and only
   the differing words are marked, so the eye lands on the edit itself. */
const ADDED = "#a6e3a1";
const REMOVED = "#f38ba8";
const ROW_TINT_ADDED = "rgba(166, 227, 161, 0.10)";
const ROW_TINT_REMOVED = "rgba(243, 139, 168, 0.10)";
const WORD_ADDED = "rgba(166, 227, 161, 0.26)";
const WORD_REMOVED = "rgba(243, 139, 168, 0.26)";

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** Short form for the sidebar list, where full locale strings do not fit. */
function fmtTimeShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function signerOf(op: DocumentOperation) {
  const signer = op.action.context?.signer ?? null;
  return signer
    ? {
        address: signer.user?.address ?? null,
        app: signer.app?.name ?? null,
        key: signer.app?.key ?? null,
      }
    : null;
}

/** True when there is nothing to show yet — lets an editor skip its layout. */
export function isHistoryEmpty<T>(history: RevisionHistory<T>): boolean {
  return history.revisions.length === 0;
}

/**
 * The state to show instead of a history: still loading, failed, or a
 * document the reactor holds no operations for.
 */
export function RevisionHistoryEmpty<T>({
  history,
}: {
  history: RevisionHistory<T>;
}) {
  if (history.error) {
    return (
      <p className="py-2 text-xs" style={{ color: REMOVED }}>
        Could not load history: {history.error}
      </p>
    );
  }
  return (
    <p
      className="py-2 text-center text-xs"
      style={{ color: "var(--bai-text-faint)" }}
    >
      {history.isLoading
        ? "Loading history…"
        : `No operations recorded for this ${history.model.subject} yet.`}
    </p>
  );
}

export function RevisionScrubber<T>({
  history,
}: {
  history: RevisionHistory<T>;
}) {
  const {
    revisions,
    pos,
    selected,
    atHead,
    selectPos,
    jumpToCurrent,
    prevContentPos,
    nextContentPos,
    contentPositions,
    compare,
    toggleCompare,
    failures,
    model,
  } = history;

  if (revisions.length === 0) return <RevisionHistoryEmpty history={history} />;

  return (
    <div
      className="rounded-lg p-3"
      style={{
        backgroundColor: "var(--bai-deep)",
        border: "1px solid var(--bai-border)",
      }}
    >
      <div className="flex items-center justify-between gap-3 text-xs">
        <span style={{ color: "var(--bai-text-tertiary)" }}>
          Revision{" "}
          <span
            className="font-semibold tabular-nums"
            style={{ color: "var(--bai-text-secondary)" }}
          >
            {pos + 1}
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
              onClick={jumpToCurrent}
              className="rounded px-2 py-0.5 text-[11px]"
              style={{
                color: "var(--bai-text-tertiary)",
                backgroundColor: "var(--bai-hover)",
              }}
            >
              Jump to current
            </button>
          )}
          <button
            type="button"
            onClick={toggleCompare}
            aria-pressed={compare}
            className="rounded px-2 py-0.5 text-[11px]"
            style={{
              color: compare ? "#cba6f7" : "var(--bai-text-tertiary)",
              backgroundColor: compare
                ? "rgba(203, 166, 247, 0.15)"
                : "var(--bai-hover)",
            }}
            title={
              compare
                ? "Back to the document as it stood"
                : "What this operation changed"
            }
          >
            {compare ? "Hide changes" : "Show changes"}
          </button>
        </div>
      </div>
      {/* Most operations in a real log link a claim or flip a status; the
          steppers hop straight between the ones that wrote text, so a reader
          following the prose is not dragged through every bookkeeping step. */}
      <div className="mt-2 flex items-center gap-2">
        <Stepper
          dir={-1}
          target={prevContentPos}
          onStep={selectPos}
          revisions={revisions}
          model={model}
        />
        <input
          type="range"
          min={0}
          max={revisions.length - 1}
          value={pos}
          onChange={(e) => selectPos(Number(e.target.value))}
          className="min-w-0 flex-1 accent-[#cba6f7]"
          aria-label="Revision"
        />
        <Stepper
          dir={1}
          target={nextContentPos}
          onStep={selectPos}
          revisions={revisions}
          model={model}
        />
      </div>
      {contentPositions.length > 0 && contentPositions.length < revisions.length && (
        <p className="mt-1 text-[10px]" style={{ color: "var(--bai-text-faint)" }}>
          {contentPositions.length} of {revisions.length} operations changed the text
        </p>
      )}
      {/* Two fixed rows — what changed, then when and by whom. Dragging the
          slider must move nothing but the text: a wrapping row would reflow
          the snapshot below on every step, which is exactly what you are
          trying to read while scrubbing. Row 1 truncates instead of
          wrapping; row 2 keeps the timestamp in tabular figures so ticking
          digits cannot nudge the badge sideways. */}
      {selected && (
        <div className="mt-1.5 space-y-1 text-[11px]">
          <div
            className="flex items-center gap-1.5"
            style={{ color: "var(--bai-text-secondary)" }}
          >
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{
                backgroundColor:
                  OPERATION_KIND_COLOR[model.operationKind(selected.action.type)],
              }}
            />
            <span
              className="min-w-0 truncate"
              title={model.describeOperation(selected)}
            >
              {model.describeOperation(selected)}
            </span>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="shrink-0 tabular-nums"
              style={{ color: "var(--bai-text-faint)" }}
            >
              {fmtTime(selected.timestampUtcMs)}
            </span>
            <SignerBadge
              signer={signerOf(selected)}
              verdict={history.verdictFor(selected)}
            />
          </div>
        </div>
      )}
      {failures.length > 0 && (
        <p className="mt-1.5 text-[11px]" style={{ color: "#f9e2af" }}>
          {failures.length} operation{failures.length === 1 ? "" : "s"} could
          not be replayed and {failures.length === 1 ? "was" : "were"} skipped (
          {failures.map((f) => `#${f.index} ${f.type}`).join(", ")}).
        </p>
      )}
    </div>
  );
}

function Stepper<T>({
  dir,
  target,
  onStep,
  revisions,
  model,
}: {
  dir: -1 | 1;
  target: number | null;
  onStep: (pos: number) => void;
  revisions: DocumentOperation[];
  model: RevisionHistory<T>["model"];
}) {
  const op = target === null ? undefined : revisions.at(target);
  const label = dir < 0 ? "Previous text change" : "Next text change";
  return (
    <button
      type="button"
      disabled={target === null}
      onClick={() => target !== null && onStep(target)}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-xs disabled:opacity-30"
      style={{
        color: "var(--bai-text-tertiary)",
        backgroundColor: "var(--bai-hover)",
      }}
      aria-label={label}
      title={
        op
          ? `${label}: #${op.index} ${model.describeOperation(op)}`
          : `No ${dir < 0 ? "earlier" : "later"} text change`
      }
    >
      {dir < 0 ? "‹" : "›"}
    </button>
  );
}

export function RevisionSnapshotPanel<T>({
  history,
}: {
  history: RevisionHistory<T>;
}) {
  const { snapshot, diff, model } = history;
  if (snapshot === undefined) return null;

  return (
    <div
      className="rounded-lg p-4"
      style={{
        backgroundColor: "var(--bai-surface)",
        border: "1px solid var(--bai-border)",
      }}
    >
      {diff ? (
        <RevisionDiffView history={history} />
      ) : (
        model.renderSnapshot(snapshot)
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  The diff                                                          */
/* ------------------------------------------------------------------ */

function RevisionDiffView<T>({ history }: { history: RevisionHistory<T> }) {
  const { diff, pos, atHead, model, compareBase, setCompareBase } = history;
  // Expanded context is per comparison: the row indices mean nothing once
  // the reader moves the slider or switches base.
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  useEffect(() => setExpanded(new Set()), [pos, diff?.base]);

  if (!diff) return null;
  const { summary, rows, fields, anyChange, base, fromEmpty } = diff;
  // Label the sections only when there are two of them to tell apart.
  const labelled = summary.changed && fields.length > 0;

  const heading = fromEmpty
    ? `Revision 1 created the ${model.subject}`
    : base === "previous"
      ? `What revision ${pos + 1} changed`
      : `What changed since revision ${pos + 1}`;

  const nothing = fromEmpty
    ? "with no text or fields set"
    : base === "previous"
      ? "This operation left the document as it was."
      : "Nothing has changed since this revision.";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px]">
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1"
          style={{ color: "var(--bai-text-tertiary)" }}
        >
          <span style={{ color: "var(--bai-text-secondary)" }}>{heading}</span>
          {summary.added > 0 && (
            <span style={{ color: ADDED }}>+{summary.added} lines</span>
          )}
          {summary.removed > 0 && (
            <span style={{ color: REMOVED }}>−{summary.removed} lines</span>
          )}
          {fields.length > 0 && (
            <span>
              {fields.length} field{fields.length === 1 ? "" : "s"}
            </span>
          )}
          {!anyChange && <span>{nothing}</span>}
        </div>
        {/* The base is a reader preference that survives scrubbing; at the
            head there is only one meaningful base, so the choice is hidden
            rather than shown disabled. */}
        {!atHead && (
          <div
            className="flex items-center gap-0.5 rounded p-0.5"
            style={{ backgroundColor: "var(--bai-hover)" }}
            role="radiogroup"
            aria-label="Compare against"
          >
            {(
              [
                ["previous", "vs previous"],
                ["current", "vs current"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={compareBase === value}
                onClick={() => setCompareBase(value)}
                className="rounded px-1.5 py-px text-[10px]"
                style={
                  compareBase === value
                    ? {
                        backgroundColor: "rgba(203, 166, 247, 0.18)",
                        color: "#cba6f7",
                      }
                    : { color: "var(--bai-text-muted)" }
                }
                title={
                  value === "previous"
                    ? "What this operation changed"
                    : "What has changed between this revision and now"
                }
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {!summary.changed && fields.length > 0 && (
        <p className="text-[11px]" style={{ color: "var(--bai-text-faint)" }}>
          {base === "previous"
            ? `This operation did not change the ${model.bodyLabel.toLowerCase()}.`
            : `The ${model.bodyLabel.toLowerCase()} is the same as now.`}
        </p>
      )}

      {summary.changed && (
        <section>
          {labelled && <SectionLabel>{model.bodyLabel}</SectionLabel>}
          <div
            className="overflow-y-auto rounded scrollbar-thin"
            style={{ backgroundColor: "var(--bai-deep)", maxHeight: "60vh" }}
          >
            {rows.map((row, i) => (
              <DiffRowView
                key={i}
                row={row}
                expanded={expanded.has(i)}
                onToggle={() =>
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(i)) next.delete(i);
                    else next.add(i);
                    return next;
                  })
                }
              />
            ))}
          </div>
        </section>
      )}

      {fields.length > 0 && (
        <section>
          {labelled && <SectionLabel>Also changed</SectionLabel>}
          <dl className="space-y-1">
            {fields.map((f) => (
              <FieldChangeView key={f.label} field={f} />
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h5
      className="mb-1 text-[10px] font-semibold uppercase tracking-wider"
      style={{ color: "var(--bai-text-muted)" }}
    >
      {children}
    </h5>
  );
}

/** Shared row chrome: a fixed gutter mark and wrapping text beside it. */
function Line({
  mark,
  tint,
  children,
  onClick,
  title,
}: {
  mark: string;
  tint?: string;
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
}) {
  const body = (
    <>
      <span
        aria-hidden
        className="w-3 shrink-0 select-none text-center"
        style={{ color: "var(--bai-text-faint)" }}
      >
        {mark}
      </span>
      {/* `whitespace-pre-wrap` keeps markdown indentation while still
          wrapping, so prose never needs a horizontal scrollbar. */}
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
        {children}
      </span>
    </>
  );
  const className =
    "flex items-start gap-1.5 px-2 py-px font-mono text-[11px] leading-relaxed";
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`${className} w-full text-left hover:bg-[var(--bai-hover)]`}
      style={{ backgroundColor: tint }}
    >
      {body}
    </button>
  ) : (
    <div className={className} style={{ backgroundColor: tint }}>
      {body}
    </div>
  );
}

function Words({
  tokens,
  side,
}: {
  tokens: DiffToken[];
  side: "before" | "after";
}) {
  const marked = side === "before" ? "removed" : "added";
  return (
    <>
      {tokensForSide(tokens, side).map((t, i) =>
        t.kind === marked ? (
          <span
            key={i}
            className="rounded-sm"
            style={{
              backgroundColor: side === "before" ? WORD_REMOVED : WORD_ADDED,
              color: side === "before" ? REMOVED : ADDED,
              textDecoration: side === "before" ? "line-through" : undefined,
            }}
          >
            {t.text}
          </span>
        ) : (
          <span key={i}>{t.text}</span>
        ),
      )}
    </>
  );
}

function DiffRowView({
  row,
  expanded,
  onToggle,
}: {
  row: DiffRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (row.kind === "gap") {
    return (
      <>
        <Line
          mark={expanded ? "⌃" : "⌄"}
          onClick={onToggle}
          title={expanded ? "Hide unchanged lines" : "Show unchanged lines"}
        >
          <span style={{ color: "var(--bai-text-faint)" }}>
            {expanded
              ? `hide ${row.hidden} unchanged line${row.hidden === 1 ? "" : "s"}`
              : `${row.hidden} unchanged line${row.hidden === 1 ? "" : "s"}`}
          </span>
        </Line>
        {expanded &&
          row.lines.map((l, i) => (
            <Line key={i} mark=" ">
              <span style={{ color: "var(--bai-text-faint)" }}>
                {l.text || " "}
              </span>
            </Line>
          ))}
      </>
    );
  }

  if (row.kind === "same") {
    return (
      <Line mark=" ">
        <span style={{ color: "var(--bai-text-faint)" }}>{row.text || " "}</span>
      </Line>
    );
  }

  if (row.kind === "added" || row.kind === "removed") {
    const isAdd = row.kind === "added";
    return (
      <Line mark={isAdd ? "+" : "−"} tint={isAdd ? ROW_TINT_ADDED : ROW_TINT_REMOVED}>
        <span style={{ color: isAdd ? ADDED : REMOVED }}>{row.text || " "}</span>
      </Line>
    );
  }

  // A rewrite: same line, different words. Both sides are shown, but the
  // text stays neutral and only the differing words are marked — that is
  // the whole point of pairing them.
  return (
    <>
      <Line mark="−" tint={ROW_TINT_REMOVED}>
        <span style={{ color: "var(--bai-text-secondary)" }}>
          {row.tokens ? (
            <Words tokens={row.tokens} side="before" />
          ) : (
            row.before || " "
          )}
        </span>
      </Line>
      <Line mark="+" tint={ROW_TINT_ADDED}>
        <span style={{ color: "var(--bai-text-secondary)" }}>
          {row.tokens ? (
            <Words tokens={row.tokens} side="after" />
          ) : (
            row.after || " "
          )}
        </span>
      </Line>
    </>
  );
}

function FieldChangeView({ field }: { field: RevisionFieldChange }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
      <dt
        className="shrink-0 font-medium"
        style={{ color: "var(--bai-text-muted)" }}
      >
        {field.label}
      </dt>
      <dd className="min-w-0 break-words" style={{ color: "var(--bai-text-secondary)" }}>
        {field.tokens ? (
          <>
            <Words tokens={field.tokens} side="before" />
            <span aria-hidden style={{ color: "var(--bai-text-faint)" }}>
              {"  →  "}
            </span>
            <Words tokens={field.tokens} side="after" />
          </>
        ) : (
          <>
            <span
              style={{
                color: REMOVED,
                textDecoration: field.before === null ? undefined : "line-through",
              }}
            >
              {field.before ?? <em style={{ color: "var(--bai-text-faint)" }}>unset</em>}
            </span>
            <span aria-hidden style={{ color: "var(--bai-text-faint)" }}>
              {"  →  "}
            </span>
            <span style={{ color: ADDED }}>
              {field.after ?? <em style={{ color: "var(--bai-text-faint)" }}>unset</em>}
            </span>
          </>
        )}
      </dd>
    </div>
  );
}

export function RevisionOperationList<T>({
  history,
  className = "",
}: {
  history: RevisionHistory<T>;
  /** Extra classes for the scrolling list, if a layout needs to override. */
  className?: string;
}) {
  const { revisions, operations, pos, selectPos, model } = history;
  const selectedRef = useRef<HTMLLIElement | null>(null);

  // Scrubbing with the slider should keep the matching row in view.
  // `block: "nearest"` confines the scroll to the list's own container.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [pos]);

  if (revisions.length === 0) return null;
  const undone = operations.length - revisions.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h4
        className="mb-2 shrink-0 text-xs font-semibold uppercase tracking-wider"
        style={{ color: "var(--bai-text-muted)" }}
      >
        Operations ({revisions.length}
        {undone > 0 ? `, ${undone} undone` : ""})
      </h4>
      <ol
        className={`min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1 scrollbar-thin ${className}`}
      >
        {[...revisions].reverse().map((op, i) => {
          const p = revisions.length - 1 - i;
          const isSelected = p === pos;
          return (
            <li key={op.index} ref={isSelected ? selectedRef : null}>
              <button
                type="button"
                onClick={() => selectPos(p)}
                className="w-full rounded px-2 py-1 text-left text-[11px]"
                style={{
                  backgroundColor: isSelected
                    ? "rgba(203, 166, 247, 0.12)"
                    : "transparent",
                  color: "var(--bai-text-secondary)",
                }}
                aria-current={isSelected ? "true" : undefined}
                title={model.describeOperation(op)}
              >
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{
                      backgroundColor:
                        OPERATION_KIND_COLOR[model.operationKind(op.action.type)],
                    }}
                  />
                  <span
                    className="shrink-0 tabular-nums"
                    style={{ color: "var(--bai-text-faint)" }}
                  >
                    #{op.index}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {model.describeOperation(op)}
                  </span>
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 pl-[1.125rem]">
                  <span
                    className="shrink-0 tabular-nums"
                    style={{ color: "var(--bai-text-faint)" }}
                  >
                    {fmtTimeShort(op.timestampUtcMs)}
                  </span>
                  <SignerBadge
                    compact
                    signer={signerOf(op)}
                    verdict={history.verdictFor(op)}
                  />
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** A chip for a snapshot's enum-ish fields (status, type). */
export function RevisionChip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="rounded px-1.5 py-0.5 font-medium uppercase tracking-wide"
      style={{
        backgroundColor: "var(--bai-hover)",
        color: "var(--bai-text-tertiary)",
      }}
    >
      {children}
    </span>
  );
}
