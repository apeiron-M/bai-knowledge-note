import { useState } from "react";
import { DocumentToolbar } from "@powerhousedao/design-system/connect";
import {
  useSelectedVaultConfigDocument,
  actions,
} from "knowledge-note/document-models/vault-config";
import { TOOLBAR_CLASS } from "../shared/theme-context.js";

function ts() {
  return new Date().toISOString();
}

const DIMENSIONS = [
  "granularity",
  "organization",
  "linking",
  "processing",
  "navigation",
  "maintenance",
  "schema",
  "automation",
] as const;
const DIM_LABELS: Record<string, [string, string]> = {
  granularity: ["Atomic", "Coarse"],
  organization: ["Flat", "Hierarchical"],
  linking: ["Implicit", "Explicit"],
  processing: ["Minimal", "Intense"],
  navigation: ["Linear", "3-Tier"],
  maintenance: ["Manual", "Condition-based"],
  schema: ["Convention", "Dense"],
  automation: ["Manual", "Full"],
};

export default function Editor() {
  const [document, dispatch] = useSelectedVaultConfigDocument();
  const state = document.state.global;
  const initialized = !!state.name;

  if (!initialized) {
    return <InitForm dispatch={dispatch} />;
  }

  const dims = state.dimensions;
  const vocab = state.vocabulary;
  const maint = state.maintenance;
  const pipeline = state.pipeline;

  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: "var(--bai-bg)", color: "var(--bai-text)" }}
    >
      <div className="mx-auto max-w-5xl">
        <DocumentToolbar className={TOOLBAR_CLASS} />
        <div className="p-6 space-y-6">
          {/* Header */}
          <div
            className="rounded-xl p-6"
            style={{
              backgroundColor: "var(--bai-surface)",
              border: "1px solid var(--bai-border)",
            }}
          >
            <input
              type="text"
              defaultValue={state.name ?? ""}
              placeholder="Vault name"
              onBlur={(e) => {
                const val = e.target.value.trim();
                if (val && val !== state.name)
                  dispatch(
                    actions.initializeConfig({
                      name: val,
                      domain: state.domain ?? "",
                      updatedAt: ts(),
                    }),
                  );
              }}
              className="w-full border-0 bg-transparent text-xl font-bold outline-none"
              style={{ color: "var(--bai-text)" }}
            />
            <input
              type="text"
              defaultValue={state.domain ?? ""}
              placeholder="Domain description"
              onBlur={(e) => {
                const val = e.target.value.trim();
                if (val && val !== state.domain)
                  dispatch(
                    actions.initializeConfig({
                      name: state.name ?? "",
                      domain: val,
                      updatedAt: ts(),
                    }),
                  );
              }}
              className="mt-1 w-full border-0 bg-transparent text-sm outline-none"
              style={{ color: "var(--bai-text-muted)" }}
            />
            {state.updatedAt && (
              <p
                className="text-[10px] mt-1"
                style={{ color: "var(--bai-text-faint)" }}
              >
                Updated: {new Date(state.updatedAt).toLocaleString()}
              </p>
            )}
          </div>

          {/* Dimensions */}
          {dims && (
            <div
              className="rounded-xl p-6"
              style={{
                backgroundColor: "var(--bai-surface)",
                border: "1px solid var(--bai-border)",
              }}
            >
              <h3
                className="mb-4 text-xs font-semibold uppercase tracking-wider"
                style={{ color: "var(--bai-text-muted)" }}
              >
                8-Dimension Parameter Space
              </h3>
              <div className="space-y-4">
                {DIMENSIONS.map((dim) => {
                  const d = (
                    dims as Record<
                      string,
                      {
                        value?: number;
                        confidence?: number;
                        rationale?: string | null;
                      }
                    >
                  )[dim];
                  if (!d) return null;
                  const [leftLabel, rightLabel] = DIM_LABELS[dim] ?? [
                    "Low",
                    "High",
                  ];
                  return (
                    <div key={dim} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span
                          className="text-xs font-medium capitalize"
                          style={{ color: "var(--bai-text-secondary)" }}
                        >
                          {dim}
                        </span>
                        <span
                          className="text-[10px]"
                          style={{ color: "var(--bai-text-faint)" }}
                        >
                          confidence: {((d.confidence ?? 0) * 100).toFixed(0)}%
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className="w-16 text-right text-[10px]"
                          style={{ color: "var(--bai-text-faint)" }}
                        >
                          {leftLabel}
                        </span>
                        <input
                          type="range"
                          min="1"
                          max="5"
                          value={d.value ?? 3}
                          onChange={(e) =>
                            dispatch(
                              actions.updateDimension({
                                dimension: dim,
                                value: parseInt(e.target.value),
                                confidence: d.confidence ?? 0.5,
                                rationale: d.rationale ?? undefined,
                                updatedAt: ts(),
                              }),
                            )
                          }
                          className="flex-1 accent-[#cba6f7]"
                        />
                        <span
                          className="w-16 text-[10px]"
                          style={{ color: "var(--bai-text-faint)" }}
                        >
                          {rightLabel}
                        </span>
                        <span
                          className="w-6 text-center text-xs font-bold"
                          style={{ color: "var(--bai-accent)" }}
                        >
                          {d.value ?? 3}
                        </span>
                      </div>
                      {d.rationale && (
                        <p
                          className="text-[10px] italic pl-18"
                          style={{ color: "var(--bai-text-faint)" }}
                        >
                          {d.rationale}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-6">
            {/* Vocabulary */}
            {vocab && (
              <div
                className="rounded-xl p-6"
                style={{
                  backgroundColor: "var(--bai-surface)",
                  border: "1px solid var(--bai-border)",
                }}
              >
                <h3
                  className="mb-3 text-xs font-semibold uppercase tracking-wider"
                  style={{ color: "var(--bai-text-muted)" }}
                >
                  Vocabulary
                </h3>
                <div className="space-y-2">
                  {Object.entries(vocab).map(([key, value]) => (
                    <label key={key} className="block text-xs">
                      <span
                        className="capitalize"
                        style={{ color: "var(--bai-text-faint)" }}
                      >
                        {key}
                      </span>
                      <input
                        type="text"
                        defaultValue={value ?? ""}
                        placeholder={key}
                        onBlur={(e) =>
                          dispatch(
                            actions.updateVocabulary({
                              key,
                              value: e.target.value,
                              updatedAt: ts(),
                            }),
                          )
                        }
                        className="mt-0.5 w-full rounded px-2 py-1 text-xs outline-none focus:border-[#cba6f7]/50"
                        style={{
                          backgroundColor: "var(--bai-deep)",
                          color: "var(--bai-text-secondary)",
                          border: "1px solid var(--bai-border)",
                        }}
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Pipeline + Maintenance */}
            <div className="space-y-6">
              {pipeline && (
                <div
                  className="rounded-xl p-6"
                  style={{
                    backgroundColor: "var(--bai-surface)",
                    border: "1px solid var(--bai-border)",
                  }}
                >
                  <h3
                    className="mb-3 text-xs font-semibold uppercase tracking-wider"
                    style={{ color: "var(--bai-text-muted)" }}
                  >
                    Pipeline
                  </h3>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span style={{ color: "var(--bai-text-faint)" }}>
                        Depth
                      </span>
                      <span style={{ color: "var(--bai-text-secondary)" }}>
                        {pipeline.depth}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: "var(--bai-text-faint)" }}>
                        Auto-chain
                      </span>
                      <span
                        className={pipeline.autoChain ? "text-emerald-400" : ""}
                        style={
                          pipeline.autoChain
                            ? undefined
                            : { color: "var(--bai-text-muted)" }
                        }
                      >
                        {pipeline.autoChain ? "Yes" : "No"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: "var(--bai-text-faint)" }}>
                        Selectivity
                      </span>
                      <span style={{ color: "var(--bai-text-secondary)" }}>
                        {pipeline.extractionSelectivity}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {maint && (
                <div
                  className="rounded-xl p-6"
                  style={{
                    backgroundColor: "var(--bai-surface)",
                    border: "1px solid var(--bai-border)",
                  }}
                >
                  <h3
                    className="mb-3 text-xs font-semibold uppercase tracking-wider"
                    style={{ color: "var(--bai-text-muted)" }}
                  >
                    Maintenance Thresholds
                  </h3>
                  <div className="space-y-2 text-xs">
                    {Object.entries(maint).map(([key, value]) => (
                      <div key={key} className="flex justify-between">
                        <span
                          className="capitalize"
                          style={{ color: "var(--bai-text-faint)" }}
                        >
                          {key.replace(/([A-Z])/g, " $1").trim()}
                        </span>
                        <span style={{ color: "var(--bai-text-secondary)" }}>
                          {value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Features */}
              <div
                className="rounded-xl p-6"
                style={{
                  backgroundColor: "var(--bai-surface)",
                  border: "1px solid var(--bai-border)",
                }}
              >
                <h3
                  className="mb-3 text-xs font-semibold uppercase tracking-wider"
                  style={{ color: "var(--bai-text-muted)" }}
                >
                  Features ({(state.features ?? []).length})
                </h3>
                <div className="flex flex-wrap gap-1">
                  {(state.features ?? []).map((f) => (
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
                            actions.toggleFeature({
                              feature: f,
                              enabled: false,
                            }),
                          )
                        }
                        className="opacity-0 hover:text-red-400 group-hover:opacity-100"
                      >
                        &times;
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InitForm({
  dispatch,
}: {
  dispatch: (action: ReturnType<typeof actions.initializeConfig>) => void;
}) {
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: "var(--bai-bg)", color: "var(--bai-text)" }}
    >
      <div className="mx-auto max-w-2xl">
        <DocumentToolbar className={TOOLBAR_CLASS} />
        <div className="p-6">
          <div
            className="rounded-xl p-8 space-y-4"
            style={{
              backgroundColor: "var(--bai-surface)",
              border: "1px solid var(--bai-border)",
            }}
          >
            <h2
              className="text-lg font-bold"
              style={{ color: "var(--bai-text)" }}
            >
              Initialize Vault Configuration
            </h2>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Vault name"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:border-[#cba6f7]/50"
              style={{
                backgroundColor: "var(--bai-bg)",
                color: "var(--bai-text-secondary)",
                border: "1px solid var(--bai-border)",
              }}
            />
            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="Domain description"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:border-[#cba6f7]/50"
              style={{
                backgroundColor: "var(--bai-bg)",
                color: "var(--bai-text-secondary)",
                border: "1px solid var(--bai-border)",
              }}
            />
            <button
              type="button"
              disabled={!name.trim() || !domain.trim()}
              onClick={() =>
                dispatch(
                  actions.initializeConfig({ name, domain, updatedAt: ts() }),
                )
              }
              className="rounded-lg px-4 py-2 text-sm font-medium hover:opacity-80 disabled:opacity-40"
              style={{
                backgroundColor: "var(--bai-accent)",
                color: "var(--bai-accent-text)",
              }}
            >
              Initialize
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
