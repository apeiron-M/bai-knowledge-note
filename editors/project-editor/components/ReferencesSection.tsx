import { useState } from "react";
import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import { actions } from "document-models/project";
import type {
  ProjectAction,
  ProjectGlobalState,
} from "document-models/project";

type Dispatch = DocumentDispatch<ProjectAction>;

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

type ReferencesSectionProps = {
  state: ProjectGlobalState;
  dispatch: Dispatch;
};

export function ReferencesSection({ state, dispatch }: ReferencesSectionProps) {
  const references = state.references;
  const [url, setUrl] = useState("");
  const trimmedUrl = url.trim();
  const showInvalidHint = trimmedUrl.length > 0 && !isValidUrl(trimmedUrl);

  function handleAdd() {
    if (!trimmedUrl || !isValidUrl(trimmedUrl)) return;
    dispatch(
      actions.setReferences({ references: [...references, trimmedUrl] }),
    );
    setUrl("");
  }

  function handleRemove(target: string) {
    dispatch(
      actions.setReferences({
        references: references.filter((r) => r !== target),
      }),
    );
  }

  return (
    <div
      className="rounded-xl p-5"
      style={{
        backgroundColor: "var(--bai-surface)",
        border: "1px solid var(--bai-border)",
      }}
    >
      <h3
        className="mb-2 text-xs font-semibold uppercase tracking-wider"
        style={{ color: "var(--bai-text-muted)" }}
      >
        References
      </h3>
      {references.length > 0 && (
        <div className="mb-2 space-y-1">
          {references.map((ref, index) => (
            <div
              key={`${ref}-${index}`}
              className="group flex items-center gap-2"
            >
              <a
                href={ref}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 truncate text-xs hover:underline"
                style={{ color: "var(--bai-text-secondary)" }}
              >
                {ref}
              </a>
              <button
                type="button"
                onClick={() => handleRemove(ref)}
                className="shrink-0 rounded p-1 opacity-0 transition-all hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
                style={{ color: "var(--bai-text-faint)" }}
                title="Remove reference"
              >
                <svg
                  className="h-3 w-3"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
          }}
          placeholder="Add reference URL..."
          className="min-w-0 flex-1 rounded-md px-2 py-1 text-xs outline-none"
          style={{
            backgroundColor: "var(--bai-bg)",
            color: "var(--bai-text-secondary)",
            border: "1px solid var(--bai-border)",
          }}
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={!trimmedUrl || !isValidUrl(trimmedUrl)}
          className="shrink-0 rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-40"
          style={{
            backgroundColor: "var(--bai-accent)",
            color: "var(--bai-accent-text)",
          }}
        >
          Add
        </button>
      </div>
      {showInvalidHint && (
        <p className="mt-1 text-[10px] text-red-400">
          Must be a valid URL (e.g. https://...)
        </p>
      )}
    </div>
  );
}
