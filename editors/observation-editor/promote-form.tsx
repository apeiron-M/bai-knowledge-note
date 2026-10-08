/**
 * Promoting an observation asks which note it became. An inline field rather than
 * `window.prompt`: a desktop app's webview may not show browser dialogs at all (macOS's
 * WebKit needs the app to implement them), and a prompt is foreign to the rest of the editor.
 */
export function promotedRef(input: string): string | null {
  const ref = input.trim();
  return ref ? ref : null;
}

export function PromoteForm({
  value,
  onChange,
  onSubmit,
  onCancel,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (ref: string) => void;
  onCancel: () => void;
}) {
  const ref = promotedRef(value);
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (ref) onSubmit(ref);
      }}
    >
      <label className="text-xs" style={{ color: "var(--bai-text-secondary)" }}>
        Promoted to note
      </label>
      <input
        aria-label="Promoted to note ID"
        value={value}
        autoFocus
        placeholder="Note ID"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
        className="rounded border px-2 py-1 font-mono text-xs outline-none"
        style={{ borderColor: "var(--bai-border)", backgroundColor: "var(--bai-bg)", color: "var(--bai-text)" }}
      />
      <button
        type="submit"
        disabled={!ref}
        className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
      >
        Promote
      </button>
      <button type="button" onClick={onCancel} className="rounded px-3 py-1 text-xs" style={{ color: "var(--bai-text-secondary)" }}>
        Cancel
      </button>
    </form>
  );
}
