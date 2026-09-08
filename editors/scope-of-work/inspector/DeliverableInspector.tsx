import {
  actions,
  type Deliverable,
  type ScopeOfWorkAction,
} from "document-models/scope-of-work";
import { generateId } from "document-model/core";
import { useEffect, useRef, useState } from "react";
import { goalRollup } from "../../shared/project-status.js";
import { LinkedWbsReader, subtreeOf } from "../lib/linked-wbs.js";
import {
  Badges,
  CopyableId,
  Field,
  NumberInput,
  StatusChip,
} from "../components/ui.js";
import { useEditor } from "../lib/context.js";
import {
  DELIVERABLE_STATUSES,
  STATUS_LABEL,
  allMilestones,
  budgetOf,
  costOf,
  deliverableById,
  isClosed,
  isOneOf,
  milestoneOf,
  money,
  pctOf,
  progressKind,
  projectOf,
  type ProgressKind,
  isFixedBudget,
  isPinned,
  num,
  pct,
  LOCKED_HINT,
  isEditable,
} from "../lib/model.js";

export function DeliverableInspector({ id }: { id: string }) {
  const { state } = useEditor();
  const d = deliverableById(state, id);
  if (!d) return null;
  return <InspectorBody d={d} />;
}

function InspectorBody({ d }: { d: Deliverable }) {
  const {
    state,
    dispatch,
    select,
    inspectorLayout,
    toggleInspectorLayout,
    confirm,
    go,
  } = useEditor();
  const p = projectOf(state, d.id);
  const m = milestoneOf(state, d.id);
  // Execution: the WBS is reached through the funding envelope (project.wbsRef);
  // a deliverable then names the goal whose subtree delivers it (goalRef).
  const wbsRef = p?.wbsRef ?? null;
  const linkGoal = (goalRef: string) =>
    dispatch(actions.linkDeliverableGoal({ deliverableId: d.id, goalRef: goalRef || null }));
  const closed = isClosed(d);
  const kind = progressKind(d);
  const cost = costOf(d);
  const budget = budgetOf(d);
  const [code, setCode] = useDraft(d.code);
  const [title, setTitle] = useDraft(d.title);
  const [description, setDescription] = useDraft(d.description);

  const setKind = (k: ProgressKind) => {
    if (closed) return;
    dispatch(
      actions.setDeliverableProgress({
        id: d.id,
        workProgress:
          k === "pct"
            ? { percentage: 0 }
            : k === "sp"
              ? { storyPoints: { total: 10, completed: 0 } }
              : { done: false },
      }),
    );
  };
  const schedule = (milestoneId: string) => {
    const batch: ScopeOfWorkAction[] = [];
    if (m)
      batch.push(
        actions.removeDeliverableInSet({
          milestoneId: m.milestone.id,
          deliverableId: d.id,
        }),
      );
    if (milestoneId)
      batch.push(
        actions.addDeliverableInSet({ milestoneId, deliverableId: d.id }),
      );
    if (batch.length) dispatch(batch);
  };
  const fund = (projectId: string) => {
    const batch: ScopeOfWorkAction[] = [];
    if (p)
      batch.push(
        actions.removeDeliverableInSet({
          projectId: p.id,
          deliverableId: d.id,
        }),
      );
    if (projectId)
      batch.push(
        actions.addDeliverableInSet({ projectId, deliverableId: d.id }),
      );
    if (batch.length) dispatch(batch);
  };
  const quote = (patch: {
    unit?: "Hours" | "StoryPoints";
    unitCost?: number;
    quantity?: number;
    margin?: number;
    marginPinned?: boolean;
  }) =>
    dispatch(
      actions.setDeliverableBudgetAnchorProject({
        deliverableId: d.id,
        ...patch,
      }),
    );
  const remove = async () => {
    const ok = await confirm({
      title: "Remove deliverable",
      body: `Remove "${d.title || "this deliverable"}" from every project and milestone?`,
    });
    if (!ok) return;
    dispatch(actions.removeDeliverable({ id: d.id }));
    select(null);
  };

  return (
    <>
      <div className="insp-hd">
        {/* `.insp-hd .eyebrow` is already flex/space-between, so the
            label and the id share a left group rather than becoming
            flex siblings of the window buttons. minWidth:0 lets the id
            ellipsise in the narrow side panel; it shows in full in the
            modal, and copies in full either way. */}
        <div className="eyebrow">
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              minWidth: 0,
            }}
          >
            <span>Deliverable</span>
            <CopyableId
              id={d.id}
              label="Deliverable id (inside this scope of work)"
            />
          </span>
          <span style={{ display: "inline-flex", gap: 10 }}>
            <button
              className="x"
              onClick={toggleInspectorLayout}
              title={
                inspectorLayout === "modal"
                  ? "Dock to the side panel — remembered as your default"
                  : "Open as a modal — remembered as your default"
              }
              aria-label={
                inspectorLayout === "modal"
                  ? "Dock inspector to the side panel"
                  : "Open inspector as a modal"
              }
            >
              {inspectorLayout === "modal" ? "⤡" : "⤢"}
            </button>
            <button
              className="x"
              onClick={() => select(null)}
              title="Close (Esc)"
              aria-label="Close inspector"
            >
              ×
            </button>
          </span>
        </div>
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            marginTop: 6,
          }}
        >
          <input
            className="in mono"
            style={{ width: 90 }}
            value={code}
            placeholder="CODE"
            aria-label="Code"
            onChange={(e) => setCode(e.target.value)}
            onBlur={() => {
              if (code !== d.code)
                dispatch(actions.editDeliverable({ id: d.id, code }));
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
          <input
            className="in"
            style={{ flex: 1, fontWeight: 600 }}
            value={title}
            placeholder="What will be delivered?"
            aria-label="Title"
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              if (title !== d.title)
                dispatch(actions.editDeliverable({ id: d.id, title }));
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
        </div>
        <div
          style={{
            marginTop: 8,
            display: "flex",
            gap: 6,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <StatusChip status={d.status} />
          <Badges state={state} deliverable={d} />
        </div>
      </div>

      <div className="insp-body">
        <div className="col">
          <div className="field two">
            <Field label="Status">
              <select
                className="in"
                value={d.status}
                onChange={(e) => {
                  if (isOneOf(DELIVERABLE_STATUSES, e.target.value))
                    dispatch(
                      actions.editDeliverable({
                        id: d.id,
                        status: e.target.value,
                      }),
                    );
                }}
              >
                {DELIVERABLE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Owner">
              <select
                className="in"
                value={d.owner ?? ""}
                onChange={(e) =>
                  dispatch(
                    actions.editDeliverable({
                      id: d.id,
                      owner: e.target.value || null,
                    }),
                  )
                }
              >
                <option value="">Unassigned</option>
                {state.contributors.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="field">
            <Field label="Description">
              <textarea
                className="in"
                value={description}
                placeholder="What does done look like?"
                onChange={(e) => setDescription(e.target.value)}
                onBlur={() => {
                  if (description !== d.description)
                    dispatch(
                      actions.editDeliverable({ id: d.id, description }),
                    );
                }}
              />
            </Field>
          </div>

          <div className="insp-sec">Progress</div>
          <div className="field">
            <div className="seg" role="tablist" aria-label="Progress kind">
              {(
                [
                  ["pct", "Percent"],
                  ["sp", "Story points"],
                  ["bin", "Done / not done"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  className={kind === k ? "on" : ""}
                  onClick={() => setKind(k)}
                  disabled={closed}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <ProgressEditor id={d.id} kind={kind} closed={closed} />
          <div className={`hint ${closed ? "err" : ""}`}>
            {closed
              ? "Closed deliverables don't accept progress. Change the status to reopen it."
              : "Reaching 100% (or all points, or done) sets the status to Delivered automatically."}
          </div>
        </div>
        <div className="col">
          <div className="insp-sec">Placement</div>
          <div className="field two">
            <Field label="Milestone (when)">
              <select
                className="in"
                value={m?.milestone.id ?? ""}
                onChange={(e) => schedule(e.target.value)}
              >
                <option value="">Unscheduled</option>
                {allMilestones(state).map((x) => (
                  <option key={x.milestone.id} value={x.milestone.id}>
                    {x.milestone.sequenceCode} · {x.milestone.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Project (who pays)">
              <select
                className="in"
                value={p?.id ?? ""}
                onChange={(e) => fund(e.target.value)}
              >
                <option value="">Unfunded</option>
                {state.projects.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.code} · {x.title}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="insp-sec">Execution</div>
          <div className="field">
            <Field label="Goal (what delivers it)">
              {!p ? (
                <div className="hint">Fund this deliverable first — the WBS belongs to the project that pays.</div>
              ) : !wbsRef ? (
                <div className="hint">
                  {p.code} has no work breakdown structure yet. Create or link one on the project page.
                </div>
              ) : (
                <LinkedWbsReader wbsRef={wbsRef}>
                  {({ goals, missingRef }) => {
                    if (missingRef) {
                      return <div className="hint err">The linked WBS could not be loaded. Repair it on the project page.</div>;
                    }
                    const topGoals = goals.filter((g) => !g.parentId);
                    const linkedGoal = d.goalRef ? goals.find((g) => g.id === d.goalRef) : undefined;
                    const progress = linkedGoal ? goalRollup([linkedGoal, ...subtreeOf(goals, linkedGoal.id)]) : null;
                    return (
                      <>
                        <select className="in" value={d.goalRef ?? ""} onChange={(e) => linkGoal(e.target.value)}>
                          <option value="">Not linked to a goal</option>
                          {topGoals.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.description}
                            </option>
                          ))}
                          {linkedGoal && !topGoals.some((g) => g.id === linkedGoal.id) && (
                            <option value={linkedGoal.id}>{linkedGoal.description}</option>
                          )}
                        </select>
                        {progress && (
                          <div className="hint" style={{ display: "flex", gap: 10, alignItems: "center" }}>
                            <span>
                              {progress.finished}/{progress.total} goals done
                              {progress.blocked > 0 ? ` · ${progress.blocked} blocked` : ""}
                            </span>
                            <button
                              type="button"
                              className="btn ghost sm"
                              onClick={() => {
                                select(null);
                                go({ kind: "wbs", projectId: p.id });
                              }}
                            >
                              Open work breakdown →
                            </button>
                          </div>
                        )}
                      </>
                    );
                  }}
                </LinkedWbsReader>
              )}
            </Field>
          </div>

          <div className="insp-sec">Quote</div>
          <div className="field three">
            <Field label="Unit">
              <select
                className="in"
                value={d.budgetAnchor?.unit ?? "Hours"}
                onChange={(e) =>
                  quote({
                    unit:
                      e.target.value === "StoryPoints"
                        ? "StoryPoints"
                        : "Hours",
                  })
                }
              >
                <option value="Hours">Hours</option>
                <option value="StoryPoints">Story pts</option>
              </select>
            </Field>
            <Field label="Unit cost">
              <NumberInput
                ariaLabel="Unit cost"
                value={d.budgetAnchor?.unitCost ?? null}
                emptyAs={0}
                placeholder="0"
                onCommit={(unitCost) => quote({ unitCost })}
                onClear={() => quote({ unitCost: 0 })}
              />
            </Field>
            <Field label="Quantity">
              <NumberInput
                ariaLabel="Quantity"
                value={d.budgetAnchor?.quantity ?? null}
                emptyAs={0}
                placeholder="0"
                onCommit={(quantity) => quote({ quantity })}
                onClear={() => quote({ quantity: 0 })}
              />
            </Field>
          </div>
          <MarginSlider
            value={d.budgetAnchor?.margin ?? 0}
            onCommit={(margin) => quote({ margin })}
          />
          <div className="calc">
            <div>
              <span>cost</span>
              <span>
                {d.budgetAnchor
                  ? `${num(d.budgetAnchor.unitCost)} × ${num(d.budgetAnchor.quantity)} = ${money(cost, p?.currency)}`
                  : "—"}
              </span>
            </div>
            <div>
              <span>margin</span>
              <span>
                {d.budgetAnchor
                  ? `${d.budgetAnchor.margin < 0 ? "−" : "+"} ${pct(Math.abs(d.budgetAnchor.margin))} = ${money(budget - cost, p?.currency)}`
                  : "—"}
              </span>
            </div>
            <div className="tot">
              <span>budget</span>
              <span>{money(budget, p?.currency)}</span>
            </div>
          </div>
          {p && isFixedBudget(p) && d.budgetAnchor && (
            <div className="hint">
              {isPinned(d) ? (
                <>
                  Margin pinned by you.{" "}
                  <button
                    style={{ color: "var(--focus)", fontWeight: 500 }}
                    onClick={() => quote({ marginPinned: false })}
                  >
                    Let {p.code}'s fixed budget derive it
                  </button>
                </>
              ) : (
                <>
                  Margin derived from {p.code}'s fixed budget
                  {d.budgetAnchor.margin < 0 ? (
                    <span className="err"> — over budget</span>
                  ) : (
                    ""
                  )}
                  .{" "}
                  <button
                    style={{ color: "var(--focus)", fontWeight: 500 }}
                    onClick={() => quote({ marginPinned: true })}
                  >
                    Pin at {pct(d.budgetAnchor.margin)}
                  </button>
                </>
              )}
            </div>
          )}
          {!p && d.budgetAnchor && cost > 0 && (
            <div className="hint err">
              Quoted but unfunded — pick a project so this budget rolls up
              somewhere.
            </div>
          )}

          <div className="insp-sec">Key results</div>
          <KeyResults id={d.id} />
        </div>
      </div>
      <div className="danger">
        <span>
          {isEditable(state) ? (
            <>
              Funded by {p ? p.code : "no project"} · <kbd>Esc</kbd> closes
            </>
          ) : (
            LOCKED_HINT
          )}
        </span>
        <button
          onClick={() => {
            void remove();
          }}
          disabled={!isEditable(state)}
        >
          Remove deliverable
        </button>
      </div>
    </>
  );
}

/** Local draft that resyncs when the document value changes underneath it. */
function useDraft(value: string): [string, (v: string) => void] {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return [draft, setDraft];
}

function ProgressEditor({
  id,
  kind,
  closed,
}: {
  id: string;
  kind: ProgressKind;
  closed: boolean;
}) {
  const { state, dispatch } = useEditor();
  const d = deliverableById(state, id);
  if (!d) return null;
  const p = d.workProgress;
  const set = (workProgress: {
    percentage?: number;
    storyPoints?: { total: number; completed: number };
    done?: boolean;
  }) => dispatch(actions.setDeliverableProgress({ id, workProgress }));

  if (kind === "sp") {
    const total = p?.total ?? 0,
      completed = p?.completed ?? 0;
    return (
      <div className="field two">
        <Field label="Completed">
          <NumberInput
            ariaLabel="Story points completed"
            decimals={0}
            value={completed}
            onCommit={(c) => set({ storyPoints: { total, completed: c } })}
          />
        </Field>
        <Field label="Total">
          <NumberInput
            ariaLabel="Story points total"
            decimals={0}
            value={total}
            onCommit={(t) =>
              set({
                storyPoints: { total: t, completed: Math.min(completed, t) },
              })
            }
          />
        </Field>
      </div>
    );
  }
  if (kind === "bin") {
    return (
      <div className="field">
        <label
          className={`ck ${p?.done ? "ok" : ""}`}
          style={{ cursor: closed ? "default" : "pointer" }}
        >
          <i>{p?.done ? "✓" : ""}</i>
          <input
            type="checkbox"
            checked={p?.done ?? false}
            disabled={closed}
            style={{ display: "none" }}
            onChange={(e) => set({ done: e.target.checked })}
          />
          Mark as delivered
        </label>
      </div>
    );
  }
  return (
    <PercentSlider
      value={pctOf(d)}
      disabled={closed}
      onCommit={(percentage) => set({ percentage })}
    />
  );
}

/** Slider that shows the live value and commits once the user stops dragging. */
function PercentSlider({
  value,
  disabled,
  onCommit,
}: {
  value: number;
  disabled: boolean;
  onCommit: (v: number) => void;
}) {
  const [v, setV] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setV(value), [value]);
  const change = (n: number) => {
    setV(n);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (n !== value) onCommit(n);
    }, 350);
  };
  return (
    <div className="field">
      <input
        type="range"
        className="range"
        max={100}
        value={v}
        disabled={disabled}
        aria-label="Percent complete"
        onChange={(e) => change(Number(e.target.value))}
      />
      <div
        className="mono muted"
        style={{ display: "flex", justifyContent: "space-between" }}
      >
        <span>0%</span>
        <b style={{ color: "var(--ink)" }}>{Math.round(v)}%</b>
        <span>100%</span>
      </div>
    </div>
  );
}

function MarginSlider({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (v: number) => void;
}) {
  const [v, setV] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setV(value), [value]);
  const change = (n: number) => {
    setV(n);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (n !== value) onCommit(n);
    }, 350);
  };
  return (
    <div className="field">
      <span className="lbl">
        Margin <span className="faint">%</span>
      </span>
      <input
        type="range"
        className="range"
        min={Math.min(0, Math.floor(value))}
        max={100}
        step={0.5}
        value={v}
        aria-label="Margin percent"
        onChange={(e) => change(Number(e.target.value))}
      />
      <div
        className={`mono muted ${v < 0 ? "err" : ""}`}
        style={{ textAlign: "right" }}
      >
        {pct(v)}
      </div>
    </div>
  );
}

function KeyResults({ id }: { id: string }) {
  const { state, dispatch, confirm } = useEditor();
  const d = deliverableById(state, id);
  const [title, setTitle] = useState("");
  const [link, setLink] = useState("");
  if (!d) return null;
  const add = () => {
    const t = title.trim();
    if (!t) return;
    dispatch(
      actions.addKeyResult({
        id: generateId(),
        deliverableId: d.id,
        title: t,
        link: link.trim() || undefined,
      }),
    );
    setTitle("");
    setLink("");
  };
  return (
    <div className="krs">
      {d.keyResults.map((k) => (
        <div key={k.id} className="kr">
          <span>{k.title}</span>
          {k.link && (
            <a href={k.link} target="_blank" rel="noreferrer">
              link
            </a>
          )}
          <button
            className="x"
            title="Remove key result"
            aria-label={`Remove ${k.title}`}
            onClick={() => {
              void (async () => {
                const ok = await confirm({
                  title: "Remove key result",
                  body: `Remove "${k.title}"?`,
                });
                if (!ok) return;
                dispatch(
                  actions.removeKeyResult({ id: k.id, deliverableId: d.id }),
                );
              })();
            }}
          >
            ×
          </button>
        </div>
      ))}
      <div className="kr">
        <input
          value={title}
          placeholder="+ Add key result"
          aria-label="Key result title"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
        />
        <input
          value={link}
          placeholder="link (optional)"
          aria-label="Key result link"
          style={{ maxWidth: 120 }}
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
        />
        {title.trim() && (
          <button className="btn sm" onClick={add}>
            Add
          </button>
        )}
      </div>
    </div>
  );
}
