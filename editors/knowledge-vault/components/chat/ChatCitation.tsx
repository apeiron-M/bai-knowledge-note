import { useState, type CSSProperties, type ReactNode } from "react";
import { setSelectedNode } from "@powerhousedao/reactor-browser";
import { prefetchOnHover } from "../../lib/prefetch.js";
import { writeSowIntent } from "../../../shared/sow-intent.js";
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
    case "bai/wbs":
      return "WBS";
    case "powerhouse/scopeofwork":
      return "scope";
    case "bai/source":
      return "source";
    default:
      return documentType ? documentType.replace(/^bai\//, "") : null;
  }
}

/** Width of the hover card, used to keep it inside the viewport. */
export const CITATION_CARD_WIDTH = 320;

/**
 * Open a cited document — at the cited item when the marker carried one. A
 * scope of work resolves the item id itself (envelope, deliverable,
 * milestone, roadmap, contributor); a work breakdown selects the goal. The
 * intent is written just before the navigation and read once by the editor
 * (see shared/sow-intent.ts); any other kind simply opens.
 */
export function openCitation(c: {
  documentId: string;
  documentType?: string | null;
  anchor?: string | null;
}): void {
  if (c.anchor) {
    if (c.documentType === "powerhouse/scopeofwork") {
      writeSowIntent({ documentId: c.documentId, view: { kind: "locate", id: c.anchor } });
    } else if (c.documentType === "bai/wbs") {
      writeSowIntent({ documentId: c.documentId, view: { kind: "goal", id: c.anchor } });
    }
  }
  setSelectedNode(c.documentId);
}

/** Whether the vault still holds the cited document as current, as a chip label. */
export function staleness(
  currency: CitationCurrency | null | undefined,
): { label: string; title: string } | null {
  if (!currency) return null;
  if (currency.supersededBy.length > 0) {
    return {
      label: "superseded",
      title: `Superseded by: ${currency.supersededBy.map((s) => s.title).join("; ")}`,
    };
  }
  if (currency.archived) {
    return { label: "archived", title: "Archived — no longer held as current" };
  }
  return null;
}

function KindBadge({ kind }: { kind: string }) {
  return (
    <span
      className="shrink-0 rounded px-1 text-[9px] font-medium uppercase tracking-wide"
      style={{ backgroundColor: "var(--bai-bg)", color: "var(--bai-text-faint)" }}
    >
      {kind}
    </span>
  );
}

/**
 * The card behind every citation chip: what the document is, the passage of
 * it that backs the sentence (see lib/chat/evidence.ts), whether it is still
 * current, and what a click will do. Informational only — pointer events are
 * off, so leaving the chip closes it without a dance across the gap.
 */
export function CitationCard({
  citation,
  anchor,
  quote,
  stale,
  style,
}: {
  citation: { title: string; documentType?: string | null };
  anchor?: string | null;
  quote?: string | null;
  stale?: { label: string; title: string } | null;
  style?: CSSProperties;
}) {
  const kind = citationKind(citation.documentType);
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-50 rounded-lg border p-2.5 text-left text-[11px] leading-snug shadow-lg"
      style={{
        width: CITATION_CARD_WIDTH,
        maxWidth: "80vw",
        backgroundColor: "var(--bai-bg)",
        borderColor: "var(--bai-border)",
        color: "var(--bai-text-secondary)",
        ...style,
      }}
    >
      <div className="flex items-center gap-1.5">
        {kind && <KindBadge kind={kind} />}
        <span className="truncate font-medium" style={{ color: "var(--bai-text)" }}>
          {citation.title}
        </span>
      </div>
      {quote ? (
        <p
          className="mt-1.5 italic"
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 4,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          “{quote}”
        </p>
      ) : (
        <p className="mt-1.5" style={{ color: "var(--bai-text-faint)" }}>
          {anchor ? "Cites one item of this document." : "No passage identified — open to read."}
        </p>
      )}
      {stale && (
        <p className="mt-1.5" style={{ color: "#fab387" }}>
          {stale.title}
        </p>
      )}
      <p className="mt-1.5" style={{ color: "var(--bai-text-faint)" }}>
        {anchor ? "Click to open at this item ↗" : "Click to open ↗"}
      </p>
    </div>
  );
}

/**
 * Show a card under `children` while it is hovered or focused; align it to the
 * right edge of the chip when it would otherwise run off the viewport.
 */
export function HoverCard({
  card,
  children,
  className,
}: {
  card: (alignRight: boolean) => ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState<{ alignRight: boolean } | null>(null);
  const show = (el: Element) => {
    const r = el.getBoundingClientRect();
    setOpen({ alignRight: r.left + CITATION_CARD_WIDTH > window.innerWidth - 16 });
  };
  return (
    <span
      className={`relative inline-flex max-w-full ${className ?? ""}`.trim()}
      onMouseEnter={(e) => show(e.currentTarget)}
      onMouseLeave={() => setOpen(null)}
      onFocus={(e) => show(e.currentTarget)}
      onBlur={() => setOpen(null)}
    >
      {children}
      {open && card(open.alignRight)}
    </span>
  );
}

/**
 * A citation is a door, not a footnote: clicking opens the actual document —
 * note, MoC, tension, scope of work, work breakdown or source — in the vault.
 * Numbered to match the `[n]` chips inline in the answer; the kind is shown
 * for anything that is not a plain note, so provenance is visible before the
 * click, and hovering shows the passage the answer drew on.
 */
export function ChatCitation({
  index,
  citation,
  currency,
  quote,
}: {
  /** Position in the numbered Sources list; omitted for a source the answer
   * drew on without an inline [n] marker (read in full, not cited). */
  index?: number;
  citation: Citation;
  /** Whether the vault still holds this document as current; null = unknown kind. */
  currency?: CitationCurrency | null;
  /** The first passage this document was cited for, when one was identified. */
  quote?: string | null;
}) {
  const kind = citationKind(citation.documentType);
  const stale = staleness(currency);
  return (
    <HoverCard
      card={(alignRight) => (
        <CitationCard
          citation={citation}
          quote={quote}
          stale={stale}
          style={{ top: "100%", marginTop: 6, ...(alignRight ? { right: 0 } : { left: 0 }) }}
        />
      )}
    >
      <button
        type="button"
        onClick={() => openCitation(citation)}
        {...prefetchOnHover(citation.documentId)}
        className="group inline-flex max-w-full items-center gap-1.5 rounded-full py-0.5 pl-1.5 pr-2.5 text-[11px] leading-5 transition-colors hover:bg-[var(--bai-accent-soft)]"
        style={{
          backgroundColor: "var(--bai-hover)",
          color: "var(--bai-text-secondary)",
          border: `1px solid ${stale ? "rgba(250, 179, 135, 0.45)" : "var(--bai-border)"}`,
        }}
        aria-label={`Open ${kind ? `${kind} ` : ""}"${citation.title}"${stale ? ` — ${stale.title}` : ""}`}
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
        {kind && <KindBadge kind={kind} />}
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
            {stale.label}
          </span>
        )}
      </button>
    </HoverCard>
  );
}
