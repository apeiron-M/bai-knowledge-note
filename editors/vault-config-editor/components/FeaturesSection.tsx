/**
 * Feature flags — TOGGLE_FEATURE.
 *
 * The chips could already turn a feature off; there was no way to turn one on,
 * so half the operation was unreachable. The field below completes the pair.
 */
import { useState } from "react";
import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import { actions } from "document-models/vault-config";
import type { VaultConfigAction } from "document-models/vault-config";
import { Card, Empty, controlClass, controlStyle } from "./ui.js";

type Dispatch = DocumentDispatch<VaultConfigAction>;

export function FeaturesSection({
  features,
  dispatch,
}: {
  features: string[];
  dispatch: Dispatch;
}) {
  const [draft, setDraft] = useState("");
  const trimmed = draft.trim();
  const duplicate = trimmed.length > 0 && features.includes(trimmed);

  function turnOn() {
    // The reducer ignores a duplicate, but clearing the field on a no-op would
    // look like it worked — screen it here so the list stays truthful.
    if (!trimmed || duplicate) return;
    dispatch(actions.toggleFeature({ feature: trimmed, enabled: true }));
    setDraft("");
  }

  return (
    <Card
      title={`Features on (${features.length})`}
      hint="Optional vault behaviour, switched on by name."
    >
      {features.length === 0 ? (
        <Empty>Nothing switched on. Name a feature below to turn it on.</Empty>
      ) : (
        <div className="flex flex-wrap gap-1">
          {features.map((f) => (
            <span
              key={f}
              className="group inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px]"
              style={{
                backgroundColor: "var(--bai-accent-soft)",
                color: "var(--bai-accent)",
              }}
            >
              {f}
              <button
                type="button"
                onClick={() =>
                  dispatch(
                    actions.toggleFeature({ feature: f, enabled: false }),
                  )
                }
                className="opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                title={`Turn off ${f}`}
                aria-label={`Turn off ${f}`}
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") turnOn();
          }}
          placeholder="Feature name"
          aria-label="Feature name"
          className={`${controlClass} flex-1`}
          style={controlStyle}
        />
        <button
          type="button"
          onClick={turnOn}
          disabled={!trimmed || duplicate}
          className="shrink-0 rounded px-2.5 py-1 text-xs font-medium disabled:opacity-40"
          style={{
            backgroundColor: "var(--bai-accent)",
            color: "var(--bai-accent-text)",
          }}
        >
          Turn on
        </button>
      </div>
      {duplicate && (
        <p
          className="mt-1 text-[10px]"
          style={{ color: "var(--bai-text-faint)" }}
        >
          {trimmed} is already on.
        </p>
      )}
    </Card>
  );
}
