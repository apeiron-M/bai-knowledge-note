import { actions } from "document-models/scope-of-work";
import { generateId } from "document-model/core";
import { Avatar, Bar, CopyableId, StatusChip } from "../components/ui.js";
import { useEditor } from "../lib/context.js";
import {
  agentById,
  budgetsByCurrency,
  dateFmt,
  isFixedBudget,
  isOverBudget,
  milestoneOf,
  money,
  pct,
  projectOf,
  scopePct,
  slugify,
  sumCost,
} from "../lib/model.js";

/**
 * Every envelope in one table — who pays, for how much, how far along, and
 * where its work lands next. Eight columns, one of them wide: the ledger's
 * idiom of a primary cell with a sub-line carries owner, budget type, counts
 * and spend without a column each, which is what keeps the title readable
 * at the width the canvas actually has with the inspector docked.
 *
 * Totals are one footer row per currency; the per-currency budget is the same
 * figure the Overview's Budget KPI shows, so the two never disagree. Payer-less
 * deliverables are not a row (an envelope is a payer); they get one line and a
 * link to the Unfunded filter.
 */
export function ProjectsView() {
  const { state, dispatch, go, today, documentId } = useEditor();
  const ps = state.projects;
  const t = today.toISOString().slice(0, 10);
  const funded = ps.reduce((n, p) => n + (p.scope?.deliverables.length ?? 0), 0);
  const unfunded = state.deliverables.filter((d) => !projectOf(state, d.id)).length;
  const budgets = budgetsByCurrency(state);

  // one footer row per currency, in the order envelopes introduce them
  const currencies: string[] = [];
  const costs: Record<string, number> = {};
  for (const p of ps) {
    const cur = p.currency ?? "USD";
    if (!currencies.includes(cur)) currencies.push(cur);
    costs[cur] = (costs[cur] ?? 0) + sumCost(state, p.scope?.deliverables ?? []);
  }

  const add = () => {
    const id = generateId();
    dispatch(
      actions.addProject({
        id,
        code: "NEW",
        title: "New project",
        slug: slugify("new-project", id),
      }),
    );
    go({ kind: "project", id });
  };

  const summary =
    ps.length === 0
      ? "Projects are the envelopes that pay for deliverables."
      : `${ps.length} project${ps.length === 1 ? "" : "s"} funding ${funded} deliverable${funded === 1 ? "" : "s"}` +
        (unfunded > 0
          ? `. ${unfunded} deliverable${unfunded === 1 ? " has" : "s have"} no payer yet.`
          : ".");

  return (
    <div className="doc">
      <div className="eyebrow eyebrow-row">
        <span>Projects</span>
        <CopyableId id={documentId} label="Scope of work id" />
      </div>
      <h1 className="title">Projects</h1>
      <p className="desc">{summary}</p>
      <div className="toolbar">
        <button className="btn sm" onClick={add}>
          Add project
        </button>
      </div>

      <section className="section">
        {ps.length === 0 ? (
          <div className="card empty">
            <b>No projects yet</b>Add one, then fund deliverables from it.
          </div>
        ) : (
          <div className="rows scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Code</th>
                  <th className="grow primary">Project</th>
                  <th className="num">Budget</th>
                  <th className="num">Cost</th>
                  <th className="prog">Progress</th>
                  <th>Next</th>
                  <th>Set</th>
                  <th>WBS</th>
                </tr>
              </thead>
              <tbody>
                {ps.map((p) => {
                  const ids = p.scope?.deliverables ?? [];
                  const owner = agentById(state, p.projectOwner ?? "");
                  const fixed = isFixedBudget(p);
                  const over = isOverBudget(state, p);
                  const completed = p.scope?.deliverablesCompleted;
                  const blocked = state.deliverables.filter(
                    (d) => ids.includes(d.id) && d.status === "BLOCKED",
                  ).length;
                  const cost = sumCost(state, ids);
                  const exp = p.expenditure ?? { actuals: 0, cap: 0, percentage: 0 };
                  const spendBase = exp.cap > 0 ? exp.cap : (p.budget ?? 0);
                  const overspent = spendBase > 0 && exp.actuals > spendBase;
                  // flatMap narrows where a filter predicate would not
                  const next = ids
                    .flatMap((id) => {
                      const m = milestoneOf(state, id)?.milestone;
                      return m && m.deliveryTarget >= t ? [m] : [];
                    })
                    .sort((a, b) => a.deliveryTarget.localeCompare(b.deliveryTarget))
                    .at(0);
                  const open = () => go({ kind: "project", id: p.id });
                  return (
                    <tr
                      key={p.id}
                      tabIndex={0}
                      onClick={open}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          open();
                        }
                      }}
                    >
                      <td className="mono faint code">{p.code || "—"}</td>
                      <td className="grow primary">
                        <div className="t" title={p.title}>
                          {p.title || <span className="faint">Untitled project</span>}
                        </div>
                        <div className="sub">
                          {owner ? (
                            <span className="owner">
                              <Avatar agent={owner} />
                              <span>{owner.name}</span>
                            </span>
                          ) : (
                            <span className="faint">Unassigned</span>
                          )}
                          {" · "}
                          {p.budgetType ?? "OPEX"}
                          {" · "}
                          {ids.length} deliverable{ids.length === 1 ? "" : "s"}
                          {blocked > 0 && (
                            <>
                              {" · "}
                              <span className="err">{blocked} blocked</span>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="num">
                        {money(p.budget ?? 0, p.currency)}
                        <div className="prog-sub">
                          {fixed ? "Fixed" : "derived"}
                          {over && (
                            <>
                              {" · "}
                              <span className="err">over budget</span>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="num">
                        {ids.length > 0 ? money(cost, p.currency) : <span className="faint">—</span>}
                        {exp.actuals > 0 && (
                          <div className="prog-sub">
                            spent {money(exp.actuals, p.currency)}
                            {spendBase > 0 && (
                              <>
                                {" · "}
                                {pct(exp.percentage)} of {exp.cap > 0 ? "cap" : "budget"}
                              </>
                            )}
                            {overspent && (
                              <>
                                {" · "}
                                <span className="err">over</span>
                              </>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="prog">
                        {ids.length > 0 ? (
                          <>
                            <Bar pct={scopePct(p.scope)} />
                            <div className="prog-sub">
                              {completed
                                ? `${completed.completed}/${completed.total} delivered`
                                : "—"}
                            </div>
                          </>
                        ) : (
                          <span className="faint">—</span>
                        )}
                      </td>
                      <td title={next?.title}>
                        {next ? (
                          <>
                            <span className="mono faint">{next.sequenceCode}</span>{" "}
                            {dateFmt(next.deliveryTarget)}
                          </>
                        ) : (
                          <span className="faint">
                            {ids.length === 0 ? "nothing funded" : "nothing scheduled"}
                          </span>
                        )}
                      </td>
                      <td>
                        {p.scope?.status ? (
                          <StatusChip status={p.scope.status} />
                        ) : (
                          <span className="faint">—</span>
                        )}
                      </td>
                      <td>
                        {p.wbsRef ? (
                          <button
                            className="btn sm ghost"
                            title="Open the work breakdown"
                            onClick={(e) => {
                              e.stopPropagation();
                              go({ kind: "wbs", projectId: p.id });
                            }}
                          >
                            WBS
                          </button>
                        ) : (
                          <span className="faint">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                {currencies.map((cur) => (
                  <tr key={cur}>
                    <td />
                    <td className="grow primary">Total · {cur}</td>
                    <td className="num">{money(budgets[cur] ?? 0, cur)}</td>
                    <td className="num">{money(costs[cur] ?? 0, cur)}</td>
                    <td />
                    <td />
                    <td />
                    <td />
                  </tr>
                ))}
              </tfoot>
            </table>
          </div>
        )}
        {unfunded > 0 && (
          <p className="hint" style={{ padding: 0, marginTop: 8 }}>
            {unfunded} deliverable{unfunded === 1 ? " has" : "s have"} no payer.{" "}
            <button
              className="btn sm ghost"
              onClick={() =>
                go({ kind: "deliverables", filters: { project: "__none" } })
              }
            >
              Show unfunded
            </button>
          </p>
        )}
      </section>
    </div>
  );
}
