import {
  cardTargetNotice,
  type PendingCard,
} from "../chat/context/chat-session.js";
import type { ContextTarget } from "../chat/context/context-frame.js";
import { documentTypeName } from "../chat/core/target-document.js";

/**
 * The always-visible target tag: what the chat acts on right now. It reads
 * only the frame's target, so it follows navigation live.
 */
export function ChatTargetTag({ target }: { target: ContextTarget }) {
  const doc = target.kind === "document";
  return (
    <span
      data-testid="chat-target-tag"
      data-target-id={target.id}
      data-target-kind={target.kind}
      title={doc ? `The chat acts on ${target.title}` : "No document open: drive level"}
      className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
      style={{
        border: "1px solid var(--bai-border)",
        backgroundColor: "var(--bai-hover)",
        color: "var(--bai-text-secondary)",
      }}
    >
      <span style={{ color: "var(--bai-text-muted)" }}>{doc ? "Acting on:" : "Drive:"}</span>
      <strong className="truncate" style={{ color: "var(--bai-text)" }}>
        {doc ? target.title : target.name}
      </strong>
      <span className="shrink-0" style={{ color: "var(--bai-text-muted)" }}>
        ({doc ? documentTypeName(target.docType) : "drive"})
      </span>
    </span>
  );
}

/** "CRDTs (MOC)", or "Vault (drive)". */
export function targetLabel(t: ContextTarget): string {
  return t.kind === "document"
    ? `${t.title} (${documentTypeName(t.docType)})`
    : `${t.name} (drive)`;
}

/**
 * A card's own target, which never follows the tag: "On: A (MOC)", with
 * the retarget highlighted and a note once the user has moved elsewhere.
 */
export function CardTarget<P>({
  card,
  viewing,
}: {
  card: Pick<PendingCard<P>, "target" | "retargetedFrom">;
  viewing: ContextTarget;
}) {
  const notice = cardTargetNotice(card, viewing);
  return (
    <div className="mb-2 flex flex-col gap-1">
      <div data-testid="chat-card-target" data-target-id={card.target.id}>
        <span style={{ color: "var(--bai-text-muted)" }}>On: </span>
        <strong style={{ color: "var(--bai-text)" }}>{card.target.title}</strong>
        <span style={{ color: "var(--bai-text-muted)" }}>
          {" "}
          ({documentTypeName(card.target.docType)})
        </span>
      </div>
      {notice.switchedFrom && (
        <div
          data-testid="chat-card-retarget"
          className="rounded px-2 py-1"
          style={{
            border: "1px solid #d97706",
            backgroundColor: "rgba(217, 119, 6, 0.12)",
            color: "var(--bai-text-secondary)",
          }}
        >
          Switched target: the request names <strong>{card.target.title}</strong>, so this
          changes it, not the document you were viewing, {targetLabel(notice.switchedFrom)}.
        </div>
      )}
      {notice.nowViewing && (
        <div data-testid="chat-card-elsewhere" style={{ color: "#d97706" }}>
          You are now viewing {targetLabel(notice.nowViewing)}. Confirm still changes{" "}
          {card.target.title}.
        </div>
      )}
    </div>
  );
}
