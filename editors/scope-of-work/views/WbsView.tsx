import { actions } from "document-models/scope-of-work";
import { generateId } from "document-model/core";
import { setSelectedNode } from "@powerhousedao/reactor-browser";
import type { Goal } from "document-models/work-breakdown-structure";
import { useEffect, useState } from "react";
import { GoalSidebar } from "../../wbs-editor/components/GoalSidebar.js";
import { GoalTree } from "../../wbs-editor/components/GoalTree.js";
import { CopyableId } from "../components/ui.js";
import { useEditor } from "../lib/context.js";
import { LinkedWbsReader } from "../lib/linked-wbs.js";
import { OverviewView } from "./OverviewView.js";

/**
 * The work breakdown, inside the scope.
 *
 * A WBS is part of the envelope it delivers, so opening it must not swap the
 * whole editor for a different document and bring the vault sidebar back —
 * the scope's rail stays, and the goal tree renders on this canvas. The tree
 * and goal panel are the WBS editor's own components (pure, dispatch-as-prop,
 * selection lifted), driven by the WBS document's dispatch; the scope's
 * dispatch is used only for the import below. "Open standalone" is still
 * offered for the full-page editor.
 */
export function WbsView({ projectId }: { projectId: string }) {
  const { state, dispatch: sowDispatch, go, inspectorLayout, toggleInspectorLayout } =
    useEditor();
  const p = state.projects.find((x) => x.id === projectId);
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  // Same Esc-to-close the deliverable inspector has; bound only while a
  // goal is open so an idle view adds no listener.
  useEffect(() => {
    if (!selectedGoalId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedGoalId(null);
    };
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, [selectedGoalId]);
  if (!p) return <OverviewView />;

  const backToProject = (
    <button type="button" className="btn ghost sm" onClick={() => go({ kind: "project", id: p.id })}>
      ← {p.code} · {p.title || "project"}
    </button>
  );

  if (!p.wbsRef) {
    return (
      <div className="doc">
        <div className="eyebrow">Work breakdown</div>
        <h1 className="title">{p.title || p.code}</h1>
        <div className="hint" style={{ padding: 0 }}>
          This envelope has no work breakdown structure yet. Create or link one from the
          project page's Execution section.
        </div>
        <div style={{ marginTop: 12 }}>{backToProject}</div>
      </div>
    );
  }
  const wbsRef = p.wbsRef;

  // Top-level goals not yet delivered by any deliverable become deliverables:
  // the WBS is where the team names the work; the scope prices it.
  const importGoals = (goals: Goal[]) => {
    const taken = new Set(state.deliverables.map((d) => d.goalRef).filter(Boolean));
    const fresh = goals.filter((g) => !g.parentId && !taken.has(g.id));
    if (fresh.length === 0) return;
    sowDispatch(
      fresh.flatMap((g) => {
        const deliverableId = generateId();
        return [
          actions.addProjectDeliverable({ projectId: p.id, deliverableId, title: g.description }),
          actions.linkDeliverableGoal({ deliverableId, goalRef: g.id }),
          actions.setDeliverableBudgetAnchorProject({ deliverableId, project: p.id }),
        ];
      }),
    );
  };

  return (
    <div className="doc" style={{ maxWidth: 1240 }}>
      <LinkedWbsReader wbsRef={wbsRef}>
        {({ wbsDoc, goals, dispatch, missingRef }) => {
          const importable = goals.filter(
            (g) => !g.parentId && !state.deliverables.some((d) => d.goalRef === g.id),
          ).length;
          const selectedGoal = selectedGoalId ? goals.find((g) => g.id === selectedGoalId) : undefined;
          return (
            <>
              <div className="eyebrow eyebrow-row">
                <span>Work breakdown · {p.code}</span>
                {/* A real document id, unlike the OIDs the other views
                    show: this is the linked bai/wbs document itself. */}
                <CopyableId id={wbsRef} label="Work breakdown document id" />
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                <h1 className="title" style={{ flex: 1, minWidth: 240 }}>
                  {wbsDoc?.header.name ?? `${p.title} — WBS`}
                </h1>
                {backToProject}
                <button type="button" className="btn ghost sm" onClick={() => setSelectedNode(wbsRef)}>
                  Open standalone →
                </button>
                {importable > 0 && (
                  <button
                    type="button"
                    className="btn sm primary"
                    title="Create one deliverable per top-level goal that none delivers yet"
                    onClick={() => importGoals(goals)}
                  >
                    Import {importable} goal{importable === 1 ? "" : "s"} as deliverables
                  </button>
                )}
              </div>
              {missingRef ? (
                <div className="hint err">
                  The linked WBS <span className="mono">{missingRef}</span> could not be loaded. Repair it on the project page.
                </div>
              ) : !wbsDoc || !dispatch ? (
                <div className="hint">Loading work breakdown…</div>
              ) : (
                <div className="wbs-embed" style={{ display: "flex", gap: 20, alignItems: "flex-start", marginTop: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <GoalTree
                      goals={goals}
                      selectedId={selectedGoalId}
                      onSelect={setSelectedGoalId}
                      dispatch={dispatch}
                    />
                  </div>
                  {selectedGoal && inspectorLayout === "sidebar" && (
                    <div style={{ width: 360, flex: "none" }}>
                      <GoalSidebar
                        key={selectedGoal.id}
                        goal={selectedGoal}
                        allGoals={goals}
                        dispatch={dispatch}
                        onClose={() => setSelectedGoalId(null)}
                        layout="sidebar"
                        onToggleLayout={toggleInspectorLayout}
                      />
                    </div>
                  )}
                </div>
              )}
              {/* Goal details open the way the deliverable inspector does:
                  the same remembered preference, modal unless docked. */}
              {selectedGoal && dispatch && inspectorLayout === "modal" && (
                <div
                  className="sow-scrim"
                  role="presentation"
                  onClick={() => setSelectedGoalId(null)}
                >
                  <div
                    className="sow-modal sow-modal-goal"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Goal details"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <GoalSidebar
                      key={selectedGoal.id}
                      goal={selectedGoal}
                      allGoals={goals}
                      dispatch={dispatch}
                      onClose={() => setSelectedGoalId(null)}
                      layout="modal"
                      onToggleLayout={toggleInspectorLayout}
                    />
                  </div>
                </div>
              )}
            </>
          );
        }}
      </LinkedWbsReader>
    </div>
  );
}
