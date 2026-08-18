/**
 * Shared loading affordances for the knowledge-vault views.
 *
 * All sidebar/list metadata arrives in ONE multi-second subgraph query
 * (a ~1.5k-note vault serialises to ~3 MB, and the drive tree is a
 * second query on top). Before these existed every view rendered its
 * *empty* state during that window, so a cold open looked like an empty
 * vault that only later filled in — first with bare titles, then with
 * metadata. Any view that can render before its data has arrived shows
 * one of these instead, and keeps its real empty state for the case
 * where loading finished and there genuinely is nothing.
 *
 * `LoadingPanel` intentionally mirrors the panels already used by the
 * Sources / Projects views so the whole app speaks one language.
 */

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={`${className} animate-spin`}
      style={{ color: "var(--bai-text-muted)" }}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      <path d="M21 12a9 9 0 11-6.219-8.56" />
    </svg>
  );
}

/** Centred spinner panel — matches the Sources / Projects loading panels. */
export function LoadingPanel({
  label,
  heightClass = "h-64",
}: {
  label: string;
  heightClass?: string;
}) {
  return (
    <div
      className={`flex ${heightClass} items-center justify-center rounded-xl`}
      style={{
        backgroundColor: "var(--bai-surface)",
        border: "1px solid var(--bai-border)",
      }}
    >
      <div className="flex items-center gap-2">
        <Spinner />
        <p className="text-sm" style={{ color: "var(--bai-text-muted)" }}>
          {label}
        </p>
      </div>
    </div>
  );
}

/** Inline spinner + label, for tight spots where a panel would be too heavy. */
export function LoadingLine({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-4">
      <Spinner className="h-3.5 w-3.5" />
      <span className="text-xs" style={{ color: "var(--bai-text-muted)" }}>
        {label}
      </span>
    </div>
  );
}

// Deterministic widths so the placeholder reads as a list of varying
// titles rather than a block of identical bars.
const ROW_WIDTHS = ["82%", "64%", "91%", "73%", "58%", "86%", "69%", "77%"];

/**
 * Shimmering placeholder rows for the sidebar lists. Preferred over a bare
 * spinner there because the shape of what is coming is itself information —
 * and unlike the old behaviour it never claims a group has "0" items.
 */
export function SidebarSkeleton({
  label,
  rows = 7,
}: {
  label: string;
  rows?: number;
}) {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <Spinner className="h-3 w-3" />
        <span className="text-[11px]" style={{ color: "var(--bai-text-muted)" }}>
          {label}
        </span>
      </div>
      <div className="ml-1 space-y-px">
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            className="flex flex-col gap-1.5 rounded-md px-2 py-2"
            style={{ opacity: 1 - i * 0.09 }}
          >
            <div
              className="h-2.5 animate-pulse rounded"
              style={{
                width: ROW_WIDTHS[i % ROW_WIDTHS.length],
                backgroundColor: "var(--bai-hover)",
              }}
            />
            <div
              className="h-2 w-12 animate-pulse rounded"
              style={{ backgroundColor: "var(--bai-hover)", opacity: 0.6 }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
