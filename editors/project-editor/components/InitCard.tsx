import { useState } from "react";
import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import { actions } from "document-models/project";
import type { ProjectAction, ProjectStatus } from "document-models/project";
import { PROJECT_STATUS_META } from "../../shared/project-status.js";

type Dispatch = DocumentDispatch<ProjectAction>;

const ALL_STATUSES: ProjectStatus[] = [
  "PLANNING",
  "ACTIVE",
  "ON_HOLD",
  "COMPLETED",
  "ARCHIVED",
];

const LABEL_STYLE = { color: "var(--bai-text-muted)" };
const FIELD_STYLE = {
  backgroundColor: "var(--bai-bg)",
  color: "var(--bai-text-secondary)",
  border: "1px solid var(--bai-border)",
};

type InitCardProps = {
  initialName: string;
  dispatch: Dispatch;
};

/** Shown while the project document has not been initialized yet
 * (`state.name` is empty) — collects the fields `createProject` needs. */
export function InitCard({ initialName, dispatch }: InitCardProps) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState("");
  const [owner, setOwner] = useState("");
  const [status, setStatus] = useState<ProjectStatus>("PLANNING");

  function handleSubmit() {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    dispatch(
      actions.createProject({
        name: trimmedName,
        description: description.trim() || undefined,
        owner: owner.trim() || undefined,
        status,
        createdAt: new Date().toISOString(),
      }),
    );
  }

  return (
    <div className="mx-auto max-w-xl p-6">
      <div
        className="space-y-4 rounded-xl border p-6"
        style={{
          backgroundColor: "var(--bai-surface)",
          borderColor: "var(--bai-border)",
        }}
      >
        <h2 className="text-lg font-bold" style={{ color: "var(--bai-text)" }}>
          New Project
        </h2>

        <div>
          <label
            className="mb-1.5 block text-xs font-semibold uppercase tracking-wider"
            style={LABEL_STYLE}
          >
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
            }}
            placeholder="Project name"
            autoFocus
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={FIELD_STYLE}
          />
        </div>

        <div>
          <label
            className="mb-1.5 block text-xs font-semibold uppercase tracking-wider"
            style={LABEL_STYLE}
          >
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="What is this project about? (optional)"
            className="w-full resize-none rounded-lg px-3 py-2 text-sm outline-none"
            style={FIELD_STYLE}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              className="mb-1.5 block text-xs font-semibold uppercase tracking-wider"
              style={LABEL_STYLE}
            >
              Owner
            </label>
            <input
              type="text"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              placeholder="Unassigned"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={FIELD_STYLE}
            />
          </div>
          <div>
            <label
              className="mb-1.5 block text-xs font-semibold uppercase tracking-wider"
              style={LABEL_STYLE}
            >
              Status
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as ProjectStatus)}
              className="w-full rounded-lg px-3 py-2 text-sm"
              style={FIELD_STYLE}
            >
              {ALL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {PROJECT_STATUS_META[s].label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={!name.trim()}
          className="w-full rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-40"
          style={{
            backgroundColor: "var(--bai-accent)",
            color: "var(--bai-accent-text)",
          }}
        >
          Create Project
        </button>
      </div>
    </div>
  );
}
