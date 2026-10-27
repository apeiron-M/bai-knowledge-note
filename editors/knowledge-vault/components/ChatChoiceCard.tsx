import { OP_DESCRIPTIONS } from "../chat/core/op-descriptions.js";
import { readableOpName } from "../chat/core/op-scorer.js";
import type { ContextTarget } from "../chat/context/context-frame.js";
import type { PendingChoice } from "../hooks/use-chat-llm.js";
import type { ChatCard } from "../hooks/use-chat-session.js";
import { CardTarget } from "./ChatTargetTag.js";

interface ChatChoiceCardProps {
  choice: PendingChoice;
  card: ChatCard;
  viewing: ContextTarget;
  busy: boolean;
  onChoose: (index: number) => void;
  onNone: () => void;
}

function sentenceCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The margin gate asked (fused p1 - p2 < tau): the fused top 3 and "None of
 * these". Choosing an option fills its arguments and shows the proposal;
 * "None of these" dispatches nothing.
 */
export function ChatChoiceCard({
  choice,
  card,
  viewing,
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
        Which change did you mean?
      </div>
      <CardTarget card={card} viewing={viewing} />
      <div className="mb-2" style={{ color: "var(--bai-text-muted)" }}>
        The models were not sure enough to pick one.
      </div>
      <div className="flex flex-col gap-2">
        {choice.options.map(({ entry, p }, i) => (
          <button
            key={entry.key}
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
              {sentenceCase(readableOpName(entry.opName))}
            </span>
            <span style={{ color: "var(--bai-text-muted)" }}> · {Math.round(p * 100)}%</span>
            <span className="mt-0.5 block" style={{ color: "var(--bai-text-muted)" }}>
              {OP_DESCRIPTIONS[entry.key] ?? entry.description}
            </span>
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
          None of these
        </button>
      </div>
    </div>
  );
}
