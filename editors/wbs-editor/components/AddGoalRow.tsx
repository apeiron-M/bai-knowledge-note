import { useState } from "react";
import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import { generateId } from "document-model";
import { actions } from "document-models/work-breakdown-structure";
import type { WorkBreakdownStructureAction } from "document-models/work-breakdown-structure";

type Dispatch = DocumentDispatch<WorkBreakdownStructureAction>;

type AddGoalRowProps = {
  /** null adds a root goal (bottom-of-tree control); a goal id is not used
   * here today (GoalRow implements its own compact add-child affordance)
   * but the prop is kept generic so this row can add at any level. */
  parentId: string | null;
  dispatch: Dispatch;
};

/** Ghost "+ Add goal" control that expands into an inline text input. */
export function AddGoalRow({ parentId, dispatch }: AddGoalRowProps) {
  const [adding, setAdding] = useState(false);
  const [description, setDescription] = useState("");

  function handleAdd() {
    const trimmed = description.trim();
    if (!trimmed) return;
    dispatch(
      actions.createGoal({ id: generateId(), description: trimmed, parentId }),
    );
    setDescription("");
    setAdding(false);
  }

  function handleCancel() {
    setAdding(false);
    setDescription("");
  }

  if (!adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="mt-1 flex w-full items-center gap-1.5 rounded-lg px-3 py-2 text-xs transition-colors hover:bg-white/5"
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
        Add goal
      </button>
    );
  }

  return (
    <div
      className="mt-1 flex items-center gap-2 rounded-lg px-3 py-2"
      style={{
        backgroundColor: "var(--bai-bg)",
        border: "1px solid var(--bai-border)",
      }}
    >
      <input
        autoFocus
        type="text"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleAdd();
          if (e.key === "Escape") handleCancel();
        }}
        placeholder="Goal description..."
        className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        style={{ color: "var(--bai-text-secondary)" }}
      />
      <button
        type="button"
        onClick={handleAdd}
        disabled={!description.trim()}
        className="shrink-0 rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-40"
        style={{
          backgroundColor: "var(--bai-accent)",
          color: "var(--bai-accent-text)",
        }}
      >
        Add
      </button>
      <button
        type="button"
        onClick={handleCancel}
        className="shrink-0 rounded-md px-2 py-1 text-xs"
        style={{ color: "var(--bai-text-faint)" }}
      >
        Cancel
      </button>
    </div>
  );
}
