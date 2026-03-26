import { useState } from "react";
import { DocumentToolbar } from "@powerhousedao/design-system/connect";
import { useSelectedVaultConfigDocument, actions } from "knowledge-note/document-models/vault-config";

const TB = "!bg-[#181825] !border-white/10 [&_button]:!bg-[#1e1e2e] [&_button]:!border-white/10 [&_button:hover]:!bg-[#313244] [&_button_svg]:!text-gray-400 [&_span]:!text-gray-400 [&_h1]:!text-gray-400";
function ts() { return new Date().toISOString(); }

const DIMENSIONS = ["granularity", "organization", "linking", "processing", "navigation", "maintenance", "schema", "automation"] as const;
const DIM_LABELS: Record<string, [string, string]> = {
  granularity: ["Atomic", "Coarse"], organization: ["Flat", "Hierarchical"],
  linking: ["Implicit", "Explicit"], processing: ["Minimal", "Intense"],
  navigation: ["Linear", "3-Tier"], maintenance: ["Manual", "Condition-based"],
  schema: ["Convention", "Dense"], automation: ["Manual", "Full"],
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
    <div className="min-h-screen bg-[#1e1e2e] text-gray-200">
      <div className="mx-auto max-w-5xl">
        <DocumentToolbar className={TB} />
        <div className="p-6 space-y-6">
          {/* Header */}
          <div className="rounded-xl bg-[#181825] p-6 ring-1 ring-white/10">
            <h1 className="text-xl font-bold text-gray-100">{state.name}</h1>
            <p className="text-sm text-gray-500 mt-1">{state.domain}</p>
            {state.updatedAt && <p className="text-[10px] text-gray-600 mt-1">Updated: {new Date(state.updatedAt).toLocaleString()}</p>}
          </div>

          {/* Dimensions */}
          {dims && (
            <div className="rounded-xl bg-[#181825] p-6 ring-1 ring-white/10">
              <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-500">8-Dimension Parameter Space</h3>
              <div className="space-y-4">
                {DIMENSIONS.map((dim) => {
                  const d = (dims as Record<string, { value?: number; confidence?: number; rationale?: string | null }>)[dim];
                  if (!d) return null;
                  const [leftLabel, rightLabel] = DIM_LABELS[dim] ?? ["Low", "High"];
                  return (
                    <div key={dim} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-gray-300 capitalize">{dim}</span>
                        <span className="text-[10px] text-gray-600">confidence: {((d.confidence ?? 0) * 100).toFixed(0)}%</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-16 text-right text-[10px] text-gray-600">{leftLabel}</span>
                        <input type="range" min="1" max="5" value={d.value ?? 3}
                          onChange={(e) => dispatch(actions.updateDimension({
                            dimension: dim, value: parseInt(e.target.value), confidence: d.confidence ?? 0.5,
                            rationale: d.rationale ?? undefined, updatedAt: ts(),
                          }))}
                          className="flex-1 accent-[#cba6f7]" />
                        <span className="w-16 text-[10px] text-gray-600">{rightLabel}</span>
                        <span className="w-6 text-center text-xs font-bold text-[#cba6f7]">{d.value ?? 3}</span>
                      </div>
                      {d.rationale && <p className="text-[10px] italic text-gray-600 pl-18">{d.rationale}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-6">
            {/* Vocabulary */}
            {vocab && (
              <div className="rounded-xl bg-[#181825] p-6 ring-1 ring-white/10">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Vocabulary</h3>
                <div className="space-y-2">
                  {Object.entries(vocab).map(([key, value]) => (
                    <label key={key} className="block text-xs">
                      <span className="text-gray-600 capitalize">{key}</span>
                      <input type="text" defaultValue={(value as string) ?? ""} placeholder={key}
                        onBlur={(e) => dispatch(actions.updateVocabulary({ key, value: e.target.value, updatedAt: ts() }))}
                        className="mt-0.5 w-full rounded border border-white/10 bg-[#11111b] px-2 py-1 text-xs text-gray-300 outline-none focus:border-[#cba6f7]/50" />
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Pipeline + Maintenance */}
            <div className="space-y-6">
              {pipeline && (
                <div className="rounded-xl bg-[#181825] p-6 ring-1 ring-white/10">
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Pipeline</h3>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between"><span className="text-gray-600">Depth</span><span className="text-gray-300">{pipeline.depth}</span></div>
                    <div className="flex justify-between"><span className="text-gray-600">Auto-chain</span><span className={pipeline.autoChain ? "text-emerald-400" : "text-gray-500"}>{pipeline.autoChain ? "Yes" : "No"}</span></div>
                    <div className="flex justify-between"><span className="text-gray-600">Selectivity</span><span className="text-gray-300">{pipeline.extractionSelectivity}</span></div>
                  </div>
                </div>
              )}

              {maint && (
                <div className="rounded-xl bg-[#181825] p-6 ring-1 ring-white/10">
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Maintenance Thresholds</h3>
                  <div className="space-y-2 text-xs">
                    {Object.entries(maint).map(([key, value]) => (
                      <div key={key} className="flex justify-between">
                        <span className="text-gray-600 capitalize">{key.replace(/([A-Z])/g, " $1").trim()}</span>
                        <span className="text-gray-300">{value as number}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Features */}
              <div className="rounded-xl bg-[#181825] p-6 ring-1 ring-white/10">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Features ({(state.features ?? []).length})</h3>
                <div className="flex flex-wrap gap-1">
                  {(state.features ?? []).map((f) => (
                    <span key={f} className="group inline-flex items-center gap-1 rounded-full bg-[#cba6f7]/10 px-2 py-0.5 text-[10px] text-[#cba6f7]">
                      {f}
                      <button type="button" onClick={() => dispatch(actions.toggleFeature({ feature: f, enabled: false }))}
                        className="opacity-0 hover:text-red-400 group-hover:opacity-100">&times;</button>
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

function InitForm({ dispatch }: { dispatch: (action: ReturnType<typeof actions.initializeConfig>) => void }) {
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  return (
    <div className="min-h-screen bg-[#1e1e2e] text-gray-200">
      <div className="mx-auto max-w-2xl">
        <DocumentToolbar className={TB} />
        <div className="p-6">
          <div className="rounded-xl bg-[#181825] p-8 ring-1 ring-white/10 space-y-4">
            <h2 className="text-lg font-bold text-gray-100">Initialize Vault Configuration</h2>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Vault name"
              className="w-full rounded-lg border border-white/10 bg-[#1e1e2e] px-3 py-2 text-sm text-gray-300 outline-none focus:border-[#cba6f7]/50" />
            <input type="text" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="Domain description"
              className="w-full rounded-lg border border-white/10 bg-[#1e1e2e] px-3 py-2 text-sm text-gray-300 outline-none focus:border-[#cba6f7]/50" />
            <button type="button" disabled={!name.trim() || !domain.trim()}
              onClick={() => dispatch(actions.initializeConfig({ name, domain, updatedAt: ts() }))}
              className="rounded-lg bg-[#cba6f7] px-4 py-2 text-sm font-medium text-[#1e1e2e] hover:bg-[#cba6f7]/80 disabled:opacity-40">
              Initialize
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
