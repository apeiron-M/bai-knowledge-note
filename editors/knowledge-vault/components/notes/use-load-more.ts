import { useEffect, useRef, type RefObject } from "react";

/** The element that scrolls `el`: the nearest ancestor that scrolls vertically, or the window (null). */
export function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const y = getComputedStyle(p).overflowY;
    if (y === "auto" || y === "scroll" || y === "overlay") return p;
  }
  return null;
}

/**
 * More as you scroll: calls `onMore` once the end row comes within `ahead`
 * pixels of view, so the next batch is drawn before it is reached. `drawn`
 * re-arms it after each batch — an end row still in view asks again.
 */
export function useLoadMore(end: RefObject<HTMLElement | null>, more: boolean, drawn: number, onMore: () => void, ahead = 600) {
  const call = useRef(onMore);
  call.current = onMore;
  useEffect(() => {
    const el = end.current;
    if (!el || !more || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) call.current();
    }, { root: scrollParent(el), rootMargin: `0px 0px ${ahead}px 0px` });
    io.observe(el);
    return () => io.disconnect();
  }, [end, more, drawn, ahead]);
}
