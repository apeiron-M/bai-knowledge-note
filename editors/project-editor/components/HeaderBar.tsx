import { useState, type ReactNode } from "react";
import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import { actions } from "document-models/project";
import type {
  ProjectAction,
  ProjectGlobalState,
  ProjectStatus,
} from "document-models/project";
import { PROJECT_STATUS_META } from "../../shared/project-status.js";

type Dispatch = DocumentDispatch<ProjectAction>;

const ALL_PROJECT_STATUSES: ProjectStatus[] = [
  "PLANNING",
  "ACTIVE",
  "ON_HOLD",
  "COMPLETED",
  "ARCHIVED",
];

const LABEL_STYLE = { color: "var(--bai-text-muted)" };

type HeaderBarProps = {
  state: ProjectGlobalState;
  dispatch: Dispatch;
};

export function HeaderBar({ state, dispatch }: HeaderBarProps) {
  return (
    <div
      className="space-y-4 rounded-xl p-5"
      style={{
        backgroundColor: "var(--bai-surface)",
        border: "1px solid var(--bai-border)",
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <input
          type="text"
          defaultValue={state.name ?? ""}
          onBlur={(e) => {
            const value = e.target.value.trim();
            if (!value) {
              // Name is required once a project is initialized — reset the
              // DOM rather than let it look emptied out.
              e.currentTarget.value = state.name ?? "";
              return;
            }
            if (value !== state.name) {
              dispatch(actions.updateProjectInfo({ name: value }));
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-2xl font-bold outline-none"
          style={{ color: "var(--bai-text)" }}
        />
        <StatusPill status={state.status} dispatch={dispatch} />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Field label="Owner">
          <input
            type="text"
            defaultValue={state.owner ?? ""}
            placeholder="Unassigned"
            onBlur={(e) => {
              const next = e.target.value.trim() || null;
              if (next !== (state.owner ?? null)) {
                dispatch(actions.setOwner({ owner: next }));
              }
            }}
            className="w-full rounded-md px-2 py-1 text-sm outline-none"
            style={{
              backgroundColor: "var(--bai-bg)",
              color: "var(--bai-text-secondary)",
              border: "1px solid var(--bai-border)",
            }}
          />
        </Field>

        <Field label="Target Date">
          <input
            type="date"
            defaultValue={state.targetDate ? state.targetDate.slice(0, 10) : ""}
            onBlur={(e) => {
              const raw = e.target.value;
              // Stored as a full ISO datetime (the generated zod schema
              // validates `targetDate` with z.iso.datetime(), even though
              // the GraphQL scalar is `Date`) — normalize the date input's
              // YYYY-MM-DD value to midnight UTC before dispatching.
              const next = raw ? `${raw}T00:00:00.000Z` : null;
              if (next !== (state.targetDate ?? null)) {
                dispatch(actions.setTargetDate({ targetDate: next }));
              }
            }}
            className="w-full rounded-md px-2 py-1 text-sm outline-none"
            style={{
              backgroundColor: "var(--bai-bg)",
              color: "var(--bai-text-secondary)",
              border: "1px solid var(--bai-border)",
            }}
          />
        </Field>
      </div>

      <Field label="Description">
        <textarea
          defaultValue={state.description ?? ""}
          onBlur={(e) => {
            const value = e.target.value.trim();
            if (!value) {
              // updateProjectInfo's reducer only ever assigns description
              // when truthy (it can't be cleared once set) — reset the DOM
              // rather than let it look emptied out.
              e.currentTarget.value = state.description ?? "";
              return;
            }
            if (value !== (state.description ?? "")) {
              dispatch(actions.updateProjectInfo({ description: value }));
            }
          }}
          rows={3}
          placeholder="What is this project about? (optional)"
          className="w-full resize-none rounded-lg px-3 py-2 text-sm outline-none"
          style={{
            backgroundColor: "var(--bai-bg)",
            color: "var(--bai-text-secondary)",
            border: "1px solid var(--bai-border)",
          }}
        />
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label
        className="mb-1 block text-xs font-semibold uppercase tracking-wider"
        style={LABEL_STYLE}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function StatusPill({
  status,
  dispatch,
}: {
  status: ProjectStatus;
  dispatch: Dispatch;
}) {
  const [open, setOpen] = useState(false);
  const meta = PROJECT_STATUS_META[status];

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-full border px-2.5 py-1 text-xs font-medium"
        style={{
          color: meta.fg,
          backgroundColor: meta.bg,
          borderColor: meta.border,
        }}
      >
        {meta.label}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 z-50 mt-1 max-h-[60vh] w-40 overflow-y-auto rounded-xl p-1 shadow-2xl"
            style={{
              backgroundColor: "var(--bai-surface)",
              border: "1px solid var(--bai-border)",
            }}
          >
            {ALL_PROJECT_STATUSES.map((s) => {
              const m = PROJECT_STATUS_META[s];
              const isCurrent = s === status;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    dispatch(actions.setProjectStatus({ status: s }));
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-white/5"
                  style={{
                    color: isCurrent ? m.fg : "var(--bai-text-secondary)",
                  }}
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: m.fg }}
                  />
                  {m.label}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
