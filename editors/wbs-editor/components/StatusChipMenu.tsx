import { useState } from "react";
import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import { actions } from "document-models/work-breakdown-structure";
import type {
  Goal,
  GoalStatus,
  WorkBreakdownStructureAction,
} from "document-models/work-breakdown-structure";
import { GOAL_STATUS_META } from "../../shared/project-status.js";
import { BlockReasonDialog } from "./BlockReasonDialog.js";

type Dispatch = DocumentDispatch<WorkBreakdownStructureAction>;

type StatusChipMenuProps = {
  goal: Goal;
  dispatch: Dispatch;
};

const ALL_STATUSES: GoalStatus[] = [
  "TODO",
  "IN_PROGRESS",
  "IN_REVIEW",
  "BLOCKED",
  "COMPLETED",
  "WONT_DO",
];

const GROUPS: { key: "waiting" | "active" | "finished"; label: string }[] = [
  { key: "waiting", label: "Waiting" },
  { key: "active", label: "Active" },
  { key: "finished", label: "Finished" },
];

/** Colored status pill that opens a grouped dropdown to change status. */
export function StatusChipMenu({ goal, dispatch }: StatusChipMenuProps) {
  const [open, setOpen] = useState(false);
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [outcomeDialogOpen, setOutcomeDialogOpen] = useState(false);
  const meta = GOAL_STATUS_META[goal.status];

  function handlePick(status: GoalStatus) {
    setOpen(false);
    if (status === "BLOCKED") {
      setBlockDialogOpen(true);
    } else if (status === "COMPLETED") {
      setOutcomeDialogOpen(true);
    } else {
      dispatch(actions.setGoalStatus({ id: goal.id, status }));
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
          {/* Transparent click-catcher below the panel — closes the menu
              on any outside click without a portal or external lib. */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 z-50 mt-1 max-h-[60vh] w-44 overflow-y-auto rounded-xl p-1 shadow-2xl"
            style={{
              backgroundColor: "var(--bai-surface)",
              border: "1px solid var(--bai-border)",
            }}
          >
            {GROUPS.map((group) => {
              const statuses = ALL_STATUSES.filter(
                (s) => GOAL_STATUS_META[s].group === group.key,
              );
              if (statuses.length === 0) return null;
              return (
                <div key={group.key} className="mb-1 last:mb-0">
                  <p
                    className="px-2 py-1 text-[9px] font-semibold uppercase tracking-wider"
                    style={{ color: "var(--bai-text-faint)" }}
                  >
                    {group.label}
                  </p>
                  {statuses.map((status) => {
                    const statusMeta = GOAL_STATUS_META[status];
                    const isCurrent = status === goal.status;
                    return (
                      <button
                        key={status}
                        type="button"
                        onClick={() => handlePick(status)}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-white/5"
                        style={{
                          color: isCurrent
                            ? statusMeta.fg
                            : "var(--bai-text-secondary)",
                        }}
                      >
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: statusMeta.fg }}
                        />
                        {statusMeta.label}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </>
      )}

      <BlockReasonDialog
        open={blockDialogOpen}
        title="Mark as Blocked"
        label="Why is this goal blocked?"
        placeholder="Waiting on..."
        required
        confirmLabel="Mark Blocked"
        onCancel={() => setBlockDialogOpen(false)}
        onConfirm={(value) => {
          dispatch(
            actions.setGoalStatus({
              id: goal.id,
              status: "BLOCKED",
              blockReason: value,
            }),
          );
          setBlockDialogOpen(false);
        }}
      />
      <BlockReasonDialog
        open={outcomeDialogOpen}
        title="Mark as Completed"
        label="Outcome (optional)"
        placeholder="What was the result?"
        required={false}
        confirmLabel="Mark Completed"
        onCancel={() => setOutcomeDialogOpen(false)}
        onConfirm={(value) => {
          dispatch(
            actions.setGoalStatus({
              id: goal.id,
              status: "COMPLETED",
              outcome: value || undefined,
            }),
          );
          setOutcomeDialogOpen(false);
        }}
      />
    </div>
  );
}
