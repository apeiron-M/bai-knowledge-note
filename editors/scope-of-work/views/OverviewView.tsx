import {
  actions,
  type Deliverable,
  type Project,
} from "document-models/scope-of-work";
import { useEditor } from "../lib/context.js";
import {
  SOW_STATUSES,
  budgetsByCurrency,
  checklist,
  dateFmt,
  deliverablesIn,
  isOneOf,
  milestoneOf,
  milestoneState,
  money,
  moneyList,
  nextMilestone,
  projectOf,
  rollup,
  scopePct,
  sortedMilestones,
  STATUS_LABEL,
  isClosed,
} from "../lib/model.js";
import { Avatar, Bar, InlineText, Kpi } from "../components/ui.js";
import { agentById } from "../lib/model.js";

export function OverviewView() {
  const { state, dispatch, go, today } = useEditor();
  const all = rollup(
    state,
    state.deliverables.map((d) => d.id),
  );
  const ms = sortedMilestones(state);
  const next = nextMilestone(state, today);
  const doneMs = ms.filter(
    (x) => milestoneState(state, x.milestone, today) === "done",
  ).length;
  const fill = ms.length > 1 ? (doneMs / (ms.length - 1)) * 100 : 0;
  const checks = checklist(state);
  const blocked = state.deliverables.filter(
    (d) => d.status === "BLOCKED",
  ).length;

  return (
    <div className="doc">
      <div className="eyebrow">Scope of work</div>
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
          value={moneyList(budgetsByCurrency(state))}
          sub={`${state.projects.length} project${state.projects.length === 1 ? "" : "s"} · derived from quotes`}
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
          sub={`delivered · ${blocked} blocked`}
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

      <section className="section">
        <div className="hd">
          <h2>Delivery</h2>
          <span className="muted">
            {ms.length} milestone{ms.length === 1 ? "" : "s"} across{" "}
            {state.roadmaps.length} roadmap
            {state.roadmaps.length === 1 ? "" : "s"}
          </span>
          <div className="grow" />
          {state.roadmaps[0] && (
            <button
              className="btn sm"
              onClick={() => go({ kind: "roadmap", id: state.roadmaps[0].id })}
            >
              Open roadmap
            </button>
          )}
        </div>
        {ms.length === 0 ? (
          <div className="card empty">
            <b>No milestones yet</b>Add a roadmap from the outline, then give it
            dated milestones.
          </div>
        ) : (
          <div className="spine">
            <div className="line" />
            <div className="fill" style={{ width: `${fill}%` }} />
            <div className="notches">
              {ms.map(({ milestone: m, roadmap: r }) => {
                const ru = rollup(state, m.scope?.deliverables ?? []);
                return (
                  <div
                    key={m.id}
                    className={`notch ${milestoneState(state, m, today)}`}
                  >
                    <span className="dot" />
                    <button onClick={() => go({ kind: "milestone", id: m.id })}>
                      <div className="code">
                        {m.sequenceCode} · {r.title}
                      </div>
                      <div className="t">{m.title || "Untitled"}</div>
                      <div className="d">
                        {dateFmt(m.deliveryTarget)} · {ru.done}/{ru.total} done
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <section className="section">
        <div className="hd">
          <h2>Plan</h2>
          <span className="muted">who funds what, and when it lands</span>
          <div className="grow" />
          <span className="faint" style={{ fontSize: 12 }}>
            click a card to inspect
          </span>
        </div>
        <PlanMatrix />
        <div className="legend" aria-label="How to read the plan">
          <span>
            <b>Rows</b> projects — who pays
          </span>
          <span className="sep" />
          <span>
            <b>Columns</b> milestones — when it lands
          </span>
          <span className="sep" />
          <span>
            <b>Cards</b> deliverables:
            <i className="DELIVERED" />
            delivered
            <i className="IN_PROGRESS" />
            in progress
            <i className="BLOCKED" />
            blocked
            <i />
            to do / draft
          </span>
          <span className="sep" />
          <span>
            <b>Unscheduled / Unfunded</b> gutters appear only while something
            still needs a date or a payer
          </span>
        </div>
      </section>

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

function PlanMatrix() {
  const { state, selected, select, today } = useEditor();
  const ms = sortedMilestones(state);
  type Col = { id: string; code: string; title: string; target?: string };
  const milestoneCols: Col[] = ms.map((x) => ({
    id: x.milestone.id,
    code: x.milestone.sequenceCode,
    title: x.milestone.title,
    target: x.milestone.deliveryTarget,
  }));
  const unfunded = state.deliverables
    .filter((d) => !projectOf(state, d.id))
    .map((d) => d.id);
  type Row = {
    project?: Project;
    id: string;
    code: string;
    title: string;
    ids: string[];
    currency: string | null | undefined;
  };
  const rows: Row[] = [
    ...state.projects.map((p) => ({
      project: p,
      id: p.id,
      code: p.code,
      title: p.title,
      ids: p.scope?.deliverables ?? [],
      currency: p.currency,
    })),
    ...(unfunded.length
      ? [
          {
            id: "__none",
            code: "",
            title: "Unfunded",
            ids: unfunded,
            currency: "USD",
          },
        ]
      : []),
  ];
  // the gutter column earns its place only when live work still needs a date;
  // canceled / won't-do deliverables have no place in a plan of what lands when
  const hasUnscheduled = rows.some((r) =>
    deliverablesIn(state, r.ids).some(
      (d) => !isClosed(d) && !milestoneOf(state, d.id),
    ),
  );
  const cols: Col[] = [
    ...(hasUnscheduled
      ? [{ id: "__none", code: "", title: "Unscheduled" }]
      : []),
    ...milestoneCols,
  ];
  const inCell = (row: Row, col: Col): Deliverable[] =>
    deliverablesIn(state, row.ids).filter((d) =>
      col.id === "__none"
        ? !milestoneOf(state, d.id)
        : milestoneOf(state, d.id)?.milestone.id === col.id,
    );

  if (state.projects.length === 0 && unfunded.length === 0) {
    return (
      <div className="card empty">
        <b>Nothing planned yet</b>Create a project from the outline and add
        deliverables to it.
      </div>
    );
  }
  void today;
  return (
    <div
      className="matrix"
      style={{
        gridTemplateColumns: `150px repeat(${cols.length}, minmax(0, 1fr))`,
      }}
    >
      <div className="c h" />
      {cols.map((c) => (
        <div key={c.id} className="c h">
          {c.code && (
            <>
              <span className="mono faint">{c.code}</span>{" "}
            </>
          )}
          <b>{c.title}</b>
          {c.target !== undefined && (
            <div className="faint" style={{ fontSize: 11 }}>
              {dateFmt(c.target)}
            </div>
          )}
        </div>
      ))}
      {rows.map((row) => (
        <RowCells
          key={row.id}
          row={row}
          cols={cols}
          inCell={inCell}
          selected={selected}
          select={select}
        />
      ))}
    </div>
  );

  function RowCells({
    row,
    cols,
    inCell,
    selected,
    select,
  }: {
    row: Row;
    cols: Col[];
    inCell: (r: Row, c: Col) => Deliverable[];
    selected: string | null;
    select: (id: string) => void;
  }) {
    return (
      <>
        <div className="c rh">
          {row.code && <span className="code">{row.code}</span>}
          <b>{row.title}</b>
          {row.project && (
            <>
              <div className="money">
                {money(row.project.budget ?? 0, row.currency)}
              </div>
              <div style={{ marginTop: 6 }}>
                <Bar pct={scopePct(row.project.scope)} />
              </div>
            </>
          )}
        </div>
        {cols.map((c) => (
          <div key={c.id} className="c">
            {inCell(row, c).map((d) => (
              <button
                key={d.id}
                className={`mini ${d.status} ${selected === d.id ? "sel" : ""}`}
                onClick={() => select(d.id)}
              >
                <span className="st" />
                <span className="code">{d.code}</span>
                <span className="t">{d.title || "Untitled"}</span>
                <Avatar agent={agentById(state, d.owner)} />
              </button>
            ))}
          </div>
        ))}
      </>
    );
  }
}
