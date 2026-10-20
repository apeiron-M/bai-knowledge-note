import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import {
  useWorkBreakdownStructureDocumentById,
  type Goal,
  type WorkBreakdownStructureAction,
  type WorkBreakdownStructureDocument,
} from "document-models/work-breakdown-structure";
import { Component, Suspense, useMemo, type ReactNode } from "react";

/**
 * Read the work-breakdown-structure a scope-of-work envelope links to, safely.
 *
 * `useDocumentById` calls React's `use()` on the cached document promise. A
 * `wbsRef` that points at a document the server does not hold — a WBS created
 * by an old local-only path, or one deleted since — makes that promise reject
 * *during render*, and without a boundary the throw escapes to Connect's
 * editor boundary and takes the whole SoW editor down. Worse, the remote-first
 * cache deliberately keeps rejected promises, so it never recovers on its own.
 *
 * This is the project editor's fix, ported: catch, re-render the same fetcher
 * with `wbsRef` forced to `null` (the one input for which the hook provably
 * cannot throw — with a null id `use()` is never reached), and hand the broken
 * id down as `missingRef` so the caller can offer a repair. Both branches
 * render the same element type, so the consumer's subtree never remounts.
 */
export type LinkedWbs = {
  wbsRef: string | null;
  wbsDoc: WorkBreakdownStructureDocument | undefined;
  goals: Goal[];
  /** The WBS document's own dispatch — separate from the SoW's. Undefined until loaded. */
  dispatch: DocumentDispatch<WorkBreakdownStructureAction> | undefined;
  /** A ref that failed to load — offer to replace it. */
  missingRef: string | null;
};

type RenderFn = (linked: LinkedWbs) => ReactNode;
type BoundaryState = { error: Error | null; errorRef: string | null };

class Boundary extends Component<
  { wbsRef: string | null; children: RenderFn },
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
    if (state.errorRef === null) return { errorRef: props.wbsRef };
    if (state.errorRef !== props.wbsRef) return { error: null, errorRef: null };
    return null;
  }

  componentDidCatch(err: Error) {
    console.error(
      `[scope-of-work] linked WBS ${this.props.wbsRef ?? "?"} could not be loaded:`,
      err.message,
    );
  }

  render() {
    const failed = this.state.error !== null;
    const wbsRef = failed ? null : this.props.wbsRef;
    // A Suspense boundary of our own. `use()` suspends the first time the WBS
    // document is not cached; without a boundary here that unwinds to
    // Connect's, discarding the whole editor's in-progress render — including
    // whatever the Shell decided in its initialisers. Meanwhile the consumer
    // gets the same "not loaded yet" shape it already handles.
    return (
      <Suspense
        fallback={
          <>
            {this.props.children({
              wbsRef,
              wbsDoc: undefined,
              goals: [],
              dispatch: undefined,
              missingRef: failed ? this.props.wbsRef : null,
            })}
          </>
        }
      >
        <Fetcher wbsRef={wbsRef} missingRef={failed ? this.props.wbsRef : null}>
          {this.props.children}
        </Fetcher>
      </Suspense>
    );
  }
}

function Fetcher({
  wbsRef,
  missingRef,
  children,
}: {
  wbsRef: string | null;
  missingRef: string | null;
  children: RenderFn;
}) {
  const [wbsDoc, dispatch] = useWorkBreakdownStructureDocumentById(wbsRef);
  const goals = useMemo(() => wbsDoc?.state.global.goals ?? [], [wbsDoc]);
  const linked = useMemo<LinkedWbs>(
    () => ({ wbsRef, wbsDoc, goals, dispatch, missingRef }),
    [wbsRef, wbsDoc, goals, dispatch, missingRef],
  );
  return <>{children(linked)}</>;
}

/** `<LinkedWbsReader wbsRef={p.wbsRef}>{(linked) => …}</LinkedWbsReader>` */
export function LinkedWbsReader({
  wbsRef,
  children,
}: {
  wbsRef: string | null | undefined;
  children: RenderFn;
}) {
  return <Boundary wbsRef={wbsRef ?? null}>{children}</Boundary>;
}

/** Every goal below `rootId`, any depth. */
export function subtreeOf(goals: Goal[], rootId: string): Goal[] {
  const out: Goal[] = [];
  const walk = (id: string) => {
    for (const g of goals) {
      if (g.parentId === id) {
        out.push(g);
        walk(g.id);
      }
    }
  };
  walk(rootId);
  return out;
}
