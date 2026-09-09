/**
 * Layout measurements, for the cases where a number has to cross a component
 * boundary that props cannot.
 *
 * The vault shell hosts document editors it does not own — Connect hands them
 * over as `children` — so it cannot ask a hosted editor how wide its sidebar
 * is or be told when that changes. Measuring the rendered element is the only
 * honest answer: it tracks the editor's own CSS, including its media queries
 * and its collapse toggle, without either side having to know the other's
 * numbers.
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

/**
 * The border-box width of the first descendant of `ref` matching `selector`,
 * or 0 when there is none.
 *
 * The descendant belongs to a subtree this component renders but does not
 * control, so it may arrive a commit later than the host — hence the
 * MutationObserver that waits for it rather than a single lookup that would
 * silently measure nothing. Returning 0 when absent is deliberate: every
 * caller should lay out sensibly at zero, so a renamed class in the other
 * editor degrades to the previous layout instead of breaking this one.
 */
export function useDescendantWidth(
  ref: RefObject<HTMLElement | null>,
  selector: string,
  enabled: boolean,
): number {
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!enabled || !root || typeof ResizeObserver === "undefined") {
      setWidth(0);
      return;
    }

    let resize: ResizeObserver | null = null;
    const attach = (): boolean => {
      const el = root.querySelector<HTMLElement>(selector);
      if (!el) return false;
      const measure = () => setWidth(el.getBoundingClientRect().width);
      measure();
      resize = new ResizeObserver(measure);
      resize.observe(el);
      return true;
    };

    let mutation: MutationObserver | null = null;
    if (!attach() && typeof MutationObserver !== "undefined") {
      mutation = new MutationObserver(() => {
        if (attach()) {
          mutation?.disconnect();
          mutation = null;
        }
      });
      mutation.observe(root, { childList: true, subtree: true });
    }

    return () => {
      resize?.disconnect();
      mutation?.disconnect();
    };
  }, [ref, selector, enabled]);

  return enabled ? width : 0;
}
