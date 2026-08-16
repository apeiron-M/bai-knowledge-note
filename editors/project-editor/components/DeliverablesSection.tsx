import { useState } from "react";
import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import { generateId } from "document-model";
import { actions } from "document-models/project";
import type {
  Deliverable,
  DeliverableStatus,
  ProjectAction,
  ProjectGlobalState,
} from "document-models/project";
import type { Goal } from "document-models/work-breakdown-structure";
import {
  DELIVERABLE_STATUS_META,
  GOAL_STATUS_META,
} from "../../shared/project-status.js";
import { useLinkedWbs } from "./WbsPanel.js";

type Dispatch = DocumentDispatch<ProjectAction>;

// Copied from ReferencesSection.tsx (same reasoning: the generated zod
// schema validates `url` with `z.url()`, and the action creator parses
// its input synchronously — an invalid string like "example.com" throws
// inside the onClick handler instead of surfacing as a normal reducer
// error, so it must be screened out client-side before dispatching).
function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

const ALL_DELIVERABLE_STATUSES: DeliverableStatus[] = [
  "PLANNED",
  "IN_PROGRESS",
  "DELIVERED",
  "CANCELLED",
];

type DeliverablesSectionProps = {
  state: ProjectGlobalState;
  dispatch: Dispatch;
};

export function DeliverablesSection({
  state,
  dispatch,
}: DeliverablesSectionProps) {
  const { goals } = useLinkedWbs();
  const deliverables = state.deliverables;
  const deliveredCount = deliverables.filter(
    (d) => d.status === "DELIVERED",
  ).length;

  return (
    <div
      className="rounded-xl p-5"
      style={{
        backgroundColor: "var(--bai-surface)",
        border: "1px solid var(--bai-border)",
      }}
    >
      <h3
        className="mb-3 text-xs font-semibold uppercase tracking-wider"
        style={{ color: "var(--bai-text-muted)" }}
      >
        Deliverables ({deliveredCount}/{deliverables.length})
      </h3>

      {deliverables.length === 0 ? (
        <p
          className="py-4 text-center text-sm"
          style={{ color: "var(--bai-text-faint)" }}
        >
          No deliverables yet.
        </p>
      ) : (
        <div className="space-y-1.5">
          {deliverables.map((d) => (
            <DeliverableRow
              key={d.id}
              deliverable={d}
              goals={goals}
              dispatch={dispatch}
            />
          ))}
        </div>
      )}

      <AddDeliverableRow goals={goals} dispatch={dispatch} />
    </div>
  );
}

