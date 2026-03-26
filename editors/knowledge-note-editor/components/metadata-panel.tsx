import { useState } from "react";
import type { KnowledgeNoteState } from "../../../document-models/knowledge-note/v1/gen/schema/types.js";

type MetadataPanelProps = {
  state: KnowledgeNoteState;
  onSetField: (field: string, value: string | null) => void;
  onSetListField: (field: string, values: string[]) => void;
};

const STRING_FIELDS = [
  { key: "scope", label: "Scope", placeholder: "e.g. global, team, personal" },
  { key: "confidence", label: "Confidence", placeholder: "e.g. high, medium, low" },
  { key: "severity", label: "Severity", placeholder: "e.g. critical, warning, info" },
  { key: "context", label: "Context", placeholder: "e.g. onboarding, deployment" },
  { key: "model", label: "Model", placeholder: "e.g. reducer, hook, component" },
  { key: "modelId", label: "Model ID", placeholder: "e.g. bai/knowledge-note" },
  { key: "version", label: "Version", placeholder: "e.g. v0.1, 1.2.0" },
  { key: "filePath", label: "File Path", placeholder: "e.g. src/reducers/content.ts" },
  { key: "editor", label: "Editor", placeholder: "Who last edited this note" },
  { key: "decisionStatus", label: "Decision Status", placeholder: "e.g. proposed, accepted, rejected" },
  { key: "sourceType", label: "Source Type", placeholder: "e.g. API, hook, event" },
  { key: "targetType", label: "Target Type", placeholder: "e.g. component, service" },
  { key: "relationType", label: "Relation Type", placeholder: "e.g. depends-on, extends" },
  { key: "cardinality", label: "Cardinality", placeholder: "e.g. one-to-many, many-to-many" },
  { key: "computes", label: "Computes", placeholder: "What this note derives" },
  { key: "errorMessage", label: "Error Message", placeholder: "Error text if applicable" },
  { key: "rootCause", label: "Root Cause", placeholder: "Underlying cause of an issue" },
  { key: "correctPattern", label: "Correct Pattern", placeholder: "The right way to do it" },
] as const;

const LIST_FIELDS = [
  { key: "models", label: "Models", placeholder: "Add model..." },
  { key: "modules", label: "Modules", placeholder: "Add module..." },
  { key: "hooksUsed", label: "Hooks Used", placeholder: "Add hook..." },
  { key: "dispatchTargets", label: "Dispatch Targets", placeholder: "Add target..." },
  { key: "inputs", label: "Inputs", placeholder: "Add input..." },
  { key: "outputs", label: "Outputs", placeholder: "Add output..." },
  { key: "consumedBy", label: "Consumed By", placeholder: "Add consumer..." },
  { key: "alternatives", label: "Alternatives", placeholder: "Add alternative..." },
  { key: "consequences", label: "Consequences", placeholder: "Add consequence..." },
] as const;

export function MetadataPanel({ state, onSetField, onSetListField }: MetadataPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const populatedStringFields = STRING_FIELDS.filter((f) => (state as Record<string, unknown>)[f.key] != null);
  const populatedListFields = LIST_FIELDS.filter((f) => { const v = (state as Record<string, unknown>)[f.key]; return Array.isArray(v) && v.length > 0; });
  const hasAnyMetadata = populatedStringFields.length > 0 || populatedListFields.length > 0;

  return (
    <div>
      <button type="button" onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wider text-gray-500">
        <span>Metadata{hasAnyMetadata && <span className="font-normal text-gray-600"> ({populatedStringFields.length + populatedListFields.length})</span>}</span>
        <span className="text-gray-600">{expanded ? "\u25B2" : "\u25BC"}</span>
      </button>
      {expanded && (
        <div className="mt-3 space-y-3">
          <div className="space-y-2">
            {STRING_FIELDS.map((f) => (
              <MetadataStringField key={f.key} label={f.label} placeholder={f.placeholder}
                value={(state as Record<string, unknown>)[f.key] as string | null}
                onChange={(v) => onSetField(f.key, v)} />
            ))}
          </div>
          <hr className="border-white/10" />
          <div className="space-y-2">
            {LIST_FIELDS.map((f) => (
              <MetadataListField key={f.key} label={f.label} placeholder={f.placeholder}
                values={((state as Record<string, unknown>)[f.key] as string[] | undefined) ?? []}
                onChange={(v) => onSetListField(f.key, v)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MetadataStringField({ label, value, placeholder, onChange }: { label: string; value: string | null; placeholder: string; onChange: (value: string | null) => void }) {
  return (
    <label className="block text-xs">
      <span className="mb-0.5 block text-gray-600">{label}</span>
      <input type="text" defaultValue={value ?? ""} placeholder={placeholder}
        onBlur={(e) => onChange(e.target.value || null)}
        className="w-full rounded border border-white/10 bg-[#11111b] px-2 py-1 text-xs text-gray-300 outline-none placeholder:text-gray-700 focus:border-[#cba6f7]/50" />
    </label>
  );
}

function MetadataListField({ label, values, placeholder, onChange }: { label: string; values: string[]; placeholder: string; onChange: (values: string[]) => void }) {
  const [input, setInput] = useState("");
  function handleAdd() { const t = input.trim(); if (!t) return; onChange([...values, t]); setInput(""); }
  function handleRemove(index: number) { onChange(values.filter((_, i) => i !== index)); }

  return (
    <div className="text-xs">
      <span className="text-gray-600">{label}</span>
      <div className="mt-1 flex flex-wrap gap-1">
        {values.map((v, i) => (
          <span key={`${v}-${i}`} className="group inline-flex items-center gap-0.5 rounded bg-[#313244] px-1.5 py-0.5 text-gray-400">
            {v}
            <button type="button" onClick={() => handleRemove(i)}
              className="text-gray-600 opacity-0 hover:text-red-400 group-hover:opacity-100">&times;</button>
          </span>
        ))}
        <form className="inline-flex" onSubmit={(e) => { e.preventDefault(); handleAdd(); }}>
          <input type="text" value={input} onChange={(e) => setInput(e.target.value)} placeholder={placeholder}
            className="w-28 rounded border border-dashed border-white/10 bg-transparent px-1.5 py-0.5 text-xs text-gray-400 outline-none placeholder:text-gray-700 focus:border-[#cba6f7]/40" />
        </form>
      </div>
    </div>
  );
}
