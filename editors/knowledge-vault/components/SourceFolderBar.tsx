type Crumb = { id: string | null; name: string };

/**
 * Where you are inside /sources, and the way out — shown only inside a folder.
 *
 * The back button names its destination ("All sources", or the parent
 * folder) and sits where back buttons live, top left — the same
 * "← Vaults" shape the desktop app's own top bar uses. The folder's name is
 * the heading of this view, so arriving in a folder reads as being *in*
 * something, not as a different page. Deeper than one level, the path is a
 * row of links, so any ancestor is one click away.
 *
 * Sticky, because a book is twenty chapters long: the way out stays on
 * screen however far down the list the reader has scrolled.
 */
export function SourceFolderBar({
  trail,
  total,
  onNavigate,
}: {
  /** Root first, current folder last; at least two entries. */
  trail: readonly Crumb[];
  /** Sources in this folder and beneath it. */
  total: number;
  onNavigate: (folderId: string | null) => void;
}) {
  const current = trail[trail.length - 1];
  const parent = trail[trail.length - 2];
  const backLabel = parent.id === null ? "All sources" : parent.name;

  return (
    <div
      className="sticky top-0 z-10 -mx-4 px-4 py-2"
      style={{ backgroundColor: "var(--bai-bg)" }}
    >
      <div
        className="flex items-center gap-3 rounded-xl px-3 py-2.5"
        style={{
          backgroundColor: "var(--bai-surface)",
          border:
            "1px solid color-mix(in srgb, var(--bai-accent) 30%, var(--bai-border))",
        }}
      >
        <button
          type="button"
          onClick={() => onNavigate(parent.id)}
          title={`Back to ${backLabel} (Alt+↑)`}
          aria-label={`Back to ${backLabel}`}
          className="source-back flex max-w-[14rem] shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium"
          style={{
            color: "var(--bai-text-secondary)",
            backgroundColor: "var(--bai-bg)",
            border: "1px solid var(--bai-border)",
          }}
        >
          <svg
            className="h-3.5 w-3.5 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M19 12H5M11 18l-6-6 6-6" />
          </svg>
          <span className="truncate">{backLabel}</span>
        </button>

        <svg
          className="h-4 w-4 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          style={{ color: "var(--bai-accent)" }}
          aria-hidden="true"
        >
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
        <div className="min-w-0 flex-1">
          <h3
            className="truncate text-sm font-semibold"
            style={{ color: "var(--bai-text)" }}
            title={current.name}
          >
            {current.name}
          </h3>
          {trail.length > 2 && (
            <nav
              aria-label="Folder path"
              className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1 text-[11px]"
            >
              {trail.slice(0, -1).map((crumb, i) => (
                <span
                  key={crumb.id ?? "root"}
                  className="flex min-w-0 items-center gap-1"
                >
                  {i > 0 && (
                    <span style={{ color: "var(--bai-text-faint)" }}>/</span>
                  )}
                  <button
                    type="button"
                    onClick={() => onNavigate(crumb.id)}
                    className="source-crumb max-w-[12rem] truncate"
                    style={{ color: "var(--bai-accent)" }}
                  >
                    {crumb.id === null ? "All sources" : crumb.name}
                  </button>
                </span>
              ))}
            </nav>
          )}
        </div>
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[10px]"
          style={{
            backgroundColor: "var(--bai-hover)",
            color: "var(--bai-text-tertiary)",
          }}
        >
          {total} {total === 1 ? "source" : "sources"}
        </span>
      </div>
      <style>{`
        .source-back { transition: border-color 120ms ease, color 120ms ease; }
        .source-back:hover { border-color: var(--bai-accent) !important; color: var(--bai-accent) !important; }
        .source-back:focus-visible, .source-crumb:focus-visible { outline: 2px solid var(--bai-accent); outline-offset: 2px; }
        .source-crumb:hover { text-decoration: underline; }
      `}</style>
    </div>
  );
}
