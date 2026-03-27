import { useState } from "react";
import type {
  Provenance,
  SourceOrigin,
} from "../../../document-models/knowledge-note/v1/gen/schema/types.js";

type ProvenanceInfoProps = {
  provenance: Provenance | null;
  onSetProvenance: (author: string, sourceOrigin: SourceOrigin) => void;
};

const SOURCE_OPTIONS: { value: SourceOrigin; label: string }[] = [
  { value: "MANUAL", label: "Manual" },
  { value: "SESSION_MINE", label: "Session Mine" },
  { value: "IMPORT", label: "Import" },
  { value: "DERIVED", label: "Derived" },
];
const SOURCE_LABELS: Record<SourceOrigin, string> = {
  MANUAL: "Manual",
  SESSION_MINE: "Session Mine",
  IMPORT: "Import",
  DERIVED: "Derived",
};

export function ProvenanceInfo({
  provenance,
  onSetProvenance,
}: ProvenanceInfoProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [author, setAuthor] = useState("");
  const [sourceOrigin, setSourceOrigin] = useState<SourceOrigin>("MANUAL");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = author.trim();
    if (!trimmed) return;
    onSetProvenance(trimmed, sourceOrigin);
    setIsEditing(false);
    setAuthor("");
  }

  if (!provenance && !isEditing) {
    return (
      <div className="rounded-lg border border-dashed border-white/10 p-3 text-center">
        <p className="mb-2 text-xs text-gray-500">No provenance set</p>
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className="text-xs font-medium text-[#cba6f7] hover:text-[#cba6f7]/80"
        >
          Set provenance
        </button>
      </div>
    );
  }

  if (isEditing) {
    return (
      <form
        onSubmit={handleSubmit}
        className="space-y-2 rounded-lg border border-[#cba6f7]/20 bg-[#cba6f7]/5 p-3"
      >
        <label className="block text-xs">
          <span className="text-gray-500">Author</span>
          <input
            type="text"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="Author name..."
            autoFocus
            className="mt-1 w-full rounded border border-white/10 bg-[#1e1e2e] px-2 py-1.5 text-xs text-gray-300 outline-none focus:border-[#cba6f7]/50"
          />
        </label>
        <label className="block text-xs">
          <span className="text-gray-500">Source origin</span>
          <select
            value={sourceOrigin}
            onChange={(e) => setSourceOrigin(e.target.value as SourceOrigin)}
            className="mt-1 w-full rounded border border-white/10 bg-[#1e1e2e] px-2 py-1.5 text-xs text-gray-300 outline-none focus:border-[#cba6f7]/50"
          >
            {SOURCE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => setIsEditing(false)}
            className="rounded px-2.5 py-1 text-xs text-gray-500 hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded bg-[#cba6f7] px-2.5 py-1 text-xs font-medium text-[#1e1e2e] hover:bg-[#cba6f7]/80"
          >
            Save
          </button>
        </div>
      </form>
    );
  }

  const createdDate = provenance?.createdAt
    ? new Date(provenance.createdAt).toLocaleDateString()
    : "Unknown";
  const updatedDate = provenance?.updatedAt
    ? new Date(provenance.updatedAt).toLocaleDateString()
    : "Unknown";

  return (
    <div className="space-y-1.5 text-xs text-gray-400">
      <div className="flex justify-between">
        <span className="text-gray-600">Author</span>
        <span className="font-medium text-gray-300">
          {provenance?.author ?? "Unknown"}
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-gray-600">Source</span>
        <span>
          {SOURCE_LABELS[provenance?.sourceOrigin as SourceOrigin] ??
            provenance?.sourceOrigin}
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-gray-600">Created</span>
        <span>{createdDate}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-gray-600">Updated</span>
        <span>{updatedDate}</span>
      </div>
      {provenance?.sessionId && (
        <div className="flex justify-between">
          <span className="text-gray-600">Session</span>
          <span
            className="max-w-[120px] truncate font-mono"
            title={provenance.sessionId}
          >
            {provenance.sessionId}
          </span>
        </div>
      )}
    </div>
  );
}
