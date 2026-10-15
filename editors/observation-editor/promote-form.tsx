/**
 * Promoting an observation asks which note it became. An inline field rather than
 * `window.prompt`: a desktop app's webview may not show browser dialogs at all (macOS's
 * WebKit needs the app to implement them), and a prompt is foreign to the rest of the editor.
 *
 * The note is found by its title (or its id, pasted), then confirmed: promoting cannot be undone.
 */
import { useState } from "react";
import { NoteFinder } from "../shared/note-finder.js";
import type { VaultDocSummary } from "../shared/vault-doc-index-store.js";

export function promotedRef(input: string): string | null {
  const ref = input.trim();
  return ref ? ref : null;
}

export function PromoteForm({
  docs,
  busy = false,
  onSubmit,
  onCancel,
}: {
  /** The vault's notes, to find the one the observation became. */
  docs: readonly VaultDocSummary[];
  busy?: boolean;
  onSubmit: (ref: string) => void;
  onCancel: () => void;
}) {
  const [picked, setPicked] = useState<VaultDocSummary | null>(null);
  const ref = picked ? promotedRef(picked.id) : null;
  return (
    <form
      className="flex w-full flex-wrap items-center gap-2"
      aria-label="Promote this observation"
      onSubmit={(e) => {
        e.preventDefault();
        if (ref && !busy) onSubmit(ref);
      }}
    >
      <span className="text-xs" style={{ color: "var(--bai-text-secondary)" }}>
        Promoted to note
      </span>
      {picked ? (
        <span className="flex-1 text-sm" style={{ color: "var(--bai-text)" }}>
          <b>{picked.title}</b>{" "}
          <button
            type="button"
            className="text-xs underline"
            style={{ color: "var(--bai-text-secondary)" }}
            disabled={busy}
            onClick={() => setPicked(null)}
          >
            Change
          </button>
        </span>
      ) : (
        <NoteFinder docs={docs} label="Promoted to note" autoFocus onPick={setPicked} onEscape={onCancel} />
      )}
      <button
        type="submit"
        disabled={!ref || busy}
        className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
      >
        {busy ? "Promoting…" : "Promote"}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="rounded px-3 py-1 text-xs"
        style={{ color: "var(--bai-text-secondary)" }}
      >
        Cancel
      </button>
    </form>
  );
}
