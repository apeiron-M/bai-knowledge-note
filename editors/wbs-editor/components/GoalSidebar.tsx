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

type GoalSidebarProps = {
  goal: Goal;
  /** Full flat goals array, used for the dependencies checklist. */
  allGoals: Goal[];
  dispatch: Dispatch;
  onClose: () => void;
};

const SECTION_LABEL_STYLE = { color: "var(--bai-text-muted)" };

/**
 * Right-rail detail panel for a selected goal. The caller mounts this with
 * `key={goal.id}` so every uncontrolled field (description/assignee/outcome)
 * re-initializes cleanly when the selection changes, instead of bleeding
 * draft text from the previously selected goal.
 */
export function GoalSidebar({
  goal,
  allGoals,
  dispatch,
  onClose,
}: GoalSidebarProps) {
  const [author, setAuthor] = useState("");
  const [noteDraft, setNoteDraft] = useState("");

  function toggleDependency(depId: string, currentlyChecked: boolean) {
    if (currentlyChecked) {
      dispatch(
        actions.removeDependencies({ id: goal.id, dependencies: [depId] }),
      );
    } else {
      dispatch(actions.addDependencies({ id: goal.id, dependencies: [depId] }));
    }
  }

  function handleAddNote() {
    const trimmed = noteDraft.trim();
    if (!trimmed) return;
    dispatch(
      actions.addNote({
        goalId: goal.id,
        noteId: generateId(),
        note: trimmed,
        author: author.trim() || undefined,
        timestamp: new Date().toISOString(),
      }),
    );
    setNoteDraft("");
  }

  const otherGoals = allGoals.filter((g) => g.id !== goal.id);

  return (
    <div
      className="flex h-full w-[360px] shrink-0 flex-col border-l"
      style={{
        borderColor: "var(--bai-border)",
        backgroundColor: "var(--bai-surface)",
      }}
    >
      <div
        className="flex items-center justify-between border-b px-4 py-3"
        style={{ borderColor: "var(--bai-border)" }}
      >
        <h3
          className="text-xs font-semibold uppercase tracking-wider"
          style={SECTION_LABEL_STYLE}
        >
          Goal Details
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 hover:bg-white/5"
          style={{ color: "var(--bai-text-faint)" }}
          aria-label="Close"
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span
              className="text-xs font-semibold uppercase tracking-wider"
              style={SECTION_LABEL_STYLE}
            >
              Status
            </span>
            <StatusChipMenu goal={goal} dispatch={dispatch} />
          </div>
          {goal.status === "BLOCKED" && goal.blockReason && (
            <p
              className="mt-1 rounded-lg px-3 py-2 text-xs"
              style={{
                backgroundColor: "rgba(248, 113, 113, 0.1)",
                color: "rgba(252, 165, 165, 1)",
                border: "1px solid rgba(248, 113, 113, 0.3)",
              }}
            >
              {goal.blockReason}
            </p>
          )}
        </div>

        <div>
          <label
            className="mb-1.5 block text-xs font-semibold uppercase tracking-wider"
            style={SECTION_LABEL_STYLE}
          >
            Description
          </label>
          <textarea
            defaultValue={goal.description}
            onBlur={(e) => {
              const value = e.target.value.trim();
              if (!value) {
                // Reset to the document's current description
                e.currentTarget.value = goal.description;
                return;
              }
              if (value !== goal.description) {
                dispatch(
                  actions.updateGoalDescription({
                    id: goal.id,
                    description: value,
                  }),
                );
              }
            }}
            rows={3}
            className="w-full resize-none rounded-lg px-3 py-2 text-sm outline-none"
            style={{
              backgroundColor: "var(--bai-bg)",
              color: "var(--bai-text-secondary)",
              border: "1px solid var(--bai-border)",
            }}
          />
        </div>

        <div>
          <label
            className="mb-1.5 block text-xs font-semibold uppercase tracking-wider"
            style={SECTION_LABEL_STYLE}
          >
            Assignee
          </label>
          <input
            type="text"
            defaultValue={goal.assignee ?? ""}
            onBlur={(e) => {
              const next = e.target.value.trim() || null;
              if (next !== (goal.assignee ?? null)) {
                dispatch(
                  actions.assignGoal({
                    id: goal.id,
                    assignee: next,
                  }),
                );
              }
            }}
            placeholder="Unassigned"
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{
              backgroundColor: "var(--bai-bg)",
              color: "var(--bai-text-secondary)",
              border: "1px solid var(--bai-border)",
            }}
          />
        </div>

        <div>
          <label
            className="mb-1.5 block text-xs font-semibold uppercase tracking-wider"
            style={SECTION_LABEL_STYLE}
          >
            Outcome
          </label>
          <textarea
            defaultValue={goal.outcome ?? ""}
            onBlur={(e) => {
              const next = e.target.value.trim() || null;
              if (next !== (goal.outcome ?? null)) {
                dispatch(
                  actions.setOutcome({
                    id: goal.id,
                    outcome: next,
                  }),
                );
              }
            }}
            placeholder="No outcome recorded yet"
            rows={2}
            className="w-full resize-none rounded-lg px-3 py-2 text-sm outline-none"
            style={{
              backgroundColor: "var(--bai-bg)",
              color: "var(--bai-text-secondary)",
              border: "1px solid var(--bai-border)",
            }}
          />
        </div>

        <div>
          <label
            className="mb-1.5 block text-xs font-semibold uppercase tracking-wider"
            style={SECTION_LABEL_STYLE}
          >
            Dependencies
          </label>
          {otherGoals.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--bai-text-faint)" }}>
              No other goals to depend on.
            </p>
          ) : (
            <div
              className="max-h-40 space-y-0.5 overflow-y-auto rounded-lg p-1"
              style={{ border: "1px solid var(--bai-border)" }}
            >
              {otherGoals.map((g) => {
                const checked = goal.dependencies.includes(g.id);
                return (
                  <label
                    key={g.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-white/5"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleDependency(g.id, checked)}
                    />
                    <span
                      className="truncate"
                      style={{ color: "var(--bai-text-secondary)" }}
                    >
                      {g.description}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <label
            className="mb-1.5 block text-xs font-semibold uppercase tracking-wider"
            style={SECTION_LABEL_STYLE}
          >
            Notes ({goal.notes.length})
          </label>
          <div className="space-y-2">
            {goal.notes.map((n) => (
              <div
                key={n.id}
                className="group rounded-lg px-3 py-2"
                style={{
                  backgroundColor: "var(--bai-bg)",
                  border: "1px solid var(--bai-border)",
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p
                      className="text-xs"
                      style={{ color: "var(--bai-text-secondary)" }}
                    >
                      {n.note}
                    </p>
                    <p
                      className="mt-1 text-[10px]"
                      style={{ color: "var(--bai-text-faint)" }}
                    >
                      {n.author ?? "Unknown"}
                      {n.timestamp &&
                        ` · ${new Date(n.timestamp).toLocaleString()}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      dispatch(
                        actions.removeNote({ goalId: goal.id, noteId: n.id }),
                      )
                    }
                    className="shrink-0 rounded p-1 opacity-0 transition-all hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
                    style={{ color: "var(--bai-text-faint)" }}
                    title="Delete note"
                  >
                    <svg
                      className="h-3 w-3"
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
            ))}
          </div>

          <div className="mt-2 space-y-1.5">
            <input
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="Your name (optional)"
              className="w-full rounded-lg px-3 py-1.5 text-xs outline-none"
              style={{
                backgroundColor: "var(--bai-bg)",
                color: "var(--bai-text-secondary)",
                border: "1px solid var(--bai-border)",
              }}
            />
            <textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  handleAddNote();
                }
              }}
              placeholder="Add a note... (Ctrl+Enter to submit)"
              rows={2}
              className="w-full resize-none rounded-lg px-3 py-2 text-xs outline-none"
              style={{
                backgroundColor: "var(--bai-bg)",
                color: "var(--bai-text-secondary)",
                border: "1px solid var(--bai-border)",
              }}
            />
            <button
              type="button"
              onClick={handleAddNote}
              disabled={!noteDraft.trim()}
              className="rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40"
              style={{
                backgroundColor: "var(--bai-accent)",
                color: "var(--bai-accent-text)",
              }}
            >
              Add note
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
