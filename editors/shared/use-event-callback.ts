/**
 * A callback with a STABLE identity that always calls the latest version.
 *
 * Parents pass handlers as inline arrows — `onCancel={() => setOpen(false)}`
 * — which is idiomatic and harmless for a prop that is only ever called.
 * It is not harmless for a prop that lands in a dependency array: the arrow
 * is a new function on every parent render, so the effect tears down and
 * re-runs every time. In this codebase that produced two distinct bugs:
 *
 *  - `ui.tsx`'s toast restarted its 8s auto-dismiss timer on every parent
 *    render, so while anything kept the Shell rendering the error toast
 *    never dismissed at all.
 *  - `BlockReasonDialog`'s `keydown` listener was removed and re-added on
 *    every render, once per `StatusChipMenu` — about 130 add/remove cycles
 *    per render pass on a 65-goal tree.
 *
 * Wrapping the handler here lets the effect depend on it honestly (no
 * lint suppression, no stale closure) while the identity stays put.
 *
 * `useLayoutEffect` rather than `useEffect` for the assignment: the ref must
 * be current before any effect that might call it runs in the same commit.
 */
import { useCallback, useLayoutEffect, useRef } from "react";

export function useEventCallback<Args extends unknown[], R>(
  fn: (...args: Args) => R,
): (...args: Args) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: Args) => ref.current(...args), []);
}
