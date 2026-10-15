/**
 * A request, made outside the tension editor, to open one contradiction
 * straight on its closing form: the Contradictions list's "Resolve…" and
 * "Dissolve…" (design: docs/design/vault-view, Contradictions).
 *
 * The list sets it and selects the document; the editor reads it when it
 * opens that document. Reading does not consume it — React's development mode
 * runs effects twice, and a consumed request would be gone on the second run —
 * so it simply expires: it applies only to that document, and only for a few
 * seconds after it was made. Kept in sessionStorage so the two editors need not
 * share a module instance.
 */
export type TensionCloseKind = "resolve" | "dissolve";

const KEY = "bai-tension-close:v1";
/** Long enough to cover selecting the document and its editor loading it. */
const LIFETIME_MS = 8_000;

type Stored = { id: string; kind: TensionCloseKind; at: number };

export function requestTensionClose(id: string, kind: TensionCloseKind, now: number = Date.now()): void {
  try {
    const value: Stored = { id, kind, at: now };
    sessionStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // No storage: the editor opens on its analysis, as before.
  }
}

/** The closing form to open this document on, if one was asked for just now. */
export function pendingTensionClose(id: string, now: number = Date.now()): TensionCloseKind | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<Stored>;
    if (value.id !== id || typeof value.at !== "number") return null;
    if (now - value.at > LIFETIME_MS || now < value.at) return null;
    return value.kind === "resolve" || value.kind === "dissolve" ? value.kind : null;
  } catch {
    return null;
  }
}

/** Done with it: the form was used, cancelled or left. */
export function clearTensionClose(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}
