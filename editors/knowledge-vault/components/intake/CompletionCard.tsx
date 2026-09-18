import type { IntakeFile } from "../../lib/intake-model.js";
import { JourneyStrip } from "./JourneyStrip.js";

/**
 * Step 4 of 4, for the whole batch: every file is in the vault. One card, the
 * journey strip fully green, one row per folder created, and Finish — which
 * closes the panel and nothing else, because the sources are already there.
 */
export function CompletionCard({
  files,
  onFinish,
  onAddMore,
  onOpenSources,
}: {
  files: IntakeFile[];
  onFinish: () => void;
  onAddMore: () => void;
  onOpenSources?: () => void;
}) {
  const sources = files.reduce((n, f) => n + (f.publishedIds?.length ?? 0), 0);
  return (
    <div
      className="mx-auto mt-4 w-full max-w-2xl rounded-xl px-7 py-6 text-center"
      style={{
        backgroundColor: "var(--bai-surface)",
        border: "1px solid var(--bai-ok)",
      }}
    >
      <div
        className="completion-pop text-4xl leading-none"
        style={{ color: "var(--bai-ok)" }}
      >
        ✓
      </div>
      <h2
        className="mt-2 text-base font-semibold"
        style={{ color: "var(--bai-text)" }}
      >
        All {files.length} file{files.length === 1 ? " is" : "s are"} in the
        vault
      </h2>
      <p className="mt-1 text-xs" style={{ color: "var(--bai-text-tertiary)" }}>
        {sources} source{sources === 1 ? "" : "s"} across {files.length} folder
        {files.length === 1 ? "" : "s"}, queued for extraction. The original
        file is attached to every source.
      </p>
      <div className="mt-3 flex justify-center">
        <JourneyStrip reached={4} now={3} size="lg" />
      </div>
      <div className="mx-auto mt-4 max-w-xl space-y-1.5 text-left">
        {files.map((f) => (
          <div
            key={f.id}
            className="flex items-center gap-2.5 rounded-lg px-3 py-2.5"
            style={{
              backgroundColor: "var(--bai-surface)",
              border: "1px solid var(--bai-border)",
              boxShadow: "0 1px 0 rgba(0,0,0,0.25)",
            }}
          >
            <svg
              className="h-4 w-4 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              style={{ color: "var(--bai-accent)" }}
            >
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </svg>
            <span
              className="min-w-0 flex-1 truncate text-xs font-medium"
              style={{ color: "var(--bai-text)" }}
            >
              {f.folderName}/
            </span>
            <span
              className="shrink-0 rounded-full px-2 py-0.5 text-[10px]"
              style={{
                backgroundColor: "var(--bai-hover)",
                color: "var(--bai-text-tertiary)",
              }}
            >
              {f.publishedIds?.length ?? 0} source
              {f.publishedIds?.length === 1 ? "" : "s"} · extracting
            </span>
          </div>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={onFinish}
          className="rounded-lg px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90"
          style={{
            backgroundColor: "var(--bai-accent)",
            color: "var(--bai-accent-text)",
          }}
        >
          Finish
        </button>
        <button
          type="button"
          onClick={onAddMore}
          className="rounded-lg px-3 py-2 text-sm"
          style={{
            color: "var(--bai-accent)",
            border: "1px solid var(--bai-border)",
          }}
        >
          Add more files
        </button>
        {onOpenSources && (
          <button
            type="button"
            onClick={onOpenSources}
            className="rounded-lg px-3 py-2 text-sm"
            style={{
              color: "var(--bai-accent)",
              border: "1px solid var(--bai-border)",
            }}
          >
            Open in Sources
          </button>
        )}
      </div>
      <p
        className="mt-3 text-[11px]"
        style={{ color: "var(--bai-text-muted)" }}
      >
        Finish closes this panel and shows your sources. Nothing else happens —
        the sources are already in the vault.
      </p>
      <style>{`
        @keyframes completion-pop { 0% { transform: scale(.6); opacity: 0 } 60% { transform: scale(1.15) } 100% { transform: scale(1); opacity: 1 } }
        .completion-pop { display: inline-block; animation: completion-pop .5s ease-out; }
      `}</style>
    </div>
  );
}
