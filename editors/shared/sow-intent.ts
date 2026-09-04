/**
 * One-shot hand-off from the vault into the Scope of Work editor.
 *
 * Connect instantiates an editor from a node selection, so there is no props
 * channel through which the vault can say "open this document *at this
 * project*". Clicking an envelope row in the vault's Projects tab would
 * otherwise land the reader on the SoW overview, leaving them to find the
 * project again by hand.
 *
 * The same shape as the OpenRouter return intent
 * (`lib/chat/openrouter-auth.ts`): write before navigating, read exactly once
 * on mount. The read clears the key, so a later reload of the same document
 * opens on its own default view rather than snapping back.
 *
 * `documentId` is checked by the reader: an intent left behind for one SoW must
 * never steer another.
 */
const STORAGE_KEY = "bai:sow-open-intent";

/** Views the vault is allowed to deep-link into. */
export type SowIntentView =
  | { kind: "project"; id: string }
  | { kind: "deliverables" }
  | { kind: "team" };

export type SowIntent = {
  documentId: string;
  view: SowIntentView;
};

/** Record where the SoW editor should open. Call immediately before selecting the node. */
export function writeSowIntent(intent: SowIntent): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(intent));
  } catch {
    // A private-mode or quota failure only costs the deep link, so the
    // navigation itself must still happen.
  }
}

/**
 * Read the intent exactly once. Returns null unless one was stored for
 * `documentId`.
 */
export function readSowIntent(documentId: string): SowIntentView | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      documentId?: unknown;
      view?: { kind?: unknown; id?: unknown };
    };
    if (parsed.documentId !== documentId) return null;
    const kind = parsed.view?.kind;
    if (kind === "project" && typeof parsed.view?.id === "string") {
      return { kind: "project", id: parsed.view.id };
    }
    if (kind === "deliverables") return { kind: "deliverables" };
    if (kind === "team") return { kind: "team" };
    return null;
  } catch {
    return null;
  }
}
