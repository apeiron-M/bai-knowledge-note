import { useState } from "react";
import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import { generateId } from "document-model";
import { actions } from "document-models/work-breakdown-structure";
import type {
  Goal,
  WorkBreakdownStructureAction,
} from "document-models/work-breakdown-structure";
import { StatusChipMenu } from "./StatusChipMenu.js";

type Dispatch = DocumentDispatch<WorkBreakdownStructureAction>;

type GoalRowProps = {
  goal: Goal;
  depth: number;
  hasChildren: boolean;
  collapsed: boolean;
  onToggleCollapse: (id: string) => void;
  /** Ensures a row is expanded (idempotent) — used after a quick-add so the
   * new child is visible even if the parent was collapsed. */
  onExpand: (id: string) => void;
  /** Full flat goals array (not just the visible subset) — needed to
   * compute sibling order for move up/down regardless of collapse state. */
  allGoals: Goal[];
  selected: boolean;
  onSelect: (id: string) => void;
  dispatch: Dispatch;
};

function countDescendants(goals: Goal[], id: string): number {
  let count = 0;
  for (const g of goals) {
    if (g.parentId === id) count += 1 + countDescendants(goals, g.id);
  }
  return count;
}

export function GoalRow({
  goal,
  depth,
  hasChildren,
  collapsed,
  onToggleCollapse,
  onExpand,
  allGoals,
  selected,
  onSelect,
  dispatch,
}: GoalRowProps) {
  const [addingChild, setAddingChild] = useState(false);
  const [childDescription, setChildDescription] = useState("");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // Siblings share this goal's parentId; array order is already
  // depth-first (guaranteed by the reducer), so filtering preserves
  // correct sibling order without needing to sort.
  const siblings = allGoals.filter((g) => g.parentId === goal.parentId);
  const siblingIndex = siblings.findIndex((g) => g.id === goal.id);
  const canMoveUp = siblingIndex > 0;
  const canMoveDown = siblingIndex >= 0 && siblingIndex < siblings.length - 1;

  function handleMoveUp() {
    if (!canMoveUp) return;
    const prevSibling = siblings[siblingIndex - 1];
    dispatch(
      actions.reorder({
        id: goal.id,
        parentId: goal.parentId,
        insertBefore: prevSibling.id,
      }),
    );
  }

  function handleMoveDown() {
    if (!canMoveDown) return;
    const nextIndex = siblingIndex + 2;
    if (nextIndex < siblings.length) {
      dispatch(
        actions.reorder({
          id: goal.id,
          parentId: goal.parentId,
          insertBefore: siblings[nextIndex].id,
        }),
      );
    } else {
      // No sibling two ahead — moving past the immediate next sibling
      // means becoming last, so insertBefore is omitted entirely.
      dispatch(actions.reorder({ id: goal.id, parentId: goal.parentId }));
    }
  }

  function handleAddChild() {
    const trimmed = childDescription.trim();
    if (!trimmed) return;
    dispatch(
      actions.createGoal({
        id: generateId(),
        description: trimmed,
        parentId: goal.id,
      }),
    );
    setChildDescription("");
    setAddingChild(false);
    if (collapsed) onExpand(goal.id);
  }

  return (
    <div>
      <div
        className="group flex items-center gap-2 rounded-lg py-2 pr-3"
        style={{
          paddingLeft: 12 + depth * 20,
          backgroundColor: selected ? "var(--bai-hover)" : "var(--bai-surface)",
          border: `1px solid ${selected ? "var(--bai-accent)" : "var(--bai-border)"}`,
        }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggleCollapse(goal.id)}
            className="shrink-0 rounded p-0.5 hover:bg-white/5"
            aria-label={collapsed ? "Expand" : "Collapse"}
          >
            <svg
              className={`h-3 w-3 transition-transform ${collapsed ? "" : "rotate-90"}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        ) : (
          <span className="inline-block h-3 w-3 shrink-0" />
        )}

        <button
          type="button"
          onClick={() => onSelect(goal.id)}
          className="min-w-0 flex-1 truncate text-left text-sm"
          style={{ color: "var(--bai-text-secondary)" }}
        >
          {goal.description}
        </button>

        {goal.assignee && (
          <span
            className="shrink-0 text-[10px]"
            style={{ color: "var(--bai-text-tertiary)" }}
          >
            {goal.assignee}
          </span>
        )}

        {goal.notes.length > 0 && (
          <span
            className="shrink-0 text-[10px]"
            style={{ color: "var(--bai-text-faint)" }}
          >
            {goal.notes.length} note{goal.notes.length !== 1 ? "s" : ""}
          </span>
        )}

        <StatusChipMenu goal={goal} dispatch={dispatch} />

        <div
          className={`flex shrink-0 items-center gap-0.5 transition-opacity ${
            addingChild ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
        >
          <button
            type="button"
            onClick={() => setAddingChild((v) => !v)}
            title="Add sub-goal"
            className="rounded p-1 hover:bg-white/5"
            style={{ color: "var(--bai-text-faint)" }}
          >
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <button
            type="button"
            disabled={!canMoveUp}
            onClick={handleMoveUp}
            title="Move up"
            className="rounded p-1 hover:bg-white/5 disabled:opacity-30"
            style={{ color: "var(--bai-text-faint)" }}
          >
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M18 15l-6-6-6 6" />
            </svg>
          </button>
          <button
            type="button"
            disabled={!canMoveDown}
            onClick={handleMoveDown}
            title="Move down"
            className="rounded p-1 hover:bg-white/5 disabled:opacity-30"
            style={{ color: "var(--bai-text-faint)" }}
          >
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setDeleteConfirmOpen(true)}
            title="Delete goal"
            className="rounded p-1 hover:bg-red-500/10 hover:text-red-400"
            style={{ color: "var(--bai-text-faint)" }}
          >
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
            </svg>
          </button>
        </div>
      </div>

      {addingChild && (
        <div
          className="mt-1 flex items-center gap-2 rounded-lg py-1.5 pr-3"
          style={{ paddingLeft: 12 + (depth + 1) * 20 }}
        >
          <input
            autoFocus
            type="text"
            value={childDescription}
            onChange={(e) => setChildDescription(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddChild();
              if (e.key === "Escape") {
                setAddingChild(false);
                setChildDescription("");
              }
            }}
            placeholder="Sub-goal description..."
            className="min-w-0 flex-1 rounded-md px-2 py-1 text-xs outline-none"
            style={{
              backgroundColor: "var(--bai-bg)",
              color: "var(--bai-text-secondary)",
              border: "1px solid var(--bai-border)",
            }}
          />
          <button
            type="button"
            onClick={handleAddChild}
            disabled={!childDescription.trim()}
            className="shrink-0 rounded-md px-2 py-1 text-xs font-medium disabled:opacity-40"
            style={{
              backgroundColor: "var(--bai-accent)",
              color: "var(--bai-accent-text)",
            }}
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => {
              setAddingChild(false);
              setChildDescription("");
            }}
            className="shrink-0 rounded-md px-2 py-1 text-xs"
            style={{ color: "var(--bai-text-faint)" }}
          >
            Cancel
          </button>
        </div>
      )}

      {deleteConfirmOpen && (
        <DeleteGoalDialog
          description={goal.description}
          descendantCount={countDescendants(allGoals, goal.id)}
          onCancel={() => setDeleteConfirmOpen(false)}
          onConfirm={() => {
            dispatch(actions.deleteGoal({ id: goal.id }));
            setDeleteConfirmOpen(false);
          }}
        />
      )}
    </div>
  );
}

