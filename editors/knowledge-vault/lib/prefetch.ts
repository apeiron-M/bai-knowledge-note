/**
 * Warm the document cache before the user finishes clicking.
 *
 * Under remote-first mode a document's state is fetched from the
 * Switchboard the moment its editor mounts — which reads as a blank
 * pane for the fetch duration. Pointer intent (hovering a row) precedes
 * the click by enough time to hide most of that latency.
 *
 * Prefetch fires only after the pointer DWELLS on a row: firing on raw
 * `mouseenter` meant that merely scrolling the sidebar queued dozens of
 * full-document fetches (visible as a pile of pending requests in the
 * network tab). A 150 ms dwell distinguishes "moving across the list"
 * from "aiming at this row" — transit costs zero requests, a genuine
 * hover costs exactly one, and the cache dedupes repeats.
 */
import type { IDocumentCache } from "@powerhousedao/reactor-browser";

const DWELL_MS = 150;

const pending = new Map<string, ReturnType<typeof setTimeout>>();

function cache(): IDocumentCache | undefined {
  return (window as unknown as { ph?: { documentCache?: IDocumentCache } }).ph
    ?.documentCache;
}

/** Immediately warm the cache for `id` (use at click/selection time). */
export function prefetchDocument(id: string | null | undefined): void {
  if (!id) return;
  try {
    void cache()?.get(id);
  } catch {
    // Best-effort warm-up only.
  }
}

/**
 * Hover handlers for a list row: schedule a prefetch after a short
 * dwell, cancel it if the pointer leaves first. Spread onto the row:
 * `<button {...prefetchOnHover(id)} …>`.
 */
export function prefetchOnHover(id: string | null | undefined): {
  onMouseEnter: () => void;
  onMouseLeave: () => void;
} {
  return {
    onMouseEnter: () => {
      if (!id || pending.has(id)) return;
      pending.set(
        id,
        setTimeout(() => {
          pending.delete(id);
          prefetchDocument(id);
        }, DWELL_MS),
      );
    },
    onMouseLeave: () => {
      if (!id) return;
      const timer = pending.get(id);
      if (timer) {
        clearTimeout(timer);
        pending.delete(id);
      }
    },
  };
}
