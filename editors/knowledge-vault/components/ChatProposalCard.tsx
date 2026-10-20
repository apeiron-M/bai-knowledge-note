import type { ProposedAction } from "../hooks/use-chat-llm.js";

interface ChatProposalCardProps {
  proposal: ProposedAction;
  targetTitle: string;
  dispatching: boolean;
  onConfirm: () => void;
  onDiscard: () => void;
}

export function ChatProposalCard({
  proposal,
  targetTitle,
  dispatching,
  onConfirm,
  onDiscard,
}: ChatProposalCardProps) {
  const { entry, generation, action, error } = proposal;
  return (
    <div
      className="rounded-md p-3 text-xs"
      style={{
        border: "1px solid var(--bai-border)",
        backgroundColor: "var(--bai-surface)",
      }}
    >
      <div
        className="mb-1 font-semibold"
        style={{ color: "var(--bai-accent)" }}
      >
        Proposed action: {entry.opName}
      </div>
      <div className="mb-2" style={{ color: "var(--bai-text-muted)" }}>
        {entry.description} &middot; target: {targetTitle}
      </div>
      <pre
        className="mb-2 overflow-auto rounded p-2"
        style={{
          backgroundColor: "var(--bai-hover)",
          color: "var(--bai-text-secondary)",
        }}
      >
        {JSON.stringify(action?.input ?? generation.args, null, 2)}
      </pre>
      {error && (
        <div className="mb-2" style={{ color: "#ef4444" }}>
          {error}
        </div>
      )}
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
          onClick={onDiscard}
          className="rounded-md px-3 py-1"
          style={{ color: "var(--bai-text-tertiary)" }}
        >
          Discard
        </button>
      </div>
    </div>
  );
}
