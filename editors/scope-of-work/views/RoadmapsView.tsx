import { actions } from "document-models/scope-of-work";
import { generateId } from "document-model/core";
import { useState } from "react";
import { Avatar, Bar, CopyableId, MoneyStack } from "../components/ui.js";
import { useEditor } from "../lib/context.js";
import {
  agentById,
  budgetsByCurrencyFor,
  dateFmt,
  isOverdue,
  milestoneState,
  nextMilestone,
  rollup,
  slugify,
} from "../lib/model.js";

/**
 * Every roadmap in one table. A row is the roadmap; folded open, its
 * milestones follow as indented sub-rows in delivery order, each with the
 * spine's done/live dot so this reads as the same timeline the Overview draws.
 */
export function RoadmapsView() {
  const { state, dispatch, go, today, documentId } = useEditor();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const rms = state.roadmaps;
  const t = today.toISOString().slice(0, 10);

  const milestonesOf = (id: string) =>
    (rms.find((r) => r.id === id)?.milestones ?? [])
      .slice()
      .sort((a, b) =>
        (a.deliveryTarget || "9999").localeCompare(b.deliveryTarget || "9999"),
      );
  const total = rms.reduce((n, r) => n + r.milestones.length, 0);
  const done = rms.reduce(
    (n, r) =>
      n +
      r.milestones.filter((m) => milestoneState(state, m, today) === "done")
        .length,
    0,
  );
  const next = nextMilestone(state, today);
  const foldable = rms.filter((r) => r.milestones.length > 0);
  const allOpen = foldable.length > 0 && foldable.every((r) => open[r.id]);
  const toggleAll = () =>
    setOpen(Object.fromEntries(foldable.map((r) => [r.id, !allOpen])));
  const add = () => {
    const id = generateId();
    dispatch(
      actions.addRoadmap({
        id,
        title: "New roadmap",
        slug: slugify("new-roadmap", id),
      }),
    );
    go({ kind: "roadmap", id });
  };

  const summary =
    rms.length === 0
      ? "Roadmaps hold the dated milestones that work lands on."
      : `${rms.length} roadmap${rms.length === 1 ? "" : "s"}, ${total} milestone${total === 1 ? "" : "s"}, ${done} done` +
        (next
          ? `. Next: ${next.milestone.sequenceCode} ${next.milestone.title || "Untitled"} on ${dateFmt(next.milestone.deliveryTarget)}.`
          : ". Nothing is scheduled ahead.");

  return (
    <div className="doc">
      <div className="eyebrow eyebrow-row">
        <span>Roadmaps</span>
        <CopyableId id={documentId} label="Scope of work id" />
      </div>
      <h1 className="title">Roadmaps</h1>
      <p className="desc">{summary}</p>
      <div className="toolbar">
        <button className="btn sm" onClick={add}>
          Add roadmap
        </button>
        {foldable.length > 0 && (
          <button className="btn sm ghost" onClick={toggleAll}>
            {allOpen ? "Collapse all" : "Expand all"}
          </button>
        )}
      </div>

      <section className="section">
        {rms.length === 0 ? (
          <div className="card empty">
            <b>No roadmaps yet</b>Add one to start scheduling milestones.
          </div>
        ) : (
          <div className="rows scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th aria-label="Fold" />
                  <th className="grow primary">Roadmap</th>
                  <th className="num">Milestones</th>
                  <th>Next</th>
                  <th className="prog">Progress</th>
                  <th className="num">Budget</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rms.map((r) => {
                  const ms = milestonesOf(r.id);
                  const ids = ms.flatMap((m) => m.scope?.deliverables ?? []);
                  const ru = rollup(state, ids);
                  const rNext = ms.find(
                    (m) =>
                      m.deliveryTarget >= t &&
                      milestoneState(state, m, today) !== "done",
                  );
                  const isOpen = ms.length > 0 && Boolean(open[r.id]);
                  return [
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
                      <td className="fold">
                        {ms.length > 0 ? (
                          <button
                            type="button"
                            className={`chev ${isOpen ? "open" : ""}`}
                            aria-expanded={isOpen}
                            title={isOpen ? "Hide milestones" : "Show milestones"}
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpen((s) => ({ ...s, [r.id]: !isOpen }));
                            }}
                          >
                            ▸
                          </button>
                        ) : (
                          <span className="chev spacer" aria-hidden />
                        )}
                      </td>
                      <td className="grow primary">
                        <div className="t">
                          {r.title || <span className="faint">Untitled roadmap</span>}
                        </div>
                        <div className="sub">
                          {r.description || (
                            <span className="faint">No description</span>
                          )}
                        </div>
                      </td>
                      <td className="num">{ms.length}</td>
                      <td>
                        {rNext ? (
                          <>
                            <span className="mono faint">{rNext.sequenceCode}</span>{" "}
                            {rNext.title || "Untitled"}
                            <div className="prog-sub">
                              {dateFmt(rNext.deliveryTarget)}
                            </div>
                          </>
                        ) : (
                          <span className="faint">
                            {ms.length === 0 ? "no milestones" : "nothing scheduled"}
                          </span>
                        )}
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
                          <span className="faint">—</span>
                        )}
                      </td>
                      <td className="num">
                        {ids.length > 0 ? (
                          <MoneyStack byCur={budgetsByCurrencyFor(state, ids)} />
                        ) : (
                          <span className="faint">—</span>
                        )}
                      </td>
                      <td className="end">
                        <button
                          className="btn sm ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            go({ kind: "roadmap", id: r.id });
                          }}
                        >
                          Open
                        </button>
                      </td>
                    </tr>,
                    ...(isOpen
                      ? ms.map((m) => {
                          const mids = m.scope?.deliverables ?? [];
                          const mru = rollup(state, mids);
                          const st = milestoneState(state, m, today);
                          const late = isOverdue(state, m, today);
                          return (
                            <tr
                              key={m.id}
                              className="sub"
                              tabIndex={0}
                              onClick={(e) => {
                                e.stopPropagation();
                                go({ kind: "milestone", id: m.id });
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  go({ kind: "milestone", id: m.id });
                                }
                              }}
                            >
                              <td className="fold" />
                              <td className="grow primary">
                                <div className="t">
                                  <span
                                    className={`msdot ${st}${late ? " overdue" : ""}`}
                                    aria-hidden
                                  />
                                  <span className="mono faint">
                                    {m.sequenceCode}
                                  </span>{" "}
                                  {m.title || (
                                    <span className="faint">Untitled</span>
                                  )}
                                </div>
                                {m.coordinators.length > 0 && (
                                  <div className="sub">
                                    <span className="avs">
                                      {m.coordinators.map((c) => (
                                        <Avatar
                                          key={c}
                                          agent={agentById(state, c)}
                                          title={c}
                                        />
                                      ))}
                                    </span>
                                  </div>
                                )}
                              </td>
                              <td className="num">
                                <span className="muted">
                                  {mids.length} deliverable
                                  {mids.length === 1 ? "" : "s"}
                                </span>
                              </td>
                              <td>
                                {dateFmt(m.deliveryTarget)}
                                {st === "done" && (
                                  <div className="prog-sub">done</div>
                                )}
                                {st === "live" && (
                                  <div className="prog-sub">next up</div>
                                )}
                                {late && (
                                  <div className="prog-sub ember">overdue</div>
                                )}
                              </td>
                              <td className="prog">
                                {mru.total > 0 ? (
                                  <>
                                    <Bar pct={mru.pct} />
                                    <div className="prog-sub">
                                      {mru.done}/{mru.total} delivered
                                    </div>
                                  </>
                                ) : (
                                  <span className="faint">—</span>
                                )}
                              </td>
                              <td className="num">
                                {mids.length > 0 ? (
                                  <MoneyStack byCur={budgetsByCurrencyFor(state, mids)} />
                                ) : (
                                  <span className="faint">—</span>
                                )}
                              </td>
                              <td className="end">
                                <button
                                  className="btn sm ghost"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    go({ kind: "milestone", id: m.id });
                                  }}
                                >
                                  Open
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      : []),
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
