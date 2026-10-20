import { actions } from "document-models/scope-of-work";
import { generateId } from "document-model/core";
import { DeliverableTable } from "../components/DeliverableRow.js";
import { Avatar, CopyableId, InlineText, Kpi, MoneyStack } from "../components/ui.js";
import { useEditor } from "../lib/context.js";
import {
  LOCKED_HINT,
  agentById,
  allMilestones,
  budgetsByCurrencyFor,
  dateFmt,
  deliverablesIn,
  isEditable,
  rollup,
} from "../lib/model.js";
import { OverviewView } from "./OverviewView.js";

export function MilestoneView({ id }: { id: string }) {
  const { state, dispatch, go, select, confirm } = useEditor();
  const ref = allMilestones(state).find((x) => x.milestone.id === id);
  if (!ref) return <OverviewView />;
  const { milestone: m, roadmap: r } = ref;
  const ids = m.scope?.deliverables ?? [];
  const ru = rollup(state, ids);
  const editable = isEditable(state);

  const addDeliverable = () => {
    const deliverableId = generateId();
    dispatch(
      actions.addMilestoneDeliverable({
        milestoneId: m.id,
        deliverableId,
        title: "New deliverable",
      }),
    );
    select(deliverableId);
  };
  const removeMilestone = async () => {
    const ok = await confirm({
      title: "Remove milestone",
      body: `Remove milestone ${m.sequenceCode} "${m.title}" and the deliverables it owns?`,
    });
    if (!ok) return;
    dispatch(actions.removeMilestone({ id: m.id, roadmapId: r.id }));
    go({ kind: "roadmap", id: r.id });
  };
  const removeCoordinator = async (id: string) => {
    const name = agentById(state, id)?.name ?? id;
    const ok = await confirm({
      title: "Remove coordinator",
      body: `Remove ${name} as coordinator of this milestone?`,
    });
    if (!ok) return;
    dispatch(actions.removeCoordinator({ id, milestoneId: m.id }));
  };

  return (
    <div className="doc">
      <div className="eyebrow eyebrow-row">
        <span>
          <button
            className="faint"
            onClick={() => go({ kind: "roadmap", id: r.id })}
            style={{
              font: "inherit",
              letterSpacing: "inherit",
              textTransform: "inherit",
            }}
          >
            {r.title}
          </button>{" "}
          · milestone
        </span>
        <CopyableId id={m.id} label="Milestone id (inside this scope of work)" />
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
        <span
          className="mono"
          style={{ fontSize: 22, color: "var(--ink-3)", width: 70 }}
        >
          <InlineText
            ariaLabel="Sequence code"
            value={m.sequenceCode}
            placeholder="M1"
            onCommit={(sequenceCode) =>
              dispatch(
                actions.editMilestone({
                  id: m.id,
                  roadmapId: r.id,
                  sequenceCode,
                }),
              )
            }
          />
        </span>
        <h1 className="title" style={{ flex: 1 }}>
          <InlineText
            ariaLabel="Milestone title"
            value={m.title}
            placeholder="Milestone title"
            onCommit={(title) =>
              dispatch(
                actions.editMilestone({ id: m.id, roadmapId: r.id, title }),
              )
            }
          />
        </h1>
      </div>
      <p className="desc">
        <InlineText
          ariaLabel="Milestone description"
          multiline
          value={m.description}
          placeholder="What has to be true at this milestone."
          onCommit={(description) =>
            dispatch(
              actions.editMilestone({ id: m.id, roadmapId: r.id, description }),
            )
          }
        />
      </p>

      <div className="toolbar">
        <label>
          Target{" "}
          <input
            type="date"
            className="in sm"
            value={m.deliveryTarget}
            onChange={(e) =>
              dispatch(
                actions.editMilestone({
                  id: m.id,
                  roadmapId: r.id,
                  deliveryTarget: e.target.value,
                }),
              )
            }
          />
        </label>
        <span>Coordinators</span>
        <span className="avs">
          {m.coordinators.map((c) => (
            <button
              key={c}
              title={`Remove ${agentById(state, c)?.name ?? c}`}
              onClick={() => {
                void removeCoordinator(c);
              }}
            >
              <Avatar agent={agentById(state, c)} title={c} />
            </button>
          ))}
        </span>
        <select
          className="in sm"
          value=""
          aria-label="Add coordinator"
          onChange={(e) => {
            if (e.target.value)
              dispatch(
                actions.addCoordinator({
                  id: e.target.value,
                  milestoneId: m.id,
                }),
              );
          }}
        >
          <option value="">+ add</option>
          {state.contributors
            .filter((a) => !m.coordinators.includes(a.id))
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </select>
      </div>

      <div className="kpis three">
        <Kpi
          label="Progress"
          value={`${Math.round(ru.pct)}%`}
          sub={
            ru.storyPoints
              ? `${ru.storyPoints.completed}/${ru.storyPoints.total} story points`
              : "average of deliverables"
          }
        />
        <Kpi
          label="Delivered"
          value={
            <>
              {ru.done}
              <span className="faint" style={{ fontSize: 18 }}>
                {" "}
                / {ru.total}
              </span>
            </>
          }
          sub={dateFmt(m.deliveryTarget)}
        />
        <Kpi
          label="Budget in this milestone"
          value={<MoneyStack byCur={budgetsByCurrencyFor(state, ids)} />}
          sub="sum of quotes, per currency"
        />
      </div>

      <section className="section">
        <div className="hd">
          <h2>Deliverables</h2>
          <div className="grow" />
          <button className="btn sm" onClick={addDeliverable}>
            + Add deliverable
          </button>
        </div>
        <div className="rows">
          <DeliverableTable items={deliverablesIn(state, ids)} />
          {ids.length === 0 && (
            <div className="empty">
              <b>Nothing scheduled here yet</b>Add a deliverable, or pick this
              milestone in another deliverable's inspector.
            </div>
          )}
        </div>
      </section>

      <div className="danger" style={{ margin: "40px 0 0" }}>
        <span>
          {editable
            ? "Removing a milestone deletes the deliverables it owns."
            : LOCKED_HINT}
        </span>
        <button
          onClick={() => {
            void removeMilestone();
          }}
          disabled={!editable}
        >
          Remove milestone
        </button>
      </div>
    </div>
  );
}
