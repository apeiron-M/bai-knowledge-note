import { OP_DESCRIPTIONS } from "../chat/core/op-descriptions.js";
import { readableOpName } from "../chat/core/op-scorer.js";
import type { ContextTarget, DocumentTarget } from "../chat/context/context-frame.js";
import { documentTypeName } from "../chat/core/target-document.js";
import type { PendingChoice } from "../hooks/use-chat-llm.js";
import type { ChatCard } from "../hooks/use-chat-session.js";
import { CardTarget } from "./ChatTargetTag.js";

/** One button on a choice card. */
export interface ChoiceOption {
  key: string;
  label: string;
  /** After the label, muted: "47%", "MOC". */
  meta?: string;
  detail?: string;
}

interface ChatChoiceCardProps {
  heading: string;
  hint: string;
  options: ChoiceOption[];
  noneLabel: string;
  card: ChatCard;
  viewing: ContextTarget;
  /** Show the card's own target ("On: ..."); off when the choice is the target. */
  showTarget?: boolean;
  busy: boolean;
  onChoose: (index: number) => void;
  onNone: () => void;
}

function sentenceCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The margin gate asked (fused p1 - p2 < tau): the fused top 3. */
export function opChoiceOptions(choice: PendingChoice): ChoiceOption[] {
  return choice.options.map(({ entry, p }) => ({
    key: entry.key,
    label: sentenceCase(readableOpName(entry.opName)),
    meta: `${Math.round(p * 100)}%`,
    detail: OP_DESCRIPTIONS[entry.key] ?? entry.description,
  }));
}

/** The request points at the open document and names another: which to change. */
export function targetChoiceOptions(open: DocumentTarget, named: DocumentTarget): ChoiceOption[] {
  return [
    { target: open, detail: "The document you are viewing." },
    { target: named, detail: "Named in the request." },
  ].map(({ target, detail }) => ({
    key: target.id,
    label: `Change ${target.title}`,
    meta: documentTypeName(target.docType),
    detail,
  }));
}

/**
 * A choice before anything is proposed: which change (the margin gate's
 * top 3) or which document (the request points at the open document and
 * names another). Choosing an option goes on to the proposal; "none"
 * dispatches nothing.
 */
export function ChatChoiceCard({
  heading,
  hint,
  options,
  noneLabel,
  card,
  viewing,
  showTarget = true,
  busy,
  onChoose,
  onNone,
}: ChatChoiceCardProps) {
  return (
    <div
      data-testid="chat-choice"
      role="group"
      aria-labelledby="chat-choice-heading"
      className="rounded-md p-3 text-xs"
      style={{
        border: "1px solid var(--bai-border)",
        backgroundColor: "var(--bai-surface)",
      }}
    >
      <div
        id="chat-choice-heading"
        className="mb-1 text-sm font-semibold"
        style={{ color: "var(--bai-accent)" }}
      >
        {heading}
      </div>
      {showTarget && <CardTarget card={card} viewing={viewing} />}
      <div className="mb-2" style={{ color: "var(--bai-text-muted)" }}>
        {hint}
      </div>
      <div className="flex flex-col gap-2">
        {options.map(({ key, label, meta, detail }, i) => (
          <button
            key={key}
            type="button"
            data-testid={`chat-choice-option-${i}`}
            disabled={busy}
            onClick={() => onChoose(i)}
            className="rounded-md px-3 py-2 text-left disabled:opacity-50"
            style={{
              border: "1px solid var(--bai-border)",
              color: "var(--bai-text-secondary)",
            }}
          >
            <span className="font-medium" style={{ color: "var(--bai-text)" }}>
              {label}
            </span>
            {meta && <span style={{ color: "var(--bai-text-muted)" }}> · {meta}</span>}
            {detail && (
              <span className="mt-0.5 block" style={{ color: "var(--bai-text-muted)" }}>
                {detail}
              </span>
            )}
          </button>
        ))}
        <button
          type="button"
          data-testid="chat-choice-none"
          disabled={busy}
          onClick={onNone}
          className="rounded-md px-3 py-1 text-left disabled:opacity-50"
          style={{
            border: "1px solid var(--bai-border)",
            color: "var(--bai-text-tertiary)",
          }}
        >
          {noneLabel}
        </button>
      </div>
    </div>
  );
}
