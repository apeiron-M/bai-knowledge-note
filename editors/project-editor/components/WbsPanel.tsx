import {
  Component,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
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
import { createDocumentRemote } from "../../shared/remote-reactor.js";
import { triggerVaultPull } from "../../shared/vault-pull.js";

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
  /**
   * Set when `wbsRef` pointed at a document the reactor could not
   * produce — the project is linked to an id that no longer exists
   * server-side. `wbsRef` is reported as `null` in that case (there is
   * no usable link), so this carries the broken id for the repair UI.
   */
  missingRef: string | null;
};

const LinkedWbsContext = createContext<LinkedWbsContextValue>({
  wbsRef: null,
  wbsDoc: undefined,
  goals: [],
  missingRef: null,
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
 *
 * `LinkedWbsBoundary` sits between the two for the dangling-ref case
 * and preserves the same property: both of its branches render a
 * `LinkedWbsFetcher` with `children` in the same position, differing
 * only in props.
 */
export function LinkedWbsProvider({
  wbsRef,
  children,
}: {
  wbsRef: string | null | undefined;
  children: ReactNode;
}) {
  return (
    <LinkedWbsBoundary wbsRef={wbsRef ?? null}>{children}</LinkedWbsBoundary>
  );
}

type BoundaryState = { error: Error | null; errorRef: string | null };

/**
 * Makes a dangling `wbsRef` recoverable instead of fatal.
 *
 * A `wbsRef` pointing at a document that does not exist server-side
 * (e.g. one created by the old local-only `addDocument` path, which
 * never reached the Switchboard) makes `useWorkBreakdownStructureDocumentById`
 * throw a rejected fetch promise during render. Without a boundary here
 * that throw escapes to Connect's `DocumentEditor` boundary and takes
 * down the whole project editor — permanently, because the remote-first
 * document cache deliberately keeps rejected promises cached (dropping
 * them re-triggered an infinite "getSnapshot should be cached" loop).
 *
 * On catch, the same `LinkedWbsFetcher` is re-rendered with `wbsRef`
 * forced to `null` — the one input for which the fetch hook provably
 * cannot throw (see its doc comment) — and the broken id is handed down
 * as `missingRef` so `WbsPanel` can offer the repair. Rendering the same
 * element type in both branches is what keeps `children` mounted; see
 * `LinkedWbsProvider` above.
 *
 * `getDerivedStateFromProps` clears the error as soon as `wbsRef`
 * changes, so re-linking to a freshly created (real) document recovers
 * without a remount and without a frame of stale fallback.
 */
class LinkedWbsBoundary extends Component<
  { wbsRef: string | null; children: ReactNode },
  BoundaryState
> {
  state: BoundaryState = { error: null, errorRef: null };

  static getDerivedStateFromError(error: Error): Partial<BoundaryState> {
    return { error };
  }

  static getDerivedStateFromProps(
    props: { wbsRef: string | null },
    state: BoundaryState,
  ): Partial<BoundaryState> | null {
    if (!state.error) return null;
    // First render after the catch: attribute the failure to the ref
    // that was in flight when it happened.
    if (state.errorRef === null) return { errorRef: props.wbsRef };
    // The project was re-linked (or unlinked) — retry the fetch.
    if (state.errorRef !== props.wbsRef)
      return { error: null, errorRef: null };
    return null;
  }

  componentDidCatch(err: Error) {
    console.error(
      `[WbsPanel] Linked WBS ${this.props.wbsRef ?? "?"} could not be loaded:`,
      err.message,
    );
  }

  render() {
    const failed = this.state.error !== null;
    return (
      <LinkedWbsFetcher
        wbsRef={failed ? null : this.props.wbsRef}
        missingRef={failed ? this.props.wbsRef : null}
      >
        {this.props.children}
      </LinkedWbsFetcher>
    );
  }
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
  missingRef,
  children,
}: {
  wbsRef: string | null;
  missingRef: string | null;
  children: ReactNode;
}) {
  const [wbsDoc] = useWorkBreakdownStructureDocumentById(wbsRef);
  const goals = useMemo(() => wbsDoc?.state.global.goals ?? [], [wbsDoc]);
  const value = useMemo<LinkedWbsContextValue>(
    () => ({ wbsRef, wbsDoc, goals, missingRef }),
    [wbsRef, wbsDoc, goals, missingRef],
  );

  return (
    <LinkedWbsContext.Provider value={value}>
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
  const { wbsRef, wbsDoc, goals, missingRef } = useLinkedWbs();
  const driveId = useSelectedDriveId();
  const nodes = useNodesInSelectedDrive();
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Folder node named "projects" at the drive root. Falls back to
  // `undefined` (drive root) when no such folder exists yet — this
  // editor does not create the folder itself.
  const projectsFolderId = useMemo(() => {
    return (nodes ?? []).find(
      (n) =>
        n.kind === "folder" && n.name === "projects" && n.parentFolder == null,
    )?.id;
  }, [nodes]);

  /**
   * Create the WBS **on the server**, then link it.
   *
   * This must not go through reactor-browser's `addDocument`: the vault
   * drive runs in remote-first mode (its sync channel is neutralised),
   * so a local create produces a document that exists only in this
   * browser tab while the `linkWbs` dispatch below *does* reach the
   * Switchboard — leaving the project permanently pointing at an id no
   * one else can resolve. `createDocumentRemote` is the same helper the
   * vault's own create dialogs use.
   *
   * `targetFolderPath` matters as well as `parentFolderId`: the client
   * node snapshot can still be empty when this fires, and the
   * server-side path resolution is the fallback that keeps the new
   * document out of the drive root.
   *
   * The link is dispatched only after the remote create resolves, so a
   * failed create can never produce another dangling ref.
   */
  const handleCreateWbs = useCallback(async () => {
    if (!driveId || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const newId = await createDocumentRemote({
        documentType: workBreakdownStructureDocumentType,
        name: `${projectName} — WBS`,
        driveId,
        parentFolderId: projectsFolderId,
        targetFolderPath: "projects",
      });
      triggerVaultPull();
      dispatch(actions.linkWbs({ wbsRef: newId }));
      onWbsCreated(newId);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error creating the WBS";
      console.error("[WbsPanel] Failed to create WBS:", err);
      setCreateError(message);
    } finally {
      setCreating(false);
    }
  }, [
    driveId,
    creating,
    projectName,
    projectsFolderId,
    dispatch,
    onWbsCreated,
  ]);

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

      {missingRef ? (
        <MissingView
          missingRef={missingRef}
          creating={creating || !!pendingWbsId}
          onCreate={() => void handleCreateWbs()}
        />
      ) : !wbsRef ? (
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

      {createError && (
        <p
          className="mt-3 rounded-lg px-3 py-2 text-xs"
          style={{
            backgroundColor: GOAL_STATUS_META.BLOCKED.bg,
            color: GOAL_STATUS_META.BLOCKED.fg,
            border: `1px solid ${GOAL_STATUS_META.BLOCKED.border}`,
          }}
        >
          Could not create the WBS: {createError}
        </p>
      )}
    </div>
  );
}

/**
 * Shown when the project's `wbsRef` resolves to nothing on the server.
 * The project document model has `LINK_WBS` but no `UNLINK_WBS`, so
 * re-linking to a freshly created (real) document is the only repair
 * available — hence the same create action as the unlinked state.
 */
function MissingView({
  missingRef,
  creating,
  onCreate,
}: {
  missingRef: string;
  creating: boolean;
  onCreate: () => void;
}) {
  return (
    <div
      className="rounded-lg px-4 py-3"
      style={{
        backgroundColor: GOAL_STATUS_META.BLOCKED.bg,
        border: `1px solid ${GOAL_STATUS_META.BLOCKED.border}`,
      }}
    >
      <p
        className="text-sm font-medium"
        style={{ color: GOAL_STATUS_META.BLOCKED.fg }}
      >
        Linked WBS not found
      </p>
      <p
        className="mt-0.5 break-all font-mono text-[10px]"
        style={{ color: GOAL_STATUS_META.BLOCKED.fg, opacity: 0.8 }}
      >
        {missingRef}
      </p>
      <p className="mt-1.5 text-xs" style={{ color: "var(--bai-text-faint)" }}>
        It may have been deleted, or created before this drive switched to
        server-side writes. Creating a new one re-links this project.
      </p>
      <button
        type="button"
        onClick={onCreate}
        disabled={creating}
        className="mt-3 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
        style={{
          backgroundColor: "var(--bai-accent)",
          color: "var(--bai-accent-text)",
        }}
      >
        {creating ? "Creating…" : "Create replacement WBS"}
      </button>
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
                backgroundColor: GOAL_STATUS_META.BLOCKED.bg,
                color: GOAL_STATUS_META.BLOCKED.fg,
                border: `1px solid ${GOAL_STATUS_META.BLOCKED.border}`,
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
 *
 * The exported component is the fetch wrapped in `WbsBackLinkBoundary`,
 * so a failed fetch abandons the back-link instead of crashing the
 * editor — see that class for why.
 */
export function WbsBackLink(props: {
  id: string;
  projectId: string;
  onDone: () => void;
}) {
  return (
    <WbsBackLinkBoundary onDone={props.onDone}>
      <WbsBackLinkFetcher {...props} />
    </WbsBackLinkBoundary>
  );
}

/**
 * `WbsBackLinkFetcher` fetches the just-created document by id, and
 * `editor.tsx` renders it outside `LinkedWbsProvider` — so without a
 * boundary here a failed fetch (a network blip on an id the server
 * genuinely has) escapes to Connect's `DocumentEditor` boundary and
 * kills the editor, exactly like a dangling `wbsRef` used to.
 *
 * The back-link is a convenience write (`projectRef` on the WBS), not a
 * correctness requirement, so on error it is abandoned: `onDone` clears
 * `pendingWbsId` in `editor.tsx`, which also unmounts this boundary and
 * releases the "Creating…" state. The project→WBS link itself is
 * already committed by then.
 */
class WbsBackLinkBoundary extends Component<
  { onDone: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(err: Error) {
    console.error("[WbsPanel] WBS back-link write abandoned:", err.message);
    this.props.onDone();
  }

  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

function WbsBackLinkFetcher({
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
