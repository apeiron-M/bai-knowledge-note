import { useEffect, useRef, useState } from "react";
import { DocumentToolbar } from "@powerhousedao/design-system/connect";
import { setSelectedNode } from "@powerhousedao/reactor-browser";
import { SafeDocument } from "../shared/safe-document.js";
import { useSowIntent, writeSowIntent } from "../shared/sow-intent.js";
import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import {
  actions,
  useSelectedWorkBreakdownStructureDocument,
} from "document-models/work-breakdown-structure";
import type { WorkBreakdownStructureAction } from "document-models/work-breakdown-structure";
import { ThemeProvider, TOOLBAR_CLASS } from "../shared/theme-context.js";
import { GOAL_STATUS_META, goalRollup } from "../shared/project-status.js";
import { GoalTree } from "./components/GoalTree.js";
import { GoalSidebar } from "./components/GoalSidebar.js";

type Dispatch = DocumentDispatch<WorkBreakdownStructureAction>;

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export default function Editor() {
  const [document, dispatch] = useSelectedWorkBreakdownStructureDocument();
  const state = document.state.global;
  // A chat citation of one goal ([[wbsId#goalId]]) lands with that goal
  // selected. Read during render, consumed after commit — see
  // shared/sow-intent.ts for why the order matters.
  const intent = useSowIntent(document.header.id);
  const wantedGoal = intent?.kind === "goal" ? intent.id : null;
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(() =>
    wantedGoal && state.goals.some((g) => g.id === wantedGoal) ? wantedGoal : null,
  );
  // If the goal was not in the state at mount, select it when it arrives.
  const goalIntentApplied = useRef(selectedGoalId !== null);
  useEffect(() => {
    if (goalIntentApplied.current || !wantedGoal) return;
    if (!state.goals.some((g) => g.id === wantedGoal)) return;
    goalIntentApplied.current = true;
    setSelectedGoalId(wantedGoal);
  }, [wantedGoal, state.goals]);
  const rollup = goalRollup(state.goals);
  const selected = state.goals.find((g) => g.id === selectedGoalId) ?? null;
  // The scope-of-work envelope this tree delivers (SET_SOW_PROJECT_REF).
  const sowRef = state.sowRef ?? null;

  return (
    <ThemeProvider>
      <DocumentToolbar toolbarClassName={TOOLBAR_CLASS} />
      <div
        className="flex min-h-screen"
        style={{ backgroundColor: "var(--bai-bg)", color: "var(--bai-text)" }}
      >
        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {sowRef && (
              <SafeDocument id={sowRef}>
                {(sowDoc, failed) => {
                  const sowGlobal = (sowDoc?.state as { global?: Record<string, unknown> } | undefined)?.global;
                  const envelope = (
                    (sowGlobal?.projects as { id: string; code?: string; title?: string }[] | undefined) ?? []
                  ).find((x) => x.id === state.sowProjectId);
                  const sowTitle = (sowGlobal?.title as string | undefined) || sowDoc?.header.name;
                  return (
                    <button
                      type="button"
                      title={failed ? "The linked scope of work could not be loaded" : "Open this envelope in its scope of work"}
                      disabled={failed}
                      onClick={() => {
                        if (state.sowProjectId) {
                          writeSowIntent({
                            documentId: sowRef,
                            view: { kind: "project", id: state.sowProjectId },
                          });
                        }
                        setSelectedNode(sowRef);
                      }}
                      className="text-xs hover:underline disabled:opacity-50 disabled:no-underline"
                      style={{ color: "var(--bai-accent)" }}
                    >
                      ← Delivers {envelope?.code ? `${envelope.code} · ` : ""}
                      {envelope?.title ?? "an envelope"}
                      {sowTitle ? ` in ${sowTitle}` : ""}
                    </button>
                  );
                }}
              </SafeDocument>
            )}
          </div>

          <OwnerRow owner={state.owner} dispatch={dispatch} />
          <ProgressCard rollup={rollup} />
          <ReferencesList references={state.references} dispatch={dispatch} />

          <GoalTree
            goals={state.goals}
            selectedId={selectedGoalId}
            onSelect={setSelectedGoalId}
            dispatch={dispatch}
          />
        </div>
        {selected && (
          <GoalSidebar
            key={selected.id}
            goal={selected}
            allGoals={state.goals}
            dispatch={dispatch}
            onClose={() => setSelectedGoalId(null)}
          />
        )}
      </div>
    </ThemeProvider>
  );
}

