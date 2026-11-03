/**
 * What the Notes page keeps between visits. The grouping is remembered per
 * vault and How notes work's dismissal everywhere (localStorage); where you
 * were — the search, the filters, the batches drawn, what is open, the scroll —
 * is kept for the session, so closing a note (× or Esc) comes back to it.
 */
export type NotesGrouping = "source" | "topic" | "all";
export type NotesOrder = "linked" | "newest" | "az";

export type NotesPlace = {
  query: string;
  review: boolean;
  kind: string | null;
  order: NotesOrder;
  batches: number;
  open: string[];
  peek: string | null;
  scrollTop: number;
};

const GROUPING_KEY = "bai:notes-grouping:";
const HOW_KEY = "bai:notes-how-dismissed";
const places = new Map<string, NotesPlace>();

export function readGrouping(driveId: string | undefined): NotesGrouping {
  try {
    const v = localStorage.getItem(GROUPING_KEY + (driveId ?? ""));
    return v === "topic" || v === "all" ? v : "source";
  } catch {
    return "source";
  }
}

export function writeGrouping(driveId: string | undefined, grouping: NotesGrouping): void {
  try {
    localStorage.setItem(GROUPING_KEY + (driveId ?? ""), grouping);
  } catch {
    // Private mode or a full quota only costs the remembered choice.
  }
}

export function howDismissed(): boolean {
  try {
    return localStorage.getItem(HOW_KEY) === "1";
  } catch {
    return false;
  }
}

export function setHowDismissed(dismissed: boolean): void {
  try {
    if (dismissed) localStorage.setItem(HOW_KEY, "1");
    else localStorage.removeItem(HOW_KEY);
  } catch {
    // As above.
  }
}

export function recallPlace(key: string): NotesPlace | undefined {
  return places.get(key);
}

export function keepPlace(key: string, place: NotesPlace): void {
  places.set(key, place);
}
