import { useState } from "react";
import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import { generateId } from "document-model";
import { actions } from "document-models/work-breakdown-structure";
import type {
  Goal,
  WorkBreakdownStructureAction,
} from "document-models/work-breakdown-structure";
import { GOAL_STATUS_META } from "../../shared/project-status.js";
import { StatusChipMenu } from "./StatusChipMenu.js";

type Dispatch = DocumentDispatch<WorkBreakdownStructureAction>;

type GoalSidebarProps = {
  goal: Goal;
  /** Full flat goals array, used for the dependencies checklist. */
  allGoals: Goal[];
  dispatch: Dispatch;
  onClose: () => void;
  /**
   * How the host mounts this panel. "sidebar" (default) is the docked
   * right rail with its own width and left border; "modal" fills whatever
   * dialog the host puts it in. Only the scope-of-work editor uses the
   * modal — the standalone WBS editor passes nothing and is unchanged.
   */
  layout?: "modal" | "sidebar";
  /** When given, an expand/dock button appears beside Close. */
  onToggleLayout?: () => void;
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
  layout = "sidebar",
  onToggleLayout,
}: GoalSidebarProps) {
  const expanded = layout === "modal";
  const [author, setAuthor] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  // The dependency picker is closed by default: the panel shows what this
  // goal waits on, not every goal it could wait on. A 65-goal tree made the
  // old always-open checklist the tallest thing in the panel.
  const [picking, setPicking] = useState(false);
  const [depQuery, setDepQuery] = useState("");

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
  // What this goal waits on, in the order it was recorded; a dependency
  // whose goal was deleted stays listed so it can be removed.
  const deps = goal.dependencies.map((id) => ({
    id,
    goal: allGoals.find((g) => g.id === id),
  }));
  const q = depQuery.trim().toLowerCase();
  const candidates = q
    ? otherGoals.filter((g) => g.description.toLowerCase().includes(q))
    : otherGoals;

  return (
    <div
      className={
        expanded
          ? "flex h-full w-full flex-col"
          : "flex h-full w-[360px] shrink-0 flex-col border-l"
      }
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
        <span className="flex items-center gap-2">
          {onToggleLayout && (
            <button
              type="button"
              onClick={onToggleLayout}
              className="rounded p-1 text-base leading-none hover:bg-white/5"
              style={{ color: "var(--bai-text-faint)" }}
              title={expanded ? "Back to the side panel" : "Expand to focus"}
              aria-label={expanded ? "Dock goal details" : "Expand goal details"}
            >
              {expanded ? "⤡" : "⤢"}
            </button>
          )}
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
        </span>
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
                backgroundColor: GOAL_STATUS_META.BLOCKED.bg,
                color: GOAL_STATUS_META.BLOCKED.fg,
                border: `1px solid ${GOAL_STATUS_META.BLOCKED.border}`,
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
            className="w-full resize-none rounded-lg px-3 py-2 text-sm outline-none"
            style={{
              height: 150,
              backgroundColor: "var(--bai-bg)",
              color: "var(--bai-text-secondary)",
              border: "1px solid var(--bai-border)",
            }}
          />
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span
              className="text-xs font-semibold uppercase tracking-wider"
              style={SECTION_LABEL_STYLE}
            >
              Dependencies{deps.length > 0 ? ` (${deps.length})` : ""}
            </span>
            {otherGoals.length > 0 && (
              <button
                type="button"
                className="rounded px-1.5 py-0.5 text-xs hover:bg-white/5"
                style={{ color: "var(--bai-text-secondary)" }}
                aria-expanded={picking}
                aria-controls={`dep-picker-${goal.id}`}
                onClick={() => {
                  setPicking((v) => !v);
                  setDepQuery("");
                }}
              >
                {picking ? "Done" : deps.length > 0 ? "Edit" : "Add dependency"}
              </button>
            )}
          </div>

          {deps.length === 0 && !picking ? (
            <p className="text-xs" style={{ color: "var(--bai-text-faint)" }}>
              {otherGoals.length === 0
                ? "No other goals to depend on."
                : "Nothing this goal waits on."}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {deps.map(({ id, goal: g }) => {
                const meta = g ? GOAL_STATUS_META[g.status] : undefined;
                return (
                  <li
                    key={id}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs"
                    style={{ border: "1px solid var(--bai-border)" }}
                  >
                    <span
                      aria-hidden
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: meta?.fg ?? "var(--bai-border)" }}
                    />
                    <span
                      className="min-w-0 flex-1 truncate"
                      style={{ color: g ? "var(--bai-text-secondary)" : "var(--bai-text-faint)" }}
                      title={g ? `${g.description}${meta ? ` — ${meta.label}` : ""}` : undefined}
                    >
                      {g ? g.description : "Goal no longer exists"}
                    </span>
                    <button
                      type="button"
                      className="shrink-0 rounded px-1 leading-none hover:bg-white/5"
                      style={{ color: "var(--bai-text-faint)" }}
                      aria-label={`Remove dependency: ${g?.description ?? id}`}
                      title="Remove dependency"
                      onClick={() => toggleDependency(id, true)}
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {picking && (
            <div
              id={`dep-picker-${goal.id}`}
              className="mt-2 rounded-lg p-1"
              style={{ border: "1px solid var(--bai-border)" }}
            >
              <input
                type="search"
                autoFocus
                value={depQuery}
                placeholder="Search goals"
                aria-label="Search goals to depend on"
                className="mb-1 w-full rounded-md bg-transparent px-2 py-1.5 text-xs outline-none focus:ring-1"
                style={{
                  color: "var(--bai-text)",
                  border: "1px solid var(--bai-border)",
                }}
                onChange={(e) => setDepQuery(e.target.value)}
                onKeyDown={(e) => {
                  // Esc closes the picker only. Stop it here or the host's
                  // own Esc handler closes the whole panel with it.
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setPicking(false);
                  }
                }}
              />
              <div className="max-h-56 space-y-0.5 overflow-y-auto">
                {candidates.length === 0 ? (
                  <p
                    className="px-2 py-1.5 text-xs"
                    style={{ color: "var(--bai-text-faint)" }}
                  >
                    No goals match.
                  </p>
                ) : (
                  candidates.map((g) => {
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
                          style={{
                            color: checked
                              ? "var(--bai-text)"
                              : "var(--bai-text-secondary)",
                          }}
                        >
                          {g.description}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
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
