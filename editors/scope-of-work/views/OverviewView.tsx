import {
  actions,
  type Agent,
  type Deliverable,
  type Project,
} from "document-models/scope-of-work";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useEditor } from "../lib/context.js";
import {
  SOW_STATUSES,
  STATUS_LABEL,
  agentById,
  allMilestones,
  budgetsByCurrency,
  checklist,
  dateFmt,
  deliveryHorizon,
  isClosed,
  isMilestoneDone,
  isOneOf,
  milestoneIndex,
  money,
  nextMilestone,
  planMode,
  planWindow,
  projectIndex,
  rollup,
  scopePct,
  sortedMilestones,
  triage,
  worstStatus,
  type Horizon,
  type MilestoneRef,
} from "../lib/model.js";
import {
  Avatar,
  Bar,
  CopyableId,
  InlineText,
  Kpi,
  MoneyStack,
} from "../components/ui.js";

/** Rows in "Next up": enough to see the coming weeks, few enough to read at a glance. */
const NEXT_UP = 5;
/** Milestone columns the plan shows before folding the rest into Done and Later. */
const PLAN_WINDOW = 8;

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * The lobby, not the archive. Every block here stays the same size whether
 * the scope holds three milestones or three hundred; what does not fit is
 * counted and linked to the list view that holds it. Reading order follows
 * the questions a person arrives with: on track? anything mine to fix? what
 * lands next? who funds it?
 */