function OwnerRow({
  owner,
  dispatch,
}: {
  owner: string | null | undefined;
  dispatch: Dispatch;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="text-xs font-semibold uppercase tracking-wider"
        style={{ color: "var(--bai-text-muted)" }}
      >
        Owner
      </span>
      <input
        type="text"
        defaultValue={owner ?? ""}
        placeholder="Unassigned"
        onBlur={(e) =>
          dispatch(actions.setOwner({ owner: e.target.value.trim() || null }))
        }
        className="rounded-md px-2 py-1 text-xs outline-none"
        style={{
          backgroundColor: "var(--bai-surface)",
          color: "var(--bai-text-secondary)",
          border: "1px solid var(--bai-border)",
        }}
      />
    </div>
  );
}

function ProgressCard({ rollup }: { rollup: ReturnType<typeof goalRollup> }) {
  const blockedMeta = GOAL_STATUS_META.BLOCKED;
  return (
    <div
      className="rounded-lg px-4 py-3"
      style={{
        backgroundColor: "var(--bai-surface)",
        border: "1px solid var(--bai-border)",
      }}
    >
      <div
        className="flex items-center justify-between text-xs"
        style={{ color: "var(--bai-text-tertiary)" }}
      >
        <span>
          {rollup.finished}/{rollup.total} · {rollup.pct}%
        </span>
        {rollup.blocked > 0 && (
          <span
            className="rounded-full border px-2 py-0.5 text-[10px] font-medium"
            style={{
              color: blockedMeta.fg,
              backgroundColor: blockedMeta.bg,
              borderColor: blockedMeta.border,
            }}
          >
            {rollup.blocked} blocked
          </span>
        )}
      </div>
      <div
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full"
        style={{ backgroundColor: "var(--bai-hover)" }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${rollup.pct}%`,
            backgroundColor: "var(--bai-accent)",
          }}
        />
      </div>
    </div>
  );
}

function ReferencesList({
  references,
  dispatch,
}: {
  references: string[];
  dispatch: Dispatch;
}) {
  const [url, setUrl] = useState("");
  const trimmedUrl = url.trim();
  const showInvalidHint = trimmedUrl.length > 0 && !isValidUrl(trimmedUrl);

  function handleAdd() {
    if (!trimmedUrl || !isValidUrl(trimmedUrl)) return;
    dispatch(
      actions.setReferences({ references: [...references, trimmedUrl] }),
    );
    setUrl("");
  }

  function handleRemove(target: string) {
    dispatch(
      actions.setReferences({
        references: references.filter((r) => r !== target),
      }),
    );
  }

  return (
    <div
      className="rounded-lg px-4 py-3"
      style={{
        backgroundColor: "var(--bai-surface)",
        border: "1px solid var(--bai-border)",
      }}
    >
      <h3
        className="text-xs font-semibold uppercase tracking-wider"
        style={{ color: "var(--bai-text-muted)" }}
      >
        References
      </h3>
      {references.length > 0 && (
        <div className="mt-2 space-y-1">
          {references.map((ref, index) => (
            <div
              key={`${ref}-${index}`}
              className="group flex items-center gap-2"
            >
              <a
                href={ref}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 truncate text-xs hover:underline"
                style={{ color: "var(--bai-text-secondary)" }}
              >
                {ref}
              </a>
              <button
                type="button"
                onClick={() => handleRemove(ref)}
                className="shrink-0 rounded p-1 opacity-0 transition-all hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
                style={{ color: "var(--bai-text-faint)" }}
                title="Remove reference"
              >
                <svg
                  className="h-3 w-3"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-center gap-2">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
          }}
          placeholder="Add reference URL..."
          className="min-w-0 flex-1 rounded-md px-2 py-1 text-xs outline-none"
          style={{
            backgroundColor: "var(--bai-bg)",
            color: "var(--bai-text-secondary)",
            border: "1px solid var(--bai-border)",
          }}
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={!trimmedUrl || !isValidUrl(trimmedUrl)}
          className="shrink-0 rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-40"
          style={{
            backgroundColor: "var(--bai-accent)",
            color: "var(--bai-accent-text)",
          }}
        >
          Add
        </button>
      </div>
      {showInvalidHint && (
        <p className="mt-1 text-[10px] text-red-400">
          Must be a valid URL (e.g. https://...)
        </p>
      )}
    </div>
  );
}
