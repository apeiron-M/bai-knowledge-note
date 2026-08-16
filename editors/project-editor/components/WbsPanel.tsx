import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  addDocument,
  setSelectedNode,
  useNodesInSelectedDrive,
  useSelectedDriveId,
} from "@powerhousedao/reactor-browser";
import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import { actions } from "document-models/project";
import type { ProjectAction } from "document-models/project";
import {
  actions as wbsActions,
  useWorkBreakdownStructureDocumentById,
  workBreakdownStructureDocumentType,
} from "document-models/work-breakdown-structure";
import type {
  Goal,
  GoalStatus,
  WorkBreakdownStructureDocument,
} from "document-models/work-breakdown-structure";
import { GOAL_STATUS_META, goalRollup } from "../../shared/project-status.js";

type Dispatch = DocumentDispatch<ProjectAction>;

const ALL_GOAL_STATUSES: GoalStatus[] = [
  "TODO",
  "IN_PROGRESS",
  "IN_REVIEW",
  "BLOCKED",
  "COMPLETED",
  "WONT_DO",
];

/* ------------------------------------------------------------------ */
/*  Shared "linked WBS" context                                       */
/*                                                                     */
/*  DeliverablesSection also needs the linked WBS's goals (to resolve  */
/*  a deliverable's goalRef into a description + status chip, and to   */
/*  offer a goal picker on the add-deliverable form). Rather than      */
/*  each section independently guarding + fetching the same document   */
/*  by id, WbsPanel owns a single guarded fetch and exposes it via     */
/*  context — mirrors the ThemeProvider/useTheme pattern already used  */
/*  in shared/theme-context.tsx.                                       */
/* ------------------------------------------------------------------ */

type LinkedWbsContextValue = {
  wbsRef: string | null;
  wbsDoc: WorkBreakdownStructureDocument | undefined;
  goals: Goal[];
};

const LinkedWbsContext = createContext<LinkedWbsContextValue>({
  wbsRef: null,
  wbsDoc: undefined,
  goals: [],
});

/** Read the linked WBS's live goals (empty array when unlinked or still loading). */
export function useLinkedWbs(): LinkedWbsContextValue {
  return useContext(LinkedWbsContext);
}

/**
 * Wrap the WbsPanel + DeliverablesSection sections with this.
 *
 * Always renders the same `LinkedWbsFetcher` element type, whether or not
 * `wbsRef` is set. This used to branch between a plain
 * `<LinkedWbsContext.Provider>` (no ref) and `<LinkedWbsFetcher>` (has
 * ref) — two different element types at the same position in the tree —
 * so the instant a freshly created WBS's id landed in `wbsRef`, React
 * would unmount the entire `children` subtree (WbsPanel + its local
 * state, including any in-flight `WbsBackLink` write) and mount a fresh
 * one. Routing both cases through one component type keeps `children`
 * mounted across that transition; see `LinkedWbsFetcher` below for why
 * calling the fetch hook unconditionally (rather than guarding the
 * mount) is safe.
 */
export function LinkedWbsProvider({
  wbsRef,
  children,
}: {
  wbsRef: string | null | undefined;
  children: ReactNode;
}) {
  return (
    <LinkedWbsFetcher wbsRef={wbsRef ?? null}>{children}</LinkedWbsFetcher>
  );
}

/**
 * `useWorkBreakdownStructureDocumentById` bottoms out in reactor-browser's
 * `useDocument`, which only calls React's `use()` on the cached document
 * promise when `id` is truthy (`id ? documentCache?.get(id) : void 0`) —
 * with a null id it returns `undefined` directly and `use()` is never
 * reached, and the WBS-specific wrapper's `isWorkBreakdownStructureDocument`
 * guard is a zod `safeParse` (never throws) around that `undefined`. So
 * this never suspends or throws while unlinked, and can be called
 * unconditionally instead of behind a mount guard — see `LinkedWbsProvider`
 * above for why that matters.
 */
function LinkedWbsFetcher({
  wbsRef,
  children,
}: {
  wbsRef: string | null;
  children: ReactNode;
}) {
  const [wbsDoc] = useWorkBreakdownStructureDocumentById(wbsRef);
  const goals = useMemo(() => wbsDoc?.state.global.goals ?? [], [wbsDoc]);

  return (
    <LinkedWbsContext.Provider value={{ wbsRef, wbsDoc, goals }}>
      {children}
    </LinkedWbsContext.Provider>
  );
}

/* ------------------------------------------------------------------ */
/*  WbsPanel                                                           */
/* ------------------------------------------------------------------ */

type WbsPanelProps = {
  dispatch: Dispatch;
  projectName: string;
  /**
   * Whether a just-created WBS's back-link write is still in flight.
   * Owned by `editor.tsx` (not this component) so it — and the
   * `WbsBackLink` it gates — survive the `LinkedWbsProvider` transition
   * that happens the moment `onWbsCreated` fires; see the module doc
   * above `LinkedWbsProvider` for why that transition used to unmount
   * this component.
   */
  pendingWbsId: string | null;
  /** Called with the new document's id right after `linkWbs` is dispatched. */
  onWbsCreated: (id: string) => void;
};

