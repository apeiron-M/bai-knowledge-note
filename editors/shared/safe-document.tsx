import { useDocumentById } from "@powerhousedao/reactor-browser";
import type { PHDocument } from "document-model";
import { Component, Suspense, type ReactNode } from "react";

/**
 * Read another document by id without letting a dangling reference take the
 * editor down.
 *
 * `useDocumentById` calls React's `use()` on the cached document promise; an
 * id the server does not hold rejects that promise *during render*, and the
 * remote-first cache keeps the rejection, so an unguarded read fails on every
 * render thereafter. This boundary catches the throw and re-renders the same
 * reader with `id` forced to `null` — the one input that never reaches `use()`
 * — reporting `failed: true` so the caller can degrade honestly. The error
 * clears as soon as `id` changes (re-linking recovers without a remount).
 */
type RenderFn = (doc: PHDocument | undefined, failed: boolean) => ReactNode;
type State = { error: Error | null; errorId: string | null };

class Boundary extends Component<{ id: string | null; children: RenderFn }, State> {
  state: State = { error: null, errorId: null };
  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }
  static getDerivedStateFromProps(props: { id: string | null }, state: State): Partial<State> | null {
    if (!state.error) return null;
    if (state.errorId === null) return { errorId: props.id };
    if (state.errorId !== props.id) return { error: null, errorId: null };
    return null;
  }
  componentDidCatch(err: Error) {
    console.error(`[safe-document] ${this.props.id ?? "?"} could not be loaded:`, err.message);
  }
  render() {
    const failed = this.state.error !== null;
    // Suspense of our own: `use()` suspends until the document is cached, and
    // without a boundary here that unwinds the whole hosting editor's render.
    // The consumer already renders for `doc === undefined`.
    return (
      <Suspense fallback={<>{this.props.children(undefined, failed)}</>}>
        <Reader id={failed ? null : this.props.id} failed={failed}>
          {this.props.children}
        </Reader>
      </Suspense>
    );
  }
}

function Reader({ id, failed, children }: { id: string | null; failed: boolean; children: RenderFn }) {
  const [doc] = useDocumentById(id);
  return <>{children(doc, failed)}</>;
}

/** `<SafeDocument id={ref}>{(doc, failed) => …}</SafeDocument>` */
export function SafeDocument({ id, children }: { id: string | null | undefined; children: RenderFn }) {
  return <Boundary id={id ?? null}>{children}</Boundary>;
}