function DeliverableRow({
  deliverable,
  goals,
  dispatch,
}: {
  deliverable: Deliverable;
  goals: Goal[];
  dispatch: Dispatch;
}) {
  const linkedGoal = deliverable.goalRef
    ? goals.find((g) => g.id === deliverable.goalRef)
    : undefined;

  return (
    <div
      className="group flex items-center gap-2 rounded-lg px-3 py-2"
      style={{
        backgroundColor: "var(--bai-bg)",
        border: "1px solid var(--bai-border)",
      }}
    >
      <input
        type="text"
        defaultValue={deliverable.title}
        onBlur={(e) => {
          const value = e.target.value.trim();
          if (!value) {
            e.currentTarget.value = deliverable.title;
            return;
          }
          if (value !== deliverable.title) {
            dispatch(
              actions.updateDeliverable({ id: deliverable.id, title: value }),
            );
          }
        }}
        className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        style={{ color: "var(--bai-text-secondary)" }}
      />

      <DeliverableStatusMenu deliverable={deliverable} dispatch={dispatch} />

      {linkedGoal && (
        <span
          className="max-w-[140px] shrink-0 truncate rounded-full border px-2 py-0.5 text-[10px]"
          title={linkedGoal.description}
          style={{
            color: GOAL_STATUS_META[linkedGoal.status].fg,
            backgroundColor: GOAL_STATUS_META[linkedGoal.status].bg,
            borderColor: GOAL_STATUS_META[linkedGoal.status].border,
          }}
        >
          {linkedGoal.description}
        </span>
      )}

      {deliverable.url && (
        <a
          href={deliverable.url}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-xs hover:underline"
          style={{ color: "var(--bai-accent)" }}
          title={deliverable.url}
        >
          Link
        </a>
      )}

      <button
        type="button"
        onClick={() =>
          dispatch(actions.removeDeliverable({ id: deliverable.id }))
        }
        className="shrink-0 rounded p-1 opacity-0 transition-all hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
        style={{ color: "var(--bai-text-faint)" }}
        title="Remove deliverable"
      >
        <svg
          className="h-3.5 w-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

function DeliverableStatusMenu({
  deliverable,
  dispatch,
}: {
  deliverable: Deliverable;
  dispatch: Dispatch;
}) {
  const [open, setOpen] = useState(false);
  const meta = DELIVERABLE_STATUS_META[deliverable.status];

  function handlePick(status: DeliverableStatus) {
    setOpen(false);
    if (status === "DELIVERED") {
      dispatch(
        actions.setDeliverableStatus({
          id: deliverable.id,
          status,
          deliveredAt: new Date().toISOString(),
        }),
      );
    } else {
      dispatch(actions.setDeliverableStatus({ id: deliverable.id, status }));
    }
  }

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-full border px-2 py-0.5 text-[10px] font-medium"
        style={{
          color: meta.fg,
          backgroundColor: meta.bg,
          borderColor: meta.border,
        }}
      >
        {meta.label}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 z-50 mt-1 max-h-[60vh] w-36 overflow-y-auto rounded-xl p-1 shadow-2xl"
            style={{
              backgroundColor: "var(--bai-surface)",
              border: "1px solid var(--bai-border)",
            }}
          >
            {ALL_DELIVERABLE_STATUSES.map((status) => {
              const m = DELIVERABLE_STATUS_META[status];
              const isCurrent = status === deliverable.status;
              return (
                <button
                  key={status}
                  type="button"
                  onClick={() => handlePick(status)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-white/5"
                  style={{
                    color: isCurrent ? m.fg : "var(--bai-text-secondary)",
                  }}
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: m.fg }}
                  />
                  {m.label}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function AddDeliverableRow({
  goals,
  dispatch,
}: {
  goals: Goal[];
  dispatch: Dispatch;
}) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [goalRef, setGoalRef] = useState("");
  const [url, setUrl] = useState("");
  const trimmedUrl = url.trim();
  const urlInvalid = trimmedUrl.length > 0 && !isValidUrl(trimmedUrl);

  function reset() {
    setTitle("");
    setGoalRef("");
    setUrl("");
  }

  function handleAdd() {
    const trimmed = title.trim();
    if (!trimmed || urlInvalid) return;
    dispatch(
      actions.addDeliverable({
        id: generateId(),
        title: trimmed,
        goalRef: goalRef || undefined,
        url: trimmedUrl || undefined,
      }),
    );
    reset();
    setAdding(false);
  }

  if (!adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="mt-2 flex w-full items-center gap-1.5 rounded-lg px-3 py-2 text-xs transition-colors hover:bg-white/5"
        style={{
          color: "var(--bai-text-faint)",
          border: "1px dashed var(--bai-border)",
        }}
      >
        <svg
          className="h-3 w-3"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        Add deliverable
      </button>
    );
  }

  return (
    <div
      className="mt-2 space-y-2 rounded-lg p-3"
      style={{
        backgroundColor: "var(--bai-bg)",
        border: "1px solid var(--bai-border)",
      }}
    >
      <input
        autoFocus
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleAdd();
          if (e.key === "Escape") {
            reset();
            setAdding(false);
          }
        }}
        placeholder="Deliverable title..."
        className="w-full rounded-md px-2 py-1 text-xs outline-none"
        style={{
          backgroundColor: "var(--bai-surface)",
          color: "var(--bai-text-secondary)",
          border: "1px solid var(--bai-border)",
        }}
      />
      <div className="flex items-center gap-2">
        {goals.length > 0 && (
          <select
            value={goalRef}
            onChange={(e) => setGoalRef(e.target.value)}
            className="min-w-0 flex-1 rounded-md px-2 py-1 text-xs"
            style={{
              backgroundColor: "var(--bai-surface)",
              color: "var(--bai-text-secondary)",
              border: "1px solid var(--bai-border)",
            }}
          >
            <option value="">No linked goal</option>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.description}
              </option>
            ))}
          </select>
        )}
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="URL (optional)"
          className="min-w-0 flex-1 rounded-md px-2 py-1 text-xs outline-none"
          style={{
            backgroundColor: "var(--bai-surface)",
            color: "var(--bai-text-secondary)",
            border: "1px solid var(--bai-border)",
          }}
        />
      </div>
      {urlInvalid && (
        <p className="mt-1 text-[10px] text-red-400">
          Must be a valid URL (e.g. https://...)
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            reset();
            setAdding(false);
          }}
          className="rounded-md px-2 py-1 text-xs"
          style={{ color: "var(--bai-text-faint)" }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleAdd}
          disabled={!title.trim() || urlInvalid}
          className="rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-40"
          style={{
            backgroundColor: "var(--bai-accent)",
            color: "var(--bai-accent-text)",
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}