/** Delete confirmation — mirrors SourceList's DeleteModal styling. */
function DeleteGoalDialog({
  description,
  descendantCount,
  onCancel,
  onConfirm,
}: {
  description: string;
  descendantCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div
        className="relative z-10 w-[400px] rounded-2xl p-6 shadow-2xl"
        style={{
          backgroundColor: "var(--bai-surface)",
          border: "1px solid var(--bai-border)",
        }}
      >
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-500/10">
            <svg
              className="h-5 w-5 text-red-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <h3
              className="text-sm font-semibold"
              style={{ color: "var(--bai-text)" }}
            >
              Delete Goal
            </h3>
            <p
              className="mt-1.5 text-xs"
              style={{ color: "var(--bai-text-tertiary)" }}
            >
              Delete{" "}
              <span
                className="font-medium"
                style={{ color: "var(--bai-text-secondary)" }}
              >
                {description}
              </span>
              {descendantCount > 0
                ? ` and its ${descendantCount} sub-goal${descendantCount !== 1 ? "s" : ""}? This cannot be undone.`
                : "? This cannot be undone."}
            </p>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl px-4 py-2 text-sm font-medium transition-colors hover:bg-white/5"
            style={{ color: "var(--bai-text-tertiary)" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-xl bg-red-500/20 px-4 py-2 text-sm font-semibold text-red-400 ring-1 ring-red-500/30 transition-colors hover:bg-red-500/30"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
