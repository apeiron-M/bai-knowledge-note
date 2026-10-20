import { actions } from "document-models/scope-of-work";
import { generateId } from "document-model/core";
import { useState } from "react";
import { DeliverableTable } from "../components/DeliverableRow.js";
import { CopyableId } from "../components/ui.js";
import { useEditor } from "../lib/context.js";
import {
  DELIVERABLE_STATUSES,
  STATUS_LABEL,
  agentById,
  allMilestones,
  emptyFilters,
  milestoneOf,
  projectOf,
  type Filters,
} from "../lib/model.js";

/** Option labels feed the native select's width; keep them to one readable line. */
const clip = (s: string, n = 56): string =>
  s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;

export function DeliverablesView({ initial }: { initial?: Partial<Filters> }) {
  const { state, dispatch, select, documentId } = useEditor();
  const [f, setF] = useState<Filters>({ ...emptyFilters, ...initial });
  const set = (patch: Partial<Filters>) =>
    setF((prev) => ({ ...prev, ...patch }));
  const active = f.status || f.project || f.milestone || f.owner || f.q;

  const ds = state.deliverables.filter((d) => {
    if (f.status && d.status !== f.status) return false;
    const p = projectOf(state, d.id);
    if (f.project === "__none" ? !!p : f.project !== "" && p?.id !== f.project)
      return false;
    const m = milestoneOf(state, d.id);
    if (
      f.milestone === "__none"
        ? !!m
        : f.milestone !== "" && m?.milestone.id !== f.milestone
    )
      return false;
    if (f.owner === "__none" ? !!d.owner : f.owner !== "" && d.owner !== f.owner)
      return false;
    if (f.q) {
      const ownerName = agentById(state, d.owner)?.name ?? "";
      const hay = `${d.title} ${d.code} ${ownerName}`.toLowerCase();
      if (!hay.includes(f.q.toLowerCase())) return false;
    }
    return true;
  });

  const create = () => {
    const id = generateId();
    dispatch(actions.addDeliverable({ id, title: "New deliverable" }));
    select(id);
  };

  return (
    <div className="doc">
      <div className="eyebrow eyebrow-row">
        <span>All deliverables</span>
        {/* A list has no one deliverable to identify, so this is the
            document doing the listing — each row carries its own id in
            the inspector. */}
        <CopyableId id={documentId} label="Scope of work id" />
      </div>
      <h1 className="title">
        {ds.length}{" "}
        <span className="faint" style={{ fontWeight: 500 }}>
          of {state.deliverables.length}
        </span>
      </h1>
      <div className="filters">
        <input
          placeholder="Search title, code, or owner…"
          value={f.q}
          onChange={(e) => set({ q: e.target.value })}
          aria-label="Search"
        />
        <select
          value={f.status}
          onChange={(e) => set({ status: e.target.value })}
          aria-label="Status filter"
        >
          <option value="">Any status</option>
          {DELIVERABLE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select
          value={f.project}
          onChange={(e) => set({ project: e.target.value })}
          aria-label="Project filter"
        >
          <option value="">Any project</option>
          <option value="__none">Unfunded</option>
          {state.projects.map((p) => (
            <option key={p.id} value={p.id} title={`${p.code} ${p.title}`}>
              {clip(`${p.code} ${p.title}`)}
            </option>
          ))}
        </select>
        <select
          value={f.milestone}
          onChange={(e) => set({ milestone: e.target.value })}
          aria-label="Milestone filter"
        >
          <option value="">Any milestone</option>
          <option value="__none">Unscheduled</option>
          {allMilestones(state).map((x) => (
            <option
              key={x.milestone.id}
              value={x.milestone.id}
              title={`${x.milestone.sequenceCode} ${x.milestone.title}`}
            >
              {clip(`${x.milestone.sequenceCode} ${x.milestone.title}`)}
            </option>
          ))}
        </select>
        <select
          value={f.owner}
          onChange={(e) => set({ owner: e.target.value })}
          aria-label="Owner filter"
        >
          <option value="">Any owner</option>
          <option value="__none">Unassigned</option>
          {state.contributors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        {active && (
          <button className="btn sm ghost" onClick={() => setF(emptyFilters)}>
            Clear
          </button>
        )}
        <div className="grow" />
        <button className="btn sm" onClick={create}>
          + New deliverable
        </button>
      </div>
      <div className="rows">
        <DeliverableTable items={ds} />
        {ds.length === 0 && (
          <div className="empty">
            <b>{active ? "Nothing matches" : "No deliverables yet"}</b>
            {active
              ? "Loosen the filters, or create the deliverable you were looking for."
              : "Create one here, or add it straight into a milestone or project."}
          </div>
        )}
      </div>
    </div>
  );
}
