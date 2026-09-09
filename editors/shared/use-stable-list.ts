/**
 * Preserve array identity across renders while the contents are equivalent.
 *
 * Several of Connect's hooks derive their result with a `.filter()` — e.g.
 * `useFileNodesInSelectedDrive()` is `useNodesInSelectedDrive()?.filter(...)`
 * upstream — which allocates a NEW array on every render even when nothing
 * about the drive changed. Anything downstream that lists it in a dependency
 * array is then invalidated on every render, and in this app the tail of that
 * chain is expensive: `fileNodes` → `knowledgeFileNodes` → `notes` (one fresh
 * object per note, ~1,500 of them) → `noteMap` → the ~550-line `useEffect`
 * in `GraphViewPixi` that rebuilds the entire graph scene.
 *
 * This hook breaks the chain at the source. It compares element-wise with a
 * caller-supplied predicate and returns the PREVIOUS array whenever the two
 * are equivalent, so the memos downstream stay valid.
 *
 * Writing to a ref during render is deliberate and safe here: the
 * computation is pure and idempotent, so a double render (StrictMode) reaches
 * the same result. It is the same shape as a `useMemo` with a custom equality
 * function, which React does not provide.
 */
import { useRef } from "react";

/** Shared empty array, so a null input does not allocate one per render. */
const EMPTY: readonly never[] = Object.freeze([]);

/**
 * Element-wise equivalence. Exported for tests — this is the whole decision.
 * Length first: it is the cheap discriminator and the common case for a
 * drive that gained or lost a document.
 */
export function listsEquivalent<T>(
  prev: readonly T[],
  next: readonly T[],
  isSameItem: (a: T, b: T) => boolean,
): boolean {
  if (prev === next) return true;
  if (prev.length !== next.length) return false;
  for (let i = 0; i < next.length; i++) {
    if (!isSameItem(prev[i], next[i])) return false;
  }
  return true;
}

export function useStableList<T>(
  list: readonly T[] | undefined | null,
  isSameItem: (a: T, b: T) => boolean,
): readonly T[] {
  const ref = useRef<readonly T[]>(EMPTY);
  const next = list ?? (EMPTY as readonly T[]);
  if (!listsEquivalent(ref.current, next, isSameItem)) ref.current = next;
  return ref.current;
}

/**
 * The comparison drive nodes need: identity plus the fields the UI renders
 * from the tree. A rename must invalidate; a re-filtered identical list
 * must not.
 */
export function sameDriveNode(
  a: { id: string; name?: string | null; documentType?: string | null },
  b: { id: string; name?: string | null; documentType?: string | null },
): boolean {
  return (
    a.id === b.id && a.name === b.name && a.documentType === b.documentType
  );
}
