import { setSelectedNode } from "@powerhousedao/reactor-browser";
import { prefetchOnHover } from "../../lib/prefetch.js";
import type { Citation } from "../../lib/chat/chat-storage.js";
import type { CitationCurrency } from "../../lib/supersession.js";

/** Short human label for a cited document's kind. */
export function citationKind(documentType: string | null | undefined): string | null {
  switch (documentType) {
    case "bai/knowledge-note":
      return null; // the default kind; labelling every chip "note" is noise
    case "bai/moc":
      return "MoC";
    case "bai/tension":
      return "tension";
    case "bai/observation":
      return "observation";
    case "bai/research-claim":
      return "claim";
    case "bai/project":
      return "project";
    case "bai/wbs":
      return "WBS";
    case "bai/source":
      return "source";
    default:
      return documentType ? documentType.replace(/^bai\//, "") : null;
  }
}

/**
 * A citation is a door, not a footnote: clicking opens the actual document —
 * note, MoC, tension, project, work breakdown or source — in the vault.
 * Numbered to match the `[n]` markers rendered inline in the answer; the kind
 * is shown for anything that is not a plain note, so provenance is visible
 * before the click.
 */
export function ChatCitation({
  index,
  citation,
  currency,
}: {
  /** Position in the numbered Sources list; omitted for a source the answer
   * drew on without an inline [n] marker (read in full, not cited). */
  index?: number;
  citation: Citation;
  /** Whether the vault still holds this document as current; null = unknown kind. */
  currency?: CitationCurrency | null;
}) {
  const kind = citationKind(citation.documentType);
  const superseded = (currency?.supersededBy.length ?? 0) > 0;
  const stale = superseded || currency?.archived === true;
  const staleLabel = superseded ? "superseded" : "archived";
  const staleTitle = superseded
    ? `Superseded by: ${currency!.supersededBy.map((s) => s.title).join("; ")}`
    : "Archived — no longer held as current";
  return (
    <button
      type="button"
      onClick={() => setSelectedNode(citation.documentId)}
      {...prefetchOnHover(citation.documentId)}
      className="group inline-flex max-w-full items-center gap-1.5 rounded-full py-0.5 pl-1.5 pr-2.5 text-[11px] leading-5 transition-colors hover:bg-[var(--bai-accent-soft)]"
      style={{
        backgroundColor: "var(--bai-hover)",
        color: "var(--bai-text-secondary)",
        border: `1px solid ${stale ? "rgba(250, 179, 135, 0.45)" : "var(--bai-border)"}`,
      }}
      title={`Open ${kind ? `${kind} ` : ""}"${citation.title}"${stale ? `\n${staleTitle}` : ""}`}
    >
      {index !== undefined ? (
        <span
          className="inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono text-[10px] font-semibold"
          style={{
            backgroundColor: "var(--bai-accent)",
            color: "var(--bai-accent-text)",
          }}
        >
          {index}
        </span>
      ) : (
        <span
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: "var(--bai-text-faint)" }}
          aria-hidden
        />
      )}
      {kind && (
        <span
          className="shrink-0 rounded px-1 text-[9px] font-medium uppercase tracking-wide"
          style={{
            backgroundColor: "var(--bai-bg)",
            color: "var(--bai-text-faint)",
          }}
        >
          {kind}
        </span>
      )}
      <span
        className={`truncate group-hover:text-[var(--bai-accent)] ${stale ? "line-through decoration-[rgba(250,179,135,0.7)]" : ""}`}
      >
        {citation.title}
      </span>
      {stale && (
        <span
          className="shrink-0 rounded px-1 text-[9px] font-medium uppercase tracking-wide"
          style={{ backgroundColor: "rgba(250, 179, 135, 0.15)", color: "#fab387" }}
        >
          {staleLabel}
        </span>
      )}
    </button>
  );
}
