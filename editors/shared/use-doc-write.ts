/**
 * A write an editor waits for. `dispatch` answers through two callbacks — the
 * operation was applied, or it was refused (by the reducer, the network or the
 * vault's access rules) — and an editor that ignores them shows nothing when a
 * write fails: the form closes and the document simply does not change. This
 * keeps the form open until the vault answers, and says what went wrong where
 * the person acted.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { plainError } from "./plain-error.js";

/** What the model's own refusals mean to a reader. */
const REFUSALS: [RegExp, string][] = [
  [/tension is not open/i, "This contradiction is already closed. Close the form to see how it was closed."],
  [/only a pending observation can be promoted/i, "Only a pending observation can be promoted. It has already moved on."],
  [/only a promoted observation can be implemented/i, "Only a promoted observation can be marked implemented."],
  [/observation is already archived/i, "This observation is already archived."],
  [/insufficient permissions|forbidden|not authori[sz]ed/i, "You don't have permission to change this vault. Ask its administrator for write access."],
];

/** One readable line for a refused or failed write. */
export function writeErrorText(errors: readonly unknown[]): string {
  const first = errors[0];
  const raw = first instanceof Error ? first.message : typeof first === "string" ? first : "";
  for (const [pattern, text] of REFUSALS) if (pattern.test(raw)) return text;
  const plain = plainError(first ?? "The vault did not accept this change.");
  return plain || "The vault did not accept this change.";
}

/** How long a write may go unanswered before the editor says so. */
export const WRITE_TIMEOUT_MS = 20_000;
export const NO_ANSWER =
  "No answer from the vault yet. The change may still arrive; check that the vault is reachable.";

type Dispatch<A> = (action: A, onErrors?: (errors: Error[]) => void, onSuccess?: () => void) => void;

export function useDocWrite<A>(dispatch: Dispatch<A>) {
  /** Which write is in flight (a name the editor chooses), or null. */
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const write = useCallback(
    (name: string, action: A, onDone?: () => void) => {
      setBusy(name);
      setError(null);
      let settled = false;
      const settle = (message: string | null) => {
        if (settled) return false;
        settled = true;
        clearTimeout(timer);
        if (!alive.current) return false;
        setBusy(null);
        setError(message);
        return true;
      };
      const timer = setTimeout(() => settle(NO_ANSWER), WRITE_TIMEOUT_MS);
      try {
        dispatch(
          action,
          (errors) => void settle(writeErrorText(errors)),
          () => {
            if (settle(null)) onDone?.();
          },
        );
      } catch (e) {
        settle(writeErrorText([e]));
      }
    },
    [dispatch],
  );

  const clearError = useCallback(() => setError(null), []);
  return { busy, error, write, clearError };
}