export function WbsPanel({
  dispatch,
  projectName,
  pendingWbsId,
  onWbsCreated,
}: WbsPanelProps) {
  const { wbsRef, wbsDoc, goals } = useLinkedWbs();
  const driveId = useSelectedDriveId();
  const nodes = useNodesInSelectedDrive();
  const [creating, setCreating] = useState(false);

  // Folder node named "projects" at the drive root. Falls back to
  // `undefined` (drive root) when no such folder exists yet — this
  // editor does not create the folder itself.
  const projectsFolderId = useMemo(() => {
    return (nodes ?? []).find(
      (n) =>
        n.kind === "folder" && n.name === "projects" && n.parentFolder == null,
    )?.id;
  }, [nodes]);

  async function handleCreateWbs() {
    if (!driveId || creating) return;
    setCreating(true);
    try {
      const result = await addDocument(
        driveId,
        `${projectName} — WBS`,
        workBreakdownStructureDocumentType,
        projectsFolderId,
      );
      if (!result.id) return;
      dispatch(actions.linkWbs({ wbsRef: result.id }));
      onWbsCreated(result.id);
    } catch (err) {
      console.error("[WbsPanel] Failed to create WBS:", err);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div
      className="rounded-xl p-5"
      style={{
        backgroundColor: "var(--bai-surface)",
        border: "1px solid var(--bai-border)",
      }}
    >
      <div className="mb-3 flex items-center justify-between">
        <h3
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--bai-text-muted)" }}
        >
          Work Breakdown Structure
        </h3>
        {wbsRef && (
          <button
            type="button"
            onClick={() => setSelectedNode(wbsRef)}
            className="text-xs hover:underline"
            style={{ color: "var(--bai-accent)" }}
          >
            Open WBS &rarr;
          </button>
        )}
      </div>

      {!wbsRef ? (
        <UnlinkedView
          creating={creating || !!pendingWbsId}
          onCreate={() => void handleCreateWbs()}
        />
      ) : !wbsDoc ? (
        <p className="text-sm" style={{ color: "var(--bai-text-faint)" }}>
          Loading linked WBS&hellip;
        </p>
      ) : (
        <LinkedView goals={goals} />
      )}
    </div>
  );
}

function UnlinkedView({
  creating,
  onCreate,
}: {
  creating: boolean;
  onCreate: () => void;
}) {
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-lg border border-dashed px-4 py-3"
      style={{ borderColor: "var(--bai-border)" }}
    >
      <p className="text-sm" style={{ color: "var(--bai-text-faint)" }}>
        No work breakdown structure linked yet.
      </p>
      <button
        type="button"
        onClick={onCreate}
        disabled={creating}
        className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
        style={{
          backgroundColor: "var(--bai-accent)",
          color: "var(--bai-accent-text)",
        }}
      >
        {creating ? "Creating…" : "Create WBS"}
      </button>
    </div>
  );
}

function LinkedView({ goals }: { goals: Goal[] }) {
  const rollup = goalRollup(goals);
  const blocked = goals.filter((g) => g.status === "BLOCKED").slice(0, 3);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {ALL_GOAL_STATUSES.map((status) => {
          const count = goals.filter((g) => g.status === status).length;
          if (count === 0) return null;
          const meta = GOAL_STATUS_META[status];
          return (
            <span
              key={status}
              className="rounded-full border px-2 py-0.5 text-[10px] font-medium"
              style={{
                color: meta.fg,
                backgroundColor: meta.bg,
                borderColor: meta.border,
              }}
            >
              {count} {meta.label}
            </span>
          );
        })}
      </div>

      <div>
        <div
          className="flex items-center justify-between text-xs"
          style={{ color: "var(--bai-text-tertiary)" }}
        >
          <span>
            {rollup.finished}/{rollup.total} goals &middot; {rollup.pct}%
          </span>
        </div>
        <div
          className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full"
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

      {blocked.length > 0 && (
        <div className="space-y-1.5">
          {blocked.map((g) => (
            <div
              key={g.id}
              className="rounded-lg px-3 py-2 text-xs"
              style={{
                backgroundColor: "rgba(248, 113, 113, 0.1)",
                color: "rgba(252, 165, 165, 1)",
                border: "1px solid rgba(248, 113, 113, 0.3)",
              }}
            >
              <p className="font-medium">{g.description}</p>
              {g.blockReason && (
                <p className="mt-0.5 opacity-80">{g.blockReason}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Mounted only while a just-created WBS document's back-link hasn't
 * been set yet. Fetches the new document independently of the
 * project's own `wbsRef` state (which only updates once the `linkWbs`
 * dispatch round-trips) so the back-link can be written as soon as the
 * new document itself becomes fetchable. The `useRef` guard makes the
 * `setProjectRef` dispatch fire exactly once even if this effect re-runs.
 *
 * Rendered by `editor.tsx`, not `WbsPanel` — `editor.tsx` never unmounts
 * across the `wbsRef` transition, so mounting this here (rather than
 * inside `LinkedWbsProvider`'s children) guarantees the write survives
 * even if something inside that subtree remounts.
 */
export function WbsBackLink({
  id,
  projectId,
  onDone,
}: {
  id: string;
  projectId: string;
  onDone: () => void;
}) {
  const wbsResult = useWorkBreakdownStructureDocumentById(id);
  const firedRef = useRef(false);

  useEffect(() => {
    if (!wbsResult[0] || firedRef.current) return;
    firedRef.current = true;
    const [, wbsDispatch] = wbsResult;
    wbsDispatch(wbsActions.setProjectRef({ projectRef: projectId }));
    onDone();
  }, [wbsResult, projectId, onDone]);

  return (
    <p className="mt-2 text-xs" style={{ color: "var(--bai-text-faint)" }}>
      Linking new WBS&hellip;
    </p>
  );
}
