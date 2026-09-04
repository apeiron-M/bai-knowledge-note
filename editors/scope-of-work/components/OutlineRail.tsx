import { actions } from "document-models/scope-of-work";
import { generateId } from "document-model/core";
import {
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useEditor } from "../lib/context.js";
import { isClosed, milestoneOf, money, rollup, slugify } from "../lib/model.js";
import { Ring } from "./ui.js";

const SECTIONS = {
  roadmaps: true,
  projects: true,
} as const;

type OpenMap = Record<string, boolean>;

export function OutlineRail() {
  const { state, view, go, dispatch } = useEditor();
  const [open, setOpen] = useState<OpenMap>({});
  const is = (kind: string, id?: string) =>
    view.kind === kind && ("id" in view ? view.id === id : true);
  const shown = (key: string, fallback: boolean) => open[key] ?? fallback;
  const toggle = (key: string, fallback: boolean) =>
    setOpen((s) => ({ ...s, [key]: !(s[key] ?? fallback) }));
  const reveal = (patch: OpenMap) => setOpen((s) => ({ ...s, ...patch }));

  const unscheduled = state.deliverables.filter(
    (d) => !isClosed(d) && !milestoneOf(state, d.id),
  ).length;

  const viewId = "id" in view ? view.id : "";
  // the envelope whose rail branch should be open for the current view
  const activeProjectId =
    view.kind === "project" ? view.id : view.kind === "wbs" ? view.projectId : undefined;
  const parentRoadmapId =
    view.kind === "milestone"
      ? state.roadmaps.find((r) => r.milestones.some((m) => m.id === viewId))
          ?.id
      : undefined;
  // Keep the active branch visible when navigation comes from the canvas.
  // Re-runs only when the view target changes, so a manual collapse on the
  // current item is not immediately forced back open.
  useEffect(() => {
    const patch: OpenMap = {};
    if (view.kind === "roadmap") {
      patch.roadmaps = true;
      patch[`rm:${viewId}`] = true;
    } else if (view.kind === "milestone") {
      patch.roadmaps = true;
      if (parentRoadmapId) patch[`rm:${parentRoadmapId}`] = true;
    } else if (activeProjectId) {
      patch.projects = true;
      patch[`pr:${activeProjectId}`] = true;
    }
    if (Object.keys(patch).length > 0) setOpen((s) => ({ ...s, ...patch }));
  }, [view.kind, viewId, parentRoadmapId, activeProjectId]);

  const addRoadmap = () => {
    const id = generateId();
    dispatch(
      actions.addRoadmap({
        id,
        title: "New roadmap",
        slug: slugify("new-roadmap", id),
      }),
    );
    reveal({ roadmaps: true, [`rm:${id}`]: true });
    go({ kind: "roadmap", id });
  };
  const addProject = () => {
    const id = generateId();
    dispatch(
      actions.addProject({
        id,
        code: "NEW",
        title: "New project",
        slug: slugify("new-project", id),
      }),
    );
    reveal({ projects: true });
    go({ kind: "project", id });
  };

  return (
    <nav className="rail" aria-label="Outline">
      <button
        type="button"
        className={`node ${is("overview") ? "active" : ""}`}
        onClick={() => go({ kind: "overview" })}
      >
        ◫ <span>Overview</span>
      </button>

      <Section
        label="Roadmaps"
        open={shown("roadmaps", SECTIONS.roadmaps)}
        onToggle={() => toggle("roadmaps", SECTIONS.roadmaps)}
        action={
          <button type="button" onClick={addRoadmap} title="Add roadmap">
            + add
          </button>
        }
      >
        {state.roadmaps.map((r) => {
          const rmKey = `rm:${r.id}`;
          const hasKids = r.milestones.length > 0;
          const rmOpen = shown(rmKey, false);
          return (
            <div key={r.id}>
              <Node
                active={is("roadmap", r.id)}
                open={hasKids ? rmOpen : undefined}
                onToggle={
                  hasKids ? () => toggle(rmKey, false) : undefined
                }
                onClick={() => go({ kind: "roadmap", id: r.id })}
                meta={<span className="cnt">{r.milestones.length}</span>}
              >
                <span>{r.title || "Untitled roadmap"}</span>
              </Node>
              {hasKids && rmOpen
                ? r.milestones.map((m) => (
                    <Node
                      key={m.id}
                      child
                      active={is("milestone", m.id)}
                      onClick={() => go({ kind: "milestone", id: m.id })}
                      meta={
                        <Ring
                          pct={rollup(state, m.scope?.deliverables ?? []).pct}
                        />
                      }
                    >
                      <span className="code">{m.sequenceCode}</span>
                      <span>{m.title || "Untitled"}</span>
                    </Node>
                  ))
                : null}
            </div>
          );
        })}
      </Section>

      <Section
        label="Projects"
        open={shown("projects", SECTIONS.projects)}
        onToggle={() => toggle("projects", SECTIONS.projects)}
        action={
          <button type="button" onClick={addProject} title="Add project">
            + add
          </button>
        }
      >
        {state.projects.map((p) => {
          const prKey = `pr:${p.id}`;
          const hasKids = Boolean(p.wbsRef);
          const prOpen = shown(prKey, false);
          return (
            <div key={p.id}>
              <Node
                active={is("project", p.id)}
                open={hasKids ? prOpen : undefined}
                onToggle={hasKids ? () => toggle(prKey, false) : undefined}
                onClick={() => go({ kind: "project", id: p.id })}
                meta={<span className="cnt">{money(p.budget ?? 0, p.currency)}</span>}
              >
                <span className="code">{p.code}</span>
                <span>{p.title || "Untitled project"}</span>
              </Node>
              {hasKids && prOpen ? (
                <>
                  {p.wbsRef && (
                    <Node
                      child
                      active={view.kind === "wbs" && view.projectId === p.id}
                      onClick={() => go({ kind: "wbs", projectId: p.id })}
                    >
                      <span className="code">WBS</span>
                      <span>Work breakdown</span>
                    </Node>
                  )}
                </>
              ) : null}
            </div>
          );
        })}
      </Section>

      <div className="sect">Deliverables</div>
      <Node
        flush
        active={is("deliverables") && !viewHasFilter(view, "milestone")}
        onClick={() => go({ kind: "deliverables" })}
        meta={<span className="cnt">{state.deliverables.length}</span>}
      >
        ☰ <span>All deliverables</span>
      </Node>
      {unscheduled > 0 && (
        <Node
          flush
          child
          active={viewHasFilter(view, "milestone", "__none")}
          onClick={() =>
            go({ kind: "deliverables", filters: { milestone: "__none" } })
          }
          className="signal"
          meta={<span className="cnt">{unscheduled}</span>}
        >
          ⚑ <span>Unscheduled</span>
        </Node>
      )}

      <div className="sect">Team</div>
      <Node
        flush
        active={is("team")}
        onClick={() => go({ kind: "team" })}
        meta={<span className="cnt">{state.contributors.length}</span>}
      >
        ◉ <span>Contributors</span>
      </Node>
    </nav>
  );
}