export function OverviewView() {
  const { state, dispatch, go, today, documentId } = useEditor();
  const all = rollup(
    state,
    state.deliverables.map((d) => d.id),
  );
  const horizon = useMemo(() => deliveryHorizon(state, today), [state, today]);
  const needs = useMemo(() => triage(state, today), [state, today]);
  const next = nextMilestone(state, today);
  const checks = checklist(state);
  const msTotal = allMilestones(state).length;
  const attention =
    needs.blocked + needs.unfunded + needs.unscheduled + needs.overdue;

  return (
    <div className="doc">
      <div className="eyebrow eyebrow-row">
        <span>Scope of work</span>
        <CopyableId id={documentId} label="Scope of work id" />
      </div>
      <h1 className="title">
        <InlineText
          ariaLabel="Title"
          value={state.title}
          placeholder="Name this scope of work"
          onCommit={(title) => dispatch(actions.editScopeOfWork({ title }))}
        />
      </h1>
      <p className="desc">
        <InlineText
          ariaLabel="Summary"
          multiline
          value={state.description}
          placeholder="Two or three sentences: what, for whom, and why now."
          onCommit={(description) =>
            dispatch(actions.editScopeOfWork({ description }))
          }
        />
      </p>
      <div className="toolbar">
        <span>Status</span>
        <select
          className="in sm"
          value={state.status}
          aria-label="Document status"
          onChange={(e) => {
            if (isOneOf(SOW_STATUSES, e.target.value))
              dispatch(actions.editScopeOfWork({ status: e.target.value }));
          }}
        >
          {SOW_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      <div className="kpis">
        <Kpi
          label="Budget"
          value={<MoneyStack byCur={budgetsByCurrency(state)} />}
          sub={`${plural(state.projects.length, "project")} · derived from quotes`}
        />
        <Kpi
          label="Progress"
          value={`${Math.round(all.pct)}%`}
          sub={
            <div style={{ marginTop: 6 }}>
              <Bar pct={all.pct} />
            </div>
          }
        />
        <Kpi
          label="Deliverables"
          value={
            <>
              {all.done}
              <span className="faint" style={{ fontSize: 18 }}>
                {" "}
                / {all.total}
              </span>
            </>
          }
          sub="delivered"
        />
        <Kpi
          label="Next milestone"
          value={next ? next.milestone.sequenceCode : "—"}
          sub={
            next
              ? `${next.milestone.title} · ${dateFmt(next.milestone.deliveryTarget)}`
              : "nothing scheduled"
          }
        />
      </div>

      {attention > 0 && (
        <div className="triage" role="group" aria-label="Needs attention">
          {needs.overdue > 0 && (
            <button
              type="button"
              className="pill ember"
              onClick={() => go({ kind: "roadmaps" })}
            >
              <i aria-hidden />
              {plural(needs.overdue, "milestone")} overdue
            </button>
          )}
          {needs.blocked > 0 && (
            <button
              type="button"
              className="pill ember"
              onClick={() =>
                go({ kind: "deliverables", filters: { status: "BLOCKED" } })
              }
            >
              <i aria-hidden />
              {needs.blocked} blocked
            </button>
          )}
          {needs.unfunded > 0 && (
            <button
              type="button"
              className="pill signal"
              onClick={() =>
                go({ kind: "deliverables", filters: { project: "__none" } })
              }
            >
              <i aria-hidden />
              {needs.unfunded} unfunded
            </button>
          )}
          {needs.unscheduled > 0 && (
            <button
              type="button"
              className="pill signal"
              onClick={() =>
                go({ kind: "deliverables", filters: { milestone: "__none" } })
              }
            >
              <i aria-hidden />
              {needs.unscheduled} unscheduled
            </button>
          )}
        </div>
      )}

      <section className="section">
        <div className="hd">
          <h2>Roadmaps</h2>
          <div className="grow" />
          <button className="btn sm ghost" onClick={() => go({ kind: "roadmaps" })}>
            All roadmaps
          </button>
        </div>
        <RoadmapsSummary />
      </section>

      <section className="section">
        <div className="hd">
          <h2>Next up</h2>
          {msTotal > 0 && (
            <span className="muted">
              {horizon.delivered.length} of {plural(msTotal, "milestone")}{" "}
              delivered
            </span>
          )}
          <div className="grow" />
        </div>
        {msTotal === 0 ? (
          <div className="card empty">
            <b>No milestones yet</b>
            {state.roadmaps.length === 0
              ? "Add a roadmap from the outline, then give it dated milestones."
              : "Open a roadmap and add dated milestones."}
          </div>
        ) : (
          <>
            <Minimap horizon={horizon} />
            <NextUp horizon={horizon} />
          </>
        )}
      </section>

      <PlanSection horizon={horizon} />

      {!checks.every((c) => c.ok) && (
        <section className="section">
          <div className="hd">
            <h2>Ready to submit?</h2>
            <span className="muted">
              {checks.filter((c) => c.ok).length} of {checks.length} complete
            </span>
          </div>
          <div className="card">
            <div className="check">
              {checks.map((c) => (
                <div key={c.label} className={`ck ${c.ok ? "ok" : ""}`}>
                  <i>{c.ok ? "✓" : ""}</i>
                  <span>{c.label}</span>
                  {!c.ok && <button onClick={() => go(c.go)}>Fix</button>}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function RoadmapsSummary() {
  const { state, go, today } = useEditor();
  if (state.roadmaps.length === 0) {
    return (
      <div className="card empty">
        <b>No roadmaps yet</b>Add a roadmap from the outline, then give it dated
        milestones.
      </div>
    );
  }
  const t = today.toISOString().slice(0, 10);
  return (
    <div className="rows">
      <table className="tbl">
        <thead>
          <tr>
            <th className="grow">Roadmap</th>
            <th className="num">Milestones</th>
            <th>Next</th>
            <th className="prog">Progress</th>
          </tr>
        </thead>
        <tbody>
          {state.roadmaps.map((r) => {
            const ids = r.milestones.flatMap((m) => m.scope?.deliverables ?? []);
            const ru = rollup(state, ids);
            const dated = r.milestones
              .slice()
              .sort((a, b) =>
                (a.deliveryTarget || "9999").localeCompare(
                  b.deliveryTarget || "9999",
                ),
              );
            const next = dated.find(
              (m) => m.deliveryTarget >= t && !isMilestoneDone(state, m),
            );
            return (
              <tr
                key={r.id}
                tabIndex={0}
                onClick={() => go({ kind: "roadmap", id: r.id })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    go({ kind: "roadmap", id: r.id });
                  }
                }}
              >
                <td className="grow">
                  <div className="t">{r.title || "Untitled"}</div>
                </td>
                <td className="num">{r.milestones.length}</td>
                <td>
                  {next ? (
                    <>
                      <span className="mono faint">{next.sequenceCode}</span>{" "}
                      {dateFmt(next.deliveryTarget)}
                    </>
                  ) : (
                    <span className="faint">
                      {r.milestones.length === 0
                        ? "no milestones"
                        : "nothing scheduled"}
                    </span>
                  )}
                </td>
                <td className="prog">
                  <Bar pct={ru.pct} />
                  <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>
                    {ru.done}/{ru.total} done
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const DAY = 86_400_000;
const dayOf = (iso: string) =>
  Math.round(new Date(`${iso}T00:00:00Z`).getTime() / DAY);
const isoOf = (day: number) => new Date(day * DAY).toISOString().slice(0, 10);

/**
 * Every dated milestone as a tick on one proportional time line, today
 * marked. Ticks carry no labels — with dozens of milestones the labels were
 * the problem — so the list beneath names the few that matter now; any tick
 * says who it is on hover or focus and opens on click.
 */
function Minimap({ horizon }: { horizon: Horizon }) {
  const { go, today } = useEditor();
  const dated = [
    ...horizon.delivered,
    ...horizon.overdue,
    ...horizon.upcoming,
  ].filter((x) => x.milestone.deliveryTarget !== "");
  if (dated.length === 0) return null;
  const t = today.toISOString().slice(0, 10);
  const days = dated.map((x) => dayOf(x.milestone.deliveryTarget));
  const lo = Math.min(...days, dayOf(t));
  const hi = Math.max(...days, dayOf(t));
  const span = Math.max(1, hi - lo);
  const at = (iso: string) => `${((dayOf(iso) - lo) / span) * 100}%`;
  const done = new Set(horizon.delivered.map((x) => x.milestone.id));
  const late = new Set(horizon.overdue.map((x) => x.milestone.id));
  const liveId = horizon.upcoming[0]?.milestone.id;
  // milestones on the same day share one tick
  const byDay = new Map<string, MilestoneRef[]>();
  for (const x of dated) {
    const k = x.milestone.deliveryTarget;
    byDay.set(k, [...(byDay.get(k) ?? []), x]);
  }
  const toneOf = (refs: MilestoneRef[]) =>
    refs.some((x) => late.has(x.milestone.id))
      ? "overdue"
      : refs.some((x) => x.milestone.id === liveId)
        ? "live"
        : refs.every((x) => done.has(x.milestone.id))
          ? "done"
          : "";
  const nameOf = (x: MilestoneRef) =>
    `${x.milestone.sequenceCode} ${x.milestone.title || "Untitled"} · ${x.roadmap.title || "Untitled roadmap"}`;
  return (
    <div
      className="minimap"
      role="group"
      aria-label="Every dated milestone on one time line"
    >
      <div className="track">
        <span className="end lo">{dateFmt(isoOf(lo))}</span>
        <span className="end hi">{dateFmt(isoOf(hi))}</span>
        <div className="axis" />
        <div className="today" style={{ left: at(t) }}>
          <span>today</span>
        </div>
        {[...byDay.entries()].map(([day, refs]) => {
          const names = refs.map(nameOf);
          const single = refs.length === 1 ? refs[0] : undefined;
          return (
            <button
              key={day}
              type="button"
              className={`tick ${toneOf(refs)} ${refs.length > 1 ? "multi" : ""}`.trim()}
              style={{ left: at(day) }}
              title={[dateFmt(day), ...names].join("\n")}
              aria-label={`${dateFmt(day)}: ${names.join("; ")}`}
              onClick={() =>
                single
                  ? go({ kind: "milestone", id: single.milestone.id })
                  : go({ kind: "roadmaps" })
              }
            >
              {refs.length > 1 ? refs.length : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The next few open milestones — overdue first — and a count of the rest. */
function NextUp({ horizon }: { horizon: Horizon }) {
  const { state, go, today } = useEditor();
  const t = today.toISOString().slice(0, 10);
  const open = [...horizon.overdue, ...horizon.upcoming];
  const shown = open.slice(0, NEXT_UP);
  const further = open.length - shown.length;
  const undated = horizon.undated.length;
  const liveId = horizon.upcoming[0]?.milestone.id;
  if (shown.length === 0) {
    return (
      <div className="card empty">
        <b>
          {undated > 0
            ? "Nothing dated is still open"
            : "Every milestone is delivered"}
        </b>
        {undated > 0
          ? `${plural(undated, "milestone")} still need${undated === 1 ? "s" : ""} a delivery date.`
          : "Add the next milestone from a roadmap when the plan continues."}
      </div>
    );
  }
  const openMilestone = (id: string) => go({ kind: "milestone", id });
  const rest = [
    further > 0 ? `${further} further out` : "",
    undated > 0 ? `${plural(undated, "milestone")} undated` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="rows">
      <table className="tbl">
        <thead>
          <tr>
            <th className="grow primary">Milestone</th>
            <th>Lands</th>
            <th className="prog">Progress</th>
          </tr>
        </thead>
        <tbody>
          {shown.map(({ milestone: m, roadmap: r }) => {
            const ru = rollup(state, m.scope?.deliverables ?? []);
            const late = m.deliveryTarget < t;
            const live = m.id === liveId;
            return (
              <tr
                key={m.id}
                tabIndex={0}
                onClick={() => openMilestone(m.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openMilestone(m.id);
                  }
                }}
              >
                <td className="grow primary">
                  <div className="t">
                    <span
                      className={`msdot ${late ? "overdue" : live ? "live" : ""}`.trim()}
                      aria-hidden
                    />
                    <span className="mono faint">{m.sequenceCode}</span>{" "}
                    {m.title || <span className="faint">Untitled</span>}
                  </div>
                  <div className="sub">{r.title || "Untitled roadmap"}</div>
                </td>
                <td>
                  {dateFmt(m.deliveryTarget)}
                  {late && <div className="prog-sub ember">overdue</div>}
                  {live && <div className="prog-sub">next up</div>}
                </td>
                <td className="prog">
                  {ru.total > 0 ? (
                    <>
                      <Bar pct={ru.pct} />
                      <div className="prog-sub">
                        {ru.done}/{ru.total} delivered
                      </div>
                    </>
                  ) : (
                    <span className="faint">nothing scheduled in it</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        {rest !== "" && (
          <tfoot>
            <tr>
              <td colSpan={3} className="link">
                <button type="button" onClick={() => go({ kind: "roadmaps" })}>
                  {rest} — all roadmaps
                </button>
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

type PlanRow = {
  id: string;
  code: string;
  title: string;
  project?: Project;
  items: Deliverable[];
};
type PlanCol =
  | { kind: "done" | "later"; refs: MilestoneRef[] }
  | { kind: "unscheduled" }
  | { kind: "ms"; ref: MilestoneRef };
const colKey = (c: PlanCol) => (c.kind === "ms" ? c.ref.milestone.id : c.kind);
const cellKey = (rowId: string, col: string) => `${rowId}\u0000${col}`;
const cls = (...parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(" ");

/** Deliverables a zoomed cell lists itself before handing over to the list view. */
const ZOOM_CAP = 8;

// the corner cell never changes, so it is built once
const keyCell = (
  <div
    className="c h key"
    aria-label="Projects down the side, milestones across the top"
  >
    <svg
      className="key-diag"
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <line x1="0" y1="0" x2="1" y2="1" />
    </svg>
    <span className="key-col">Milestones</span>
    <span className="key-row">Projects</span>
  </div>
);

/** One deliverable as a card — the same card in a small plan's cell and in a zoomed one. */
function DeliverableCard({
  d,
  owner,
  selected,
  onOpen,
  autoFocus,
}: {
  d: Deliverable;
  owner: Agent | undefined;
  selected: boolean;
  onOpen: (id: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <button
      type="button"
      className={cls("mini", d.status, selected && "sel")}
      title={`${d.code} ${d.title || "Untitled"} · ${STATUS_LABEL[d.status]}`}
      onClick={() => onOpen(d.id)}
      autoFocus={autoFocus}
    >
      <span className="st" aria-hidden />
      <span className="code">{d.code}</span>
      <span className="t">{d.title || "Untitled"}</span>
      <Avatar agent={owner} />
    </button>
  );
}

/**
 * Who funds what, and when it lands: envelopes down the side, milestones
 * across the top. Two densities, chosen from the data on every render:
 *
 * - cards — a small plan shows every deliverable in its cell; click one and
 *   it opens in the inspector.
 * - chips — a count per cell, coloured by the worst status inside. Clicking a
 *   count zooms that cell in place: its column widens, its row grows to hold
 *   the cards, the other columns compress to their codes. Click outside, or
 *   Escape, and the grid returns to exactly the shape it had.
 *
 * Past the window, delivered milestones fold into one Done column and the
 * rest into Later, so the grid is the same width at 8 milestones and at 80.
 */
function PlanSection({ horizon }: { horizon: Horizon }) {
  const { state, go, select, selected } = useEditor();
  const [wide, setWide] = useState(false);
  const [zoomReq, setZoom] = useState<{ row: string; col: string } | null>(
    null,
  );
  const byMilestone = useMemo(() => milestoneIndex(state), [state]);
  const byProject = useMemo(() => projectIndex(state), [state]);
  const msTotal = allMilestones(state).length;
  // fewer milestones than the window fit as they are; more fold unless asked not to
  const folds = msTotal > PLAN_WINDOW;
  const compact = folds && !wide;
  // every milestone as its own column: fixed tracks, the grid scrolls sideways
  const wideMode = folds && !compact;
  const win = planWindow(horizon, PLAN_WINDOW);

  // canceled / won't-do deliverables have no place in a plan of what lands when
  const live = state.deliverables.filter((d) => !isClosed(d));
  const grouped = new Map<string, Deliverable[]>();
  const unfunded: Deliverable[] = [];
  for (const d of live) {
    const p = byProject.get(d.id);
    if (p) grouped.set(p.id, [...(grouped.get(p.id) ?? []), d]);
    else unfunded.push(d);
  }
  const rows: PlanRow[] = state.projects.map((p) => ({
    id: p.id,
    code: p.code,
    title: p.title,
    project: p,
    items: grouped.get(p.id) ?? [],
  }));
  if (unfunded.length > 0)
    rows.push({ id: "__none", code: "", title: "Unfunded", items: unfunded });
  // the gutter column earns its place only while live work still needs a date
  const hasUnscheduled = live.some((d) => !byMilestone.has(d.id));

  const cols: PlanCol[] = [];
  if (compact) {
    if (win.done.length > 0) cols.push({ kind: "done", refs: win.done });
    if (hasUnscheduled) cols.push({ kind: "unscheduled" });
    for (const ref of win.shown) cols.push({ kind: "ms", ref });
    if (win.later.length > 0) cols.push({ kind: "later", refs: win.later });
  } else {
    if (hasUnscheduled) cols.push({ kind: "unscheduled" });
    for (const ref of sortedMilestones(state)) cols.push({ kind: "ms", ref });
  }

  const inCell = (row: PlanRow, c: PlanCol): Deliverable[] => {
    if (c.kind === "unscheduled")
      return row.items.filter((d) => !byMilestone.has(d.id));
    if (c.kind === "ms")
      return row.items.filter(
        (d) => byMilestone.get(d.id)?.milestone.id === c.ref.milestone.id,
      );
    const ids = new Set(c.refs.map((x) => x.milestone.id));
    return row.items.filter((d) => {
      const m = byMilestone.get(d.id);
      return m !== undefined && ids.has(m.milestone.id);
    });
  };
  // every cell once, so the render never filters twice
  const cells = new Map<string, Deliverable[]>();
  for (const row of rows)
    for (const c of cols) cells.set(cellKey(row.id, colKey(c)), inCell(row, c));
  const cellOf = (rowId: string, col: string) =>
    cells.get(cellKey(rowId, col)) ?? [];
  const mode = planMode(cols.length, rows.length);
  // derived, not stored: the zoom is dropped the moment its cell stops existing
  // (the window toggled, a deliverable moved) — no effect needed
  const zoom =
    zoomReq !== null &&
    mode === "chips" &&
    cellOf(zoomReq.row, zoomReq.col).length > 0
      ? zoomReq
      : null;
  const zoomed = zoom !== null;
  const collapse = useCallback(() => setZoom(null), []);
  const toggleZoom = (rowId: string, col: string) =>
    setZoom((z) =>
      z !== null && z.row === rowId && z.col === col ? null : { row: rowId, col },
    );

  // A click outside the zoomed cell, or Escape, folds it back. One listener,
  // alive only while zoomed; the selection is read through a ref so the
  // subscription never has to be rebuilt.
  const zoomRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  useEffect(() => {
    if (!zoomed) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof Element) || !globalThis.document.contains(t)) return;
      if (zoomRef.current?.contains(t)) return;
      // a chip moves the zoom itself; the inspector, its modal and scrim,
      // dialogs and toasts are not "outside"
      if (
        t.closest(
          ".sow .plan .hc, .sow .inspector, .sow-scrim, .sow-modal, .sow-confirm, .sow .toast",
        )
      )
        return;
      collapse();
    };
    const onKey = (e: KeyboardEvent) => {
      // with a deliverable open, Escape belongs to the modal
      if (e.key === "Escape" && selectedRef.current === null) collapse();
    };
    globalThis.document.addEventListener("click", onClick);
    globalThis.addEventListener("keydown", onKey);
    return () => {
      globalThis.document.removeEventListener("click", onClick);
      globalThis.removeEventListener("keydown", onKey);
    };
  }, [zoomed, collapse]);

  const openCell = (row: PlanRow, c: PlanCol) => {
    const project = row.project ? row.project.id : "__none";
    switch (c.kind) {
      case "ms":
        go({
          kind: "deliverables",
          filters: { project, milestone: c.ref.milestone.id },
        });
        break;
      case "unscheduled":
        go({ kind: "deliverables", filters: { project, milestone: "__none" } });
        break;
      case "done":
        go({ kind: "deliverables", filters: { project, status: "DELIVERED" } });
        break;
      default:
        go({ kind: "deliverables", filters: { project } });
    }
  };
  const openColumn = (c: PlanCol) => {
    if (c.kind === "ms")
      go({ kind: "deliverables", filters: { milestone: c.ref.milestone.id } });
    else if (c.kind === "unscheduled")
      go({ kind: "deliverables", filters: { milestone: "__none" } });
  };
  const whereOf = (c: PlanCol) =>
    c.kind === "ms"
      ? `at ${c.ref.milestone.sequenceCode} ${c.ref.milestone.title || "Untitled"}`
      : c.kind === "unscheduled"
        ? "not yet scheduled"
        : c.kind === "done"
          ? "in delivered milestones"
          : "in later milestones";
  const listOf = (refs: MilestoneRef[]) =>
    refs
      .map(
        (x) =>
          `${x.milestone.sequenceCode} ${x.milestone.title || "Untitled"} · ${dateFmt(x.milestone.deliveryTarget)}`,
      )
      .join("\n");
  const headTitle = (c: PlanCol) =>
    c.kind === "ms"
      ? `${c.ref.milestone.sequenceCode} ${c.ref.milestone.title || "Untitled"} · ${c.ref.roadmap.title || "Untitled roadmap"}`
      : c.kind === "unscheduled"
        ? "Live work with no milestone yet"
        : listOf(c.refs);
  // the focused column takes the room; its siblings keep just enough for a code
  // or a count, and the gutter keeps its one word
  const track = (c: PlanCol): string => {
    const k = colKey(c);
    if (mode === "cards") return "minmax(140px, 1fr)";
    if (wideMode)
      return zoom?.col === k ? "320px" : c.kind === "ms" ? "96px" : "104px";
    if (zoom)
      return zoom.col === k
        ? "minmax(280px, 3fr)"
        : c.kind === "unscheduled"
          ? "minmax(96px, 1fr)"
          : "minmax(48px, 1fr)";
    return c.kind === "ms" ? "minmax(52px, 1fr)" : "minmax(96px, 1.3fr)";
  };

  return (
    <section className="section">
      <div className="hd">
        <h2>Plan</h2>
        <span className="muted">who funds what, and when it lands</span>
        <div className="grow" />
        {folds && rows.length > 0 && (
          <div className="seg sm" role="group" aria-label="Milestone columns">
            <button
              type="button"
              className={compact ? "on" : ""}
              aria-pressed={compact}
              onClick={() => setWide(false)}
            >
              Next {win.shown.length}
            </button>
            <button
              type="button"
              className={compact ? "" : "on"}
              aria-pressed={!compact}
              onClick={() => setWide(true)}
            >
              All {msTotal}
            </button>
          </div>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="card empty">
          <b>Nothing planned yet</b>Create a project from the outline and add
          deliverables to it.
        </div>
      ) : (
        <>
          <div
            className={cls("plan", mode, wideMode && "wide", zoomed && "zoomed")}
            style={{
              gridTemplateColumns: [
                wideMode ? "170px" : "minmax(150px, 190px)",
                ...cols.map(track),
              ].join(" "),
            }}
          >
            {keyCell}
            {cols.map((c) => {
              const k = colKey(c);
              return (
                <div
                  key={k}
                  className={cls(
                    "c",
                    "h",
                    c.kind !== "ms" && "agg",
                    zoom?.col === k && "focus",
                  )}
                  title={headTitle(c)}
                >
                  {c.kind === "ms" ? (
                    <>
                      <span className="code">{c.ref.milestone.sequenceCode}</span>
                      <b>{c.ref.milestone.title || "Untitled"}</b>
                      <span className="dt">
                        {dateFmt(
                          c.ref.milestone.deliveryTarget,
                          wideMode || zoom?.col === k
                            ? undefined
                            : { month: "short", day: "numeric" },
                        )}
                      </span>
                    </>
                  ) : c.kind === "unscheduled" ? (
                    <b>Unscheduled</b>
                  ) : (
                    <>
                      <b>{c.kind === "done" ? "Done" : "Later"}</b>
                      <span className="dt">{plural(c.refs.length, "milestone")}</span>
                    </>
                  )}
                  {mode === "cards" &&
                    (c.kind === "ms" || c.kind === "unscheduled") && (
                      <button
                        type="button"
                        className="h-open"
                        onClick={() => openColumn(c)}
                      >
                        Open list
                      </button>
                    )}
                </div>
              );
            })}
            {rows.map((row) => (
              <Fragment key={row.id}>
                <div className={cls("c", "rh", zoom?.row === row.id && "in-row")}>
                  {row.code && <span className="code">{row.code}</span>}
                  <b title={row.title}>{row.title}</b>
                  {row.project && (
                    <>
                      <div className="money">
                        {money(row.project.budget ?? 0, row.project.currency)}
                      </div>
                      <div style={{ marginTop: 6 }}>
                        <Bar pct={scopePct(row.project.scope)} />
                      </div>
                    </>
                  )}
                </div>
                {cols.map((c) => {
                  const k = colKey(c);
                  const ds = cellOf(row.id, k);
                  const isZoom = zoom?.row === row.id && zoom.col === k;
                  const className = cls(
                    "c",
                    c.kind !== "ms" && "agg",
                    zoom?.col === k && "focus",
                    zoom?.row === row.id && "in-row",
                    isZoom && "zoom",
                  );
                  if (isZoom)
                    return (
                      <div key={k} ref={zoomRef} className={className}>
                        <div className="zoom-hd">
                          <span className="where">
                            <b>{row.code || row.title}</b> {whereOf(c)} ·{" "}
                            {plural(ds.length, "deliverable")}
                          </span>
                          <button
                            type="button"
                            className="btn sm ghost"
                            onClick={() => openCell(row, c)}
                          >
                            Open list
                          </button>
                          <button
                            type="button"
                            className="zoom-x"
                            aria-label="Collapse"
                            title="Collapse (Esc)"
                            onClick={collapse}
                          >
                            ×
                          </button>
                        </div>
                        {ds.slice(0, ZOOM_CAP).map((d, i) => (
                          <DeliverableCard
                            key={d.id}
                            d={d}
                            owner={agentById(state, d.owner)}
                            selected={selected === d.id}
                            onOpen={select}
                            autoFocus={i === 0}
                          />
                        ))}
                        {ds.length > ZOOM_CAP && (
                          <button
                            type="button"
                            className="zoom-more"
                            onClick={() => openCell(row, c)}
                          >
                            +{ds.length - ZOOM_CAP} more · open list
                          </button>
                        )}
                      </div>
                    );
                  if (mode === "cards")
                    return (
                      <div key={k} className={className}>
                        {ds.map((d) => (
                          <DeliverableCard
                            key={d.id}
                            d={d}
                            owner={agentById(state, d.owner)}
                            selected={selected === d.id}
                            onOpen={select}
                          />
                        ))}
                      </div>
                    );
                  return (
                    <div key={k} className={className}>
                      {ds.length > 0 && (
                        <button
                          type="button"
                          className={cls("hc", worstStatus(ds))}
                          title={ds
                            .map(
                              (d) =>
                                `${d.code || "—"} ${d.title || "Untitled"} · ${STATUS_LABEL[d.status]}`,
                            )
                            .join("\n")}
                          aria-label={`${plural(ds.length, "deliverable")} of ${row.title} ${whereOf(c)} — zoom in`}
                          aria-expanded={false}
                          onClick={() => toggleZoom(row.id, k)}
                        >
                          <i aria-hidden />
                          {ds.length}
                        </button>
                      )}
                    </div>
                  );
                })}
              </Fragment>
            ))}
          </div>
          <div className="legend" aria-label="How to read the plan">
            <span>
              <b>{mode === "cards" ? "Cards" : "Cells"}</b>{" "}
              {mode === "cards"
                ? "are deliverables — click one to inspect it:"
                : "count deliverables landing there — click one to zoom in:"}
              <i className="DELIVERED" />
              {mode === "cards" ? "delivered" : "all delivered"}
              <i className="IN_PROGRESS" />
              in progress
              <i className="BLOCKED" />
              blocked
              <i />
              to do
            </span>
            {compact && (
              <>
                <span className="sep" />
                <span>
                  <b>Done</b> and <b>Later</b> gather the milestones outside the
                  next {win.shown.length}
                </span>
              </>
            )}
            <span className="sep" />
            <span>
              <b>Unscheduled / Unfunded</b> gutters appear only while something
              still needs a date or a payer
            </span>
          </div>
        </>
      )}
    </section>
  );
}
