/**
 * Layout measurements, for the cases where a number has to cross a component
 * boundary that props cannot.
 *
 * Only for elements the caller renders itself. Measuring an element from
 * another editor's subtree was tried here and read 0 in the live app; the
 * hosted layout now takes the sidebar width as a CSS variable the owning
 * editor declares (see scope-of-work/lib/styles.ts, hosted block).
 */
import { useLayoutEffect, useState, type RefObject } from "react";


/**
 * An element's border-box height, updated as it changes; 0 when disabled or
 * not yet measured.
 *
 * `useLayoutEffect`, not `useEffect`: the caller lays out with this number, so
 * measuring after paint would show one frame of the un-measured layout — the
 * very jump this is being used to remove.
 */
export function useMeasuredHeight(
  ref: RefObject<HTMLElement | null>,
  enabled = true,
): number {
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!enabled || !el || typeof ResizeObserver === "undefined") {
      setHeight(0);
      return;
    }
    const measure = () => setHeight(el.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, enabled]);
  return height;
}
