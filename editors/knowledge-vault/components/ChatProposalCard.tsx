import { dateRuleNote } from "../chat/core/date-resolve.js";
import { readableOpName } from "../chat/core/op-scorer.js";
import type { ContextTarget } from "../chat/context/context-frame.js";
import type { ProposedAction, Provenance } from "../hooks/use-chat-llm.js";
import type { ChatCard } from "../hooks/use-chat-session.js";
import { CardTarget } from "./ChatTargetTag.js";

interface ChatProposalCardProps {
  proposal: ProposedAction;
  /** The card's own target (fixed at creation) and the tag's current one. */
  card: ChatCard;
  viewing: ContextTarget;
  dispatching: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function sentenceCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function show(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

/** The args the model filled, with ref ids shown with their labels. */
function argRows(p: ProposedAction): [string, string][] {
  const args = p.step2.args ?? {};
  return Object.entries(args).map(([k, v]) => {
    const cands = Object.entries(p.refs).find(([path]) => path === k)?.[1];
    if (!cands) return [k, show(v)];
    const label = (id: unknown) => {
      const c = cands.find((x) => x.id === id);
      return c?.label ? `${c.label} (${show(id)})` : show(id);
    };
    return [k, Array.isArray(v) ? v.map(label).join(", ") : label(v)];
  });
}

function provenanceText(p: Provenance): string {
  switch (p.kind) {
    case "fused":
      return `Chosen by X5 × Kev-FT (p ${p.p.toFixed(2)})`;
    case "chosen":
      return `You chose this from ${p.from} options`;
    case "lora-alone":
      return `Chosen by the LoRA alone (decision model ${p.reason})`;
  }
}

const ms = (x: number | null | undefined) =>
  x === null || x === undefined ? "–" : `${Math.round(x)} ms`;

export function ChatProposalCard({
  proposal,
  card,
  viewing,
  dispatching,
  onConfirm,
  onCancel,
}: ChatProposalCardProps) {
  const { entry, step2, decision, action, error } = proposal;
  const { step1, timings, trie } = decision;
  const rows = argRows(proposal);
  return (
    <div
      data-testid="chat-proposal"
      className="rounded-md p-3 text-xs"
      style={{
        border: "1px solid var(--bai-border)",
        backgroundColor: "var(--bai-surface)",
      }}
    >
      <div
        className="mb-1 text-sm font-semibold"
        style={{ color: "var(--bai-accent)" }}
      >
        {sentenceCase(readableOpName(entry.opName))}
      </div>
      <CardTarget card={card} viewing={viewing} />
      <div className="mb-2" style={{ color: "var(--bai-text-muted)" }}>
        <code>{entry.opName}</code>
        {` · picked from ${step1.candidates.length} operations`}
      </div>
      <div
        data-testid="chat-proposal-provenance"
        className="mb-2"
        style={{ color: "var(--bai-text-muted)" }}
      >
        {provenanceText(proposal.provenance)}
      </div>
      {entry.description && (
        <div className="mb-2" style={{ color: "var(--bai-text-muted)" }}>
          {entry.description}
        </div>
      )}
      {rows.length > 0 ? (
        <table className="mb-2 w-full">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <td
                  className="pr-3 align-top"
                  style={{ color: "var(--bai-text-muted)" }}
                >
                  {k}
                </td>
                <td
                  className="whitespace-pre-wrap"
                  style={{ color: "var(--bai-text-secondary)" }}
                >
                  {v}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="mb-2" style={{ color: "var(--bai-text-muted)" }}>
          No arguments to fill.
        </div>
      )}
      {step2.dateFixed && (
        <div
          data-testid="chat-proposal-date-note"
          className="mb-2"
          style={{ color: "var(--bai-text-muted)" }}
        >
          {dateRuleNote(proposal.utterance, step2.dateFixed)}
        </div>
      )}
      <details className="mb-2" style={{ color: "var(--bai-text-muted)" }}>
        <summary className="cursor-pointer">Action input</summary>
        <pre
          className="mt-1 overflow-auto rounded p-2"
          style={{
            backgroundColor: "var(--bai-hover)",
            color: "var(--bai-text-secondary)",
          }}
        >
          {JSON.stringify(action?.input ?? step2.args, null, 2)}
        </pre>
      </details>
      <details className="mb-2" style={{ color: "var(--bai-text-muted)" }}>
        <summary className="cursor-pointer">Details</summary>
        <div className="mt-1" data-testid="chat-proposal-timings">
          Choosing {ms(timings.step1Ms)} · decision model {ms(timings.kevMs)} · scoring{" "}
          {ms(timings.trieMs)}
          {trie && ` (${trie.requests} requests)`} · arguments {ms(proposal.fillMs)}
          {decision.config === "C" && decision.margin !== null &&
            ` · fused margin ${decision.margin.toFixed(2)}`}
        </div>
      </details>
      {error && (
        <div className="mb-2" style={{ color: "#ef4444" }}>
          Can't build this action: {error}
        </div>
      )}
      <div className="mb-2" style={{ color: "#d97706" }}>
        Local model, may be wrong: check before confirming.
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!action || dispatching}
          onClick={onConfirm}
          className="rounded-md px-3 py-1 font-medium disabled:opacity-50"
          style={{
            backgroundColor: "var(--bai-accent)",
            color: "var(--bai-accent-text)",
          }}
        >
          {dispatching ? "Dispatching..." : "Confirm"}
        </button>
        <button
          type="button"
          disabled={dispatching}
          onClick={onCancel}
          className="rounded-md px-3 py-1"
          style={{
            border: "1px solid var(--bai-border)",
            color: "var(--bai-text-tertiary)",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
