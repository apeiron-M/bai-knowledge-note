import { useMemo, useRef, useState, type MouseEvent, type FocusEvent } from "react";
import { MarkdownPreview } from "../../../shared/markdown-preview.js";
import type { Citation, StoredMessage } from "../../lib/chat/chat-storage.js";
import type { TrailEntry } from "../../hooks/use-chat.js";
import type { CitationCurrency } from "../../lib/supersession.js";
import {
  markerOccurrences,
  numberCitations,
} from "../../lib/chat/inline-citations.js";
import {
  CITATION_CARD_WIDTH,
  ChatCitation,
  CitationCard,
  openCitation,
  staleness,
} from "./ChatCitation.js";
import { ChatToolTrail } from "./ChatToolTrail.js";

export { numberCitations } from "../../lib/chat/inline-citations.js";

export function ChatMessage({
  message,
  trail,
  streaming = false,
  currency,
}: {
  message: StoredMessage;
  /** Only the latest assistant turn carries a live trail. */
  trail?: TrailEntry[];
  streaming?: boolean;
  /** Is a cited document still current? Marks superseded/archived chips. */
  currency?: (documentId: string) => CitationCurrency | null;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md px-4 py-2.5 text-sm leading-relaxed"
          style={{
            backgroundColor: "var(--bai-hover)",
            color: "var(--bai-text)",
          }}
        >
          {message.content}
        </div>
      </div>
    );
  }
  return (
    <AssistantTurn
      message={message}
      trail={trail}
      streaming={streaming}
      currency={currency}
    />
  );
}

/** What one inline chip points at: stored evidence, or just the marker's parts. */
type Occurrence = { documentId: string; anchor: string | null; quote?: string | null };

/** The inline chip under the pointer, read off the rendered HTML. */
function chipAt(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>(".md-cite") : null;
}

/** The marker position a chip carries; null when the attribute is not an index. */
function positionOf(chip: HTMLElement): number | null {
  const k = Number(chip.dataset.occurrence);
  return Number.isInteger(k) && k >= 0 ? k : null;
}

function AssistantTurn({
  message,
  trail,
  streaming,
  currency,
}: {
  message: StoredMessage;
  trail?: TrailEntry[];
  streaming: boolean;
  currency?: (documentId: string) => CitationCurrency | null;
}) {
  // Depend on the stored arrays themselves (stable across renders), not a
  // fresh `?? []` fallback that would defeat the memo.
  const citations = message.citations;
  const evidence = message.evidence;
  const body = useMemo(
    () => numberCitations(message.content, citations ?? []),
    [message.content, citations],
  );
  // What each inline chip points at, by marker position: the stored evidence
  // (document, item, passage) or, for a turn saved before evidence existed,
  // just the document and item read back from the markers.
  const occurrences: Occurrence[] = useMemo(
    () => evidence ?? markerOccurrences(message.content),
    [evidence, message.content],
  );
  const byId = useMemo(
    () => new Map((citations ?? []).map((c) => [c.documentId, c] as const)),
    [citations],
  );
  // The first passage a document was cited for — what its Sources chip shows.
  const firstQuote = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of evidence ?? []) {
      if (e.quote && !m.has(e.documentId)) m.set(e.documentId, e.quote);
    }
    return m;
  }, [evidence]);

  // Inline chips are rendered from HTML, so hover, focus and click are
  // delegated from the wrapper; the card is positioned from the chip's box.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ position: number; left: number; top: number } | null>(null);
  const showFor = (chip: HTMLElement) => {
    const wrap = wrapRef.current;
    const position = positionOf(chip);
    if (!wrap || position === null) return;
    const r = chip.getBoundingClientRect();
    const w = wrap.getBoundingClientRect();
    const left = Math.max(0, Math.min(r.left - w.left, w.width - CITATION_CARD_WIDTH));
    setHover({ position, left, top: r.bottom - w.top + 6 });
  };
  const onOver = (e: MouseEvent<HTMLDivElement> | FocusEvent<HTMLDivElement>) => {
    const chip = chipAt(e.target);
    if (chip) showFor(chip);
  };
  const onOut = (e: MouseEvent<HTMLDivElement> | FocusEvent<HTMLDivElement>) => {
    if (chipAt(e.target)) setHover(null);
  };
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const chip = chipAt(e.target);
    if (!chip) return;
    e.preventDefault();
    const position = positionOf(chip);
    const occurrence = position === null ? undefined : occurrences.at(position);
    if (!occurrence) return;
    openCitation({
      documentId: occurrence.documentId,
      documentType: byId.get(occurrence.documentId)?.documentType ?? null,
      anchor: occurrence.anchor,
    });
  };

  const hovered = hover ? occurrences.at(hover.position) : undefined;
  const hoveredCitation: Citation | undefined = hovered
    ? (byId.get(hovered.documentId) ?? { documentId: hovered.documentId, title: hovered.documentId })
    : undefined;

  return (
    <div className="min-w-0">
      {trail && trail.length > 0 && (
        <ChatToolTrail trail={trail} live={streaming} />
      )}
      {body ? (
        <div
          ref={wrapRef}
          className="relative"
          onMouseOver={onOver}
          onMouseOut={onOut}
          onFocus={onOver}
          onBlur={onOut}
          onClick={onClick}
        >
          <MarkdownPreview content={body} />
          {hover && hovered && hoveredCitation && (
            <CitationCard
              citation={hoveredCitation}
              anchor={hovered.anchor}
              quote={hovered.quote ?? null}
              stale={staleness(currency?.(hovered.documentId))}
              style={{ left: hover.left, top: hover.top }}
            />
          )}
        </div>
      ) : streaming ? (
        <p className="text-sm" style={{ color: "var(--bai-text-faint)" }}>
          {trail && trail.length > 0 ? "Reading…" : "Thinking…"}
        </p>
      ) : null}
      {streaming && body && (
        <span
          className="ml-0.5 inline-block h-4 w-[2px] animate-pulse align-text-bottom"
          style={{ backgroundColor: "var(--bai-accent)" }}
          aria-hidden
        />
      )}
      {/* Sources: every document the answer was generated from — the ones
          cited inline (numbered to match the [n] chips) followed by the
          ones the model read in full but did not cite. One row, no
          sub-headings: a reader wants the list, not the taxonomy. */}
      {((citations && citations.length > 0) ||
        (message.consulted && message.consulted.length > 0)) && (
        <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Sources">
          {(citations ?? []).map((c, i) => (
            <ChatCitation
              key={c.documentId}
              index={i + 1}
              citation={c}
              currency={currency?.(c.documentId)}
              quote={firstQuote.get(c.documentId) ?? null}
            />
          ))}
          {(message.consulted ?? []).map((c) => (
            <ChatCitation
              key={c.documentId}
              citation={c}
              currency={currency?.(c.documentId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
