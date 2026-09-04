import { actions } from "document-models/scope-of-work";
import { generateId } from "document-model/core";
import { useState } from "react";
import {
  Badges,
  InlineText,
  Kpi,
  NumberInput,
  StatusChip,
  decimalPattern,
} from "../components/ui.js";
import { useEditor } from "../lib/context.js";
import {
  BUDGET_TYPES,
  CURRENCIES,
  LOCKED_HINT,
  budgetOf,
  budgetVariance,
  costOf,
  deliverablesIn,
  derivedMargin,
  isEditable,
  isFixedBudget,
  isOneOf,
  isOverBudget,
  isPinned,
  linesBudget,
  milestoneOf,
  money,
  num,
  pct,
  scopePct,
  sumCost,
} from "../lib/model.js";
import { OverviewView } from "./OverviewView.js";
import {
  KnowledgeSection,
  ReferencesSection,
  WbsSection,
} from "./project/ExecutionSections.js";

export function ProjectView({ id }: { id: string }) {
  const { state, dispatch, go, selected, select, confirm } = useEditor();
  const p = state.projects.find((x) => x.id === id);
  const [draft, setDraft] = useState("");
  if (!p) return <OverviewView />;
  const ids = p.scope?.deliverables ?? [];
  const ds = deliverablesIn(state, ids);
  const cost = sumCost(state, ids);
  const budget = p.budget ?? 0;
  const fixed = isFixedBudget(p);
  const over = isOverBudget(state, p);
  const variance = budgetVariance(state, p);
  const derived = derivedMargin(state, p);
  const impliedMargin = cost > 0 ? (budget / cost - 1) * 100 : 0;
  const completed = p.scope?.deliverablesCompleted;
  const editable = isEditable(state);
  const exp = p.expenditure ?? { actuals: 0, cap: 0, percentage: 0 };
  const spendBase = exp.cap > 0 ? exp.cap : budget;
  const overspent = spendBase > 0 && exp.actuals > spendBase;

  const addDeliverable = () => {
    const deliverableId = generateId();
    dispatch(
      actions.addProjectDeliverable({
        projectId: p.id,
        deliverableId,
        title: "New deliverable",
      }),
    );
    select(deliverableId);
  };
  const commitBudget = () => {
    if (draft.trim() === "" || draft === ".") return;
    const n = Number(draft);
    if (Number.isNaN(n)) return;
    dispatch(actions.updateProject({ id: p.id, budget: n }));
    setDraft("");
  };
  const release = () =>
    dispatch(actions.updateProject({ id: p.id, budget: null }));
  const togglePin = (deliverableId: string, pinned: boolean) =>
    dispatch(
      actions.setDeliverableBudgetAnchorProject({
        deliverableId,
        marginPinned: !pinned,
      }),
    );
  const removeDeliverable = async (
    deliverableId: string,
    title: string,
  ) => {
    const ok = await confirm({
      title: "Remove deliverable",
      body: `Remove "${title || "this deliverable"}" from every project and milestone?`,
    });
    if (!ok) return;
    dispatch(actions.removeDeliverable({ id: deliverableId }));
  };
  const removeProject = async () => {
    const ok = await confirm({
      title: "Remove project",
      body: `Remove project ${p.code} "${p.title}" and every deliverable it funds?`,
    });
    if (!ok) return;
    dispatch(actions.removeProject({ projectId: p.id }));
    go({ kind: "overview" });
  };

  const budgetSub = fixed ? (
    over ? (
      <span className="err">
        over budget by {money(cost - (p.targetBudget ?? 0), p.currency)}
      </span>
    ) : derived !== null ? (
      `fixed · unpinned margins derived at ${pct(derived)}`
    ) : variance !== null && variance !== 0 ? (
      `fixed · lines total ${money(linesBudget(state, p), p.currency)} (${variance > 0 ? "+" : ""}${money(variance, p.currency)} unallocated)`
    ) : (
      "fixed · every margin pinned"
    )
  ) : cost > 0 ? (
    `derived from quotes · implied margin ${pct(impliedMargin)}`
  ) : (
    "derived from quotes · nothing quoted yet"
  );

  return (
    <div className="doc">
      <div className="eyebrow">Project</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
        <span
          className="mono"
          style={{ fontSize: 22, color: "var(--ink-3)", width: 90 }}
        >
          <InlineText
            ariaLabel="Project code"
            value={p.code}
            placeholder="CODE"
            onCommit={(code) =>
              dispatch(actions.updateProject({ id: p.id, code }))
            }
          />
        </span>
        <h1 className="title" style={{ flex: 1 }}>
          <InlineText
            ariaLabel="Project title"
            value={p.title}
            placeholder="Project title"
            onCommit={(title) =>
              dispatch(actions.updateProject({ id: p.id, title }))
            }
          />
        </h1>
      </div>
      <p className="desc">
        <InlineText
          ariaLabel="Abstract"
          multiline
          value={p.abstract ?? ""}
          placeholder="One line on what this project covers."
          onCommit={(abstract) =>
            dispatch(actions.updateProject({ id: p.id, abstract }))
          }
        />
      </p>

      <div className="toolbar">
        <label>
          Owner{" "}
          <select
            className="in sm"
            value={p.projectOwner ?? ""}
            onChange={(e) => {
              if (e.target.value)
                dispatch(
                  actions.updateProjectOwner({
                    id: p.id,
                    projectOwner: e.target.value,
                  }),
                );
            }}
          >
            <option value="">Unassigned</option>
            {state.contributors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Currency{" "}
          <select
            className="in sm"
            value={p.currency ?? "USD"}
            onChange={(e) => {
              if (isOneOf(CURRENCIES, e.target.value))
                dispatch(
                  actions.updateProject({ id: p.id, currency: e.target.value }),
                );
            }}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label>
          Budget type{" "}
          <select
            className="in sm"
            value={p.budgetType ?? "OPEX"}
            onChange={(e) => {
              if (isOneOf(BUDGET_TYPES, e.target.value))
                dispatch(
                  actions.updateProject({
                    id: p.id,
                    budgetType: e.target.value,
                  }),
                );
            }}
          >
            {BUDGET_TYPES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <span className="budgetctl">
          <span>Budget</span>
          {fixed ? (
            <span className="chip is-fixed">Fixed</span>
          ) : (
            <span className="faint">derived</span>
          )}
          <input
            type="text"
            inputMode="decimal"
            className="in sm mono"
            style={{ width: 120 }}
            value={draft}
            placeholder={fixed ? (p.targetBudget ?? 0).toFixed(2) : "fix at…"}
            aria-label={fixed ? "Project budget" : "Fix project budget"}
            onChange={(e) => {
              if (decimalPattern(2).test(e.target.value))
                setDraft(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitBudget();
            }}
            onBlur={() => {
              if (draft) commitBudget();
            }}
          />
          {fixed && (
            <button
              className="btn sm ghost"
              onClick={release}
              title="Let the budget follow the quotes again; margins stay as they are"
            >
              Release
            </button>
          )}
        </span>
      </div>

      <div className="kpis three">
        <Kpi
          label="Cost"
          value={money(cost, p.currency)}
          sub="Σ unit cost × quantity"
        />
        <Kpi
          label="Budget"
          value={
            <>
              {money(budget, p.currency)}
              {over && (
                <span
                  className="chip over"
                  style={{ marginLeft: 8, verticalAlign: "middle" }}
                >
                  Over budget
                </span>
              )}
            </>
          }
          sub={budgetSub}
        />
        <Kpi
          label="Progress"
          value={`${Math.round(scopePct(p.scope))}%`}
          sub={
            completed
              ? `${completed.completed}/${completed.total} delivered`
              : "—"
          }
        />
      </div>

      <section className="section">
        <div className="hd">
          <h2>Ledger</h2>
          <span className="muted">every deliverable this project funds</span>
          <div className="grow" />
          <button className="btn sm" onClick={addDeliverable}>
            + Add deliverable
          </button>
        </div>
        <div className="rows">
          <table className="tbl">
            <thead>
              <tr>
                <th>Code</th>
                <th className="grow">Deliverable</th>
                <th className="num">Unit × qty</th>
                <th className="num">Cost</th>
                <th className="num">Margin</th>
                <th className="num">Budget</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {ds.map((d) => {
                const m = milestoneOf(state, d.id);
                const a = d.budgetAnchor;
                const pinned = isPinned(d);
                return (
                  <tr
                    key={d.id}
                    tabIndex={0}
                    className={selected === d.id ? "sel" : ""}
                    onClick={() => select(d.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        select(d.id);
                      }
                    }}
                  >
                    <td className="mono faint code">{d.code || "—"}</td>
                    <td className="grow">
                      <div className="t">
                        {d.title || <span className="faint">Untitled</span>}{" "}
                        <Badges state={state} deliverable={d} />
                      </div>
                      <div className="sub">
                        <StatusChip status={d.status} />{" "}
                        {m ? `· ${m.milestone.sequenceCode}` : ""}
                      </div>
                    </td>
                    <td className="num muted">
                      {a
                        ? `${num(a.unitCost)} × ${num(a.quantity)} ${a.unit === "StoryPoints" ? "SP" : "h"}`
                        : "—"}
                    </td>
                    <td className="num">
                      {a ? money(costOf(d), p.currency) : "—"}
                    </td>
                    <td className="num">
                      {a ? (
                        fixed ? (
                          <button
                            className={`lock ${pinned ? "" : "derived"} ${a.margin < 0 ? "neg" : ""}`}
                            title={
                              pinned
                                ? "Pinned by you — click to let the fixed budget derive it"
                                : "Derived from the fixed budget — click to pin it at this value"
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              togglePin(d.id, pinned);
                            }}
                          >
                            {pct(a.margin)}{" "}
                            <small>{pinned ? "pinned" : "auto"}</small>
                          </button>
                        ) : (
                          pct(a.margin)
                        )
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="num">
                      {a ? money(budgetOf(d), p.currency) : "—"}
                    </td>
                    <td className="end">
                      {editable ? (
                        <button
                          className="rm"
                          title="Remove deliverable"
                          aria-label={`Remove ${d.title || "deliverable"}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            void removeDeliverable(d.id, d.title);
                          }}
                        >
                          ×
                        </button>
                      ) : (
                        <span
                          className="rm"
                          title={LOCKED_HINT}
                          aria-hidden="true"
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td />
                <td className="grow">Total</td>
                <td />
                <td className="num">{money(cost, p.currency)}</td>
                <td className="num">{cost > 0 ? pct(impliedMargin) : "—"}</td>
                <td className="num">{money(budget, p.currency)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
          {ds.length === 0 && (
            <div className="empty">
              <b>Nothing funded yet</b>Add a deliverable, or pick this project
              in another deliverable's inspector.
            </div>
          )}
        </div>
        <p className="hint" style={{ padding: 0, marginTop: 8 }}>
          {fixed
            ? "Fixed budget: the envelope is yours; every unpinned quote gets the margin that makes the lines add up to it. Margins you type are pinned and held. If everything is pinned, the total shows the envelope and the lines show what they cost."
            : "Derived budget: each line is unit cost × quantity × (1 + margin) and the total follows. Enter an amount in Budget to fix the envelope instead."}
        </p>
      </section>

      <section className="section">
        <div className="hd">
          <h2>Spending</h2>
          <span className="muted">
            what has actually been spent against this budget
          </span>
        </div>
        <div className="card spend">
          <div>
            <span className="lbl">Spent so far</span>
            <NumberInput
              ariaLabel="Actuals"
              value={exp.actuals}
              placeholder="0.00"
              onCommit={(actuals) =>
                dispatch(
                  actions.setProjectExpenditure({ projectId: p.id, actuals }),
                )
              }
            />
          </div>
          <div>
            <span className="lbl">
              Cap <span className="faint">(optional hard limit)</span>
            </span>
            <NumberInput
              ariaLabel="Spending cap"
              value={exp.cap > 0 ? exp.cap : null}
              placeholder="none"
              onCommit={(cap) =>
                dispatch(
                  actions.setProjectExpenditure({ projectId: p.id, cap }),
                )
              }
            />
          </div>
          <div>
            <span className="lbl">
              {pct(exp.percentage)} of {exp.cap > 0 ? "cap" : "budget"} ·{" "}
              {money(exp.actuals, p.currency)} of {money(spendBase, p.currency)}
              {overspent && (
                <span className="err">
                  {" "}
                  · over by {money(exp.actuals - spendBase, p.currency)}
                </span>
              )}
            </span>
            <div
              className={`bar ${overspent ? "signal" : ""}`}
              style={{ marginTop: 8 }}
            >
              <i style={{ width: `${Math.min(100, exp.percentage)}%` }} />
            </div>
          </div>
        </div>
        <p className="hint" style={{ padding: 0, marginTop: 8 }}>
          The percentage reads against the cap when one is set, otherwise
          against the project budget, and follows the budget as it changes.
        </p>
      </section>

      <WbsSection p={p} />
      <KnowledgeSection p={p} />
      <ReferencesSection p={p} />

      <div className="danger" style={{ margin: "40px 0 0" }}>
        <span>
          {editable
            ? "Removing a project deletes the deliverables it funds."
            : LOCKED_HINT}
        </span>
        <button
          onClick={() => {
            void removeProject();
          }}
          disabled={!editable}
        >
          Remove project
        </button>
      </div>
    </div>
  );
}