function viewHasFilter(
  view: { kind: string; filters?: { milestone?: string } },
  key: "milestone",
  value?: string,
): boolean {
  if (view.kind !== "deliverables") return false;
  const current = view.filters?.[key];
  return value === undefined ? Boolean(current) : current === value;
}

function Section({
  label,
  open,
  onToggle,
  action,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  action?: ReactNode;
  children: ReactNode;
}) {
  const id = `rail-${label.toLowerCase()}`;
  return (
    <>
      <div className="sect">
        <button
          type="button"
          className="sect-toggle"
          aria-expanded={open}
          aria-controls={id}
          onClick={onToggle}
        >
          <span className={`chev ${open ? "open" : ""}`} aria-hidden>
            ▸
          </span>
          {label}
        </button>
        {action}
      </div>
      {open ? (
        <div id={id} role="group" aria-label={label}>
          {children}
        </div>
      ) : null}
    </>
  );
}

function Node({
  active,
  child,
  open,
  onToggle,
  onClick,
  children,
  meta,
  className,
  flush,
}: {
  active?: boolean;
  child?: boolean;
  /** `undefined` means this row has no children to expand. */
  open?: boolean;
  onToggle?: () => void;
  onClick: () => void;
  children: ReactNode;
  meta?: ReactNode;
  className?: string;
  /** Skip the tree gutter — this row is a view link, not a parent. */
  flush?: boolean;
}) {
  const expandable = onToggle != null;
  return (
    <div
      className={`node ${child ? "child" : ""} ${active ? "active" : ""} ${className ?? ""}`.trim()}
    >
      {expandable ? (
        <button
          type="button"
          className={`chev ${open ? "open" : ""}`}
          aria-expanded={open}
          title={open ? "Collapse" : "Expand"}
          onClick={onToggle}
        >
          ▸
        </button>
      ) : child || flush ? null : (
        <span className="chev spacer" aria-hidden />
      )}
      <button type="button" className="main" onClick={onClick}>
        {children}
      </button>
      {meta}
    </div>
  );
}
