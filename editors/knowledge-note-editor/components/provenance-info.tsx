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
      <div
        className="rounded-lg border border-dashed p-3 text-center"
        style={{ borderColor: "var(--bai-border)" }}
      >
        <p
          className="mb-2 text-xs"
          style={{ color: "var(--bai-text-muted)" }}
        >
          No provenance set
        </p>
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className="text-xs font-medium transition-colors hover:opacity-80"
          style={{ color: "var(--bai-accent)" }}
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
        className="space-y-2 rounded-lg border p-3"
        style={{
          borderColor: "color-mix(in srgb, var(--bai-accent) 25%, transparent)",
          backgroundColor:
            "color-mix(in srgb, var(--bai-accent) 8%, transparent)",
        }}
      >
        <label className="block text-xs">
          <span style={{ color: "var(--bai-text-muted)" }}>Author</span>
          <input
            type="text"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="Author name..."
            autoFocus
            className="mt-1 w-full rounded border px-2 py-1.5 text-xs outline-none focus:border-[#cba6f7]/50"
            style={{
              backgroundColor: "var(--bai-bg)",
              color: "var(--bai-text-secondary)",
              borderColor: "var(--bai-border)",
            }}
          />
        </label>
        <label className="block text-xs">
          <span style={{ color: "var(--bai-text-muted)" }}>Source origin</span>
          <select
            value={sourceOrigin}
            onChange={(e) => setSourceOrigin(e.target.value as SourceOrigin)}
            className="mt-1 w-full rounded border px-2 py-1.5 text-xs outline-none focus:border-[#cba6f7]/50"
            style={{
              backgroundColor: "var(--bai-bg)",
              color: "var(--bai-text-secondary)",
              borderColor: "var(--bai-border)",
            }}
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
            className="rounded px-2.5 py-1 text-xs transition-colors"
            style={{ color: "var(--bai-text-muted)" }}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded px-2.5 py-1 text-xs font-medium transition-opacity hover:opacity-80"
            style={{
              backgroundColor: "var(--bai-accent)",
              color: "var(--bai-accent-text, #1e1e2e)",
            }}
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
    <div
      className="space-y-1.5 text-xs"
      style={{ color: "var(--bai-text-tertiary)" }}
    >
      <div className="flex justify-between gap-2">
        <span
          className="shrink-0"
          style={{ color: "var(--bai-text-muted)" }}
        >
          Author
        </span>
        <span
          className="min-w-0 truncate text-right font-medium"
          style={{ color: "var(--bai-text-secondary)" }}
          title={provenance?.author ?? undefined}
        >
          {provenance?.author ?? "Unknown"}
        </span>
      </div>
      <div className="flex justify-between">
        <span style={{ color: "var(--bai-text-muted)" }}>Source</span>
        <span>
          {SOURCE_LABELS[provenance?.sourceOrigin as SourceOrigin] ??
            provenance?.sourceOrigin}
        </span>
      </div>
      <div className="flex justify-between">
        <span style={{ color: "var(--bai-text-muted)" }}>Created</span>
        <span>{createdDate}</span>
      </div>
      <div className="flex justify-between">
        <span style={{ color: "var(--bai-text-muted)" }}>Updated</span>
        <span>{updatedDate}</span>
      </div>
      {provenance?.sessionId && (
        <div className="flex justify-between gap-2">
          <span
            className="shrink-0"
            style={{ color: "var(--bai-text-muted)" }}
          >
            Session
          </span>
          <span
            className="min-w-0 truncate text-right font-mono"
            title={provenance.sessionId}
          >
            {provenance.sessionId}
          </span>
        </div>
      )}
    </div>
  );
}
