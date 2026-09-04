import { actions } from "document-models/scope-of-work";
import { generateId } from "document-model/core";
import { DeliverableTable } from "../components/DeliverableRow.js";
import { Avatar, InlineText } from "../components/ui.js";
import { useEditor } from "../lib/context.js";
import {
  LOCKED_HINT,
  agentById,
  budgetsByCurrencyFor,
  deliverablesIn,
  isEditable,
  milestoneState,
  moneyList,
  nextSequenceCode,
  rollup,
} from "../lib/model.js";
import { OverviewView } from "./OverviewView.js";

export function RoadmapView({ id }: { id: string }) {
  const { state, dispatch, go, select, today, confirm } = useEditor();
  const r = state.roadmaps.find((x) => x.id === id);
  if (!r) return <OverviewView />;
  const milestones = r.milestones
    .slice()
    .sort((a, b) =>
      (a.deliveryTarget || "9999").localeCompare(b.deliveryTarget || "9999"),
    );
  const editable = isEditable(state);

  const addMilestone = () => {
    dispatch(
      actions.addMilestone({
        id: generateId(),
        roadmapId: r.id,
        sequenceCode: nextSequenceCode(r),
        title: "New milestone",
        description: "",
        deliveryTarget: "",
      }),
    );
  };
  const addDeliverable = (milestoneId: string) => {
    const deliverableId = generateId();
    dispatch(
      actions.addMilestoneDeliverable({
        milestoneId,
        deliverableId,
        title: "New deliverable",
      }),
    );
    select(deliverableId);
  };
  const removeMilestone = async (
    mid: string,
    code: string,
    title: string,
  ) => {
    const ok = await confirm({
      title: "Remove milestone",
      body: `Remove milestone ${code} "${title}" and the deliverables it owns?`,
    });
    if (!ok) return;
    dispatch(actions.removeMilestone({ id: mid, roadmapId: r.id }));
  };
  const removeRoadmap = async () => {
    const ok = await confirm({
      title: "Remove roadmap",
      body: `Remove roadmap "${r.title}" and every deliverable scheduled in its milestones?`,
    });
    if (!ok) return;
    dispatch(actions.removeRoadmap({ id: r.id }));
    go({ kind: "overview" });
  };

  return (
    <div className="doc">
      <div className="eyebrow">Roadmap</div>
      <h1 className="title">
        <InlineText
          ariaLabel="Roadmap title"
          value={r.title}
          placeholder="Name this roadmap"
          onCommit={(title) =>
            dispatch(actions.editRoadmap({ id: r.id, title }))
          }
        />
      </h1>
      <p className="desc">
        <InlineText
          ariaLabel="Roadmap description"
          multiline
          value={r.description}
          placeholder="What this track is for."
          onCommit={(description) =>
            dispatch(actions.editRoadmap({ id: r.id, description }))
          }
        />
      </p>

      <section className="section">
        <div className="hd">
          <h2>Milestones</h2>
          <span className="muted">in delivery order</span>
          <div className="grow" />
          <button className="btn sm" onClick={addMilestone}>
            + Add milestone
          </button>
        </div>
        {milestones.length === 0 ? (
          <div className="card empty">
            <b>No milestones yet</b>Milestones are the dates work lands on. Add
            the first one above.
          </div>
        ) : (
          <div className="vspine">
            {milestones.map((m) => {
              const ids = m.scope?.deliverables ?? [];
              const ru = rollup(state, ids);
              return (
                <div
                  key={m.id}
                  className={`ms ${milestoneState(state, m, today)}`}
                >
                  <div className="hd">
                    <span className="code">{m.sequenceCode}</span>
                    <h3 style={{ minWidth: 160, flex: 1 }}>
                      <InlineText
                        ariaLabel="Milestone title"
                        value={m.title}
                        placeholder="Milestone title"
                        onCommit={(title) =>
                          dispatch(
                            actions.editMilestone({
                              id: m.id,
                              roadmapId: r.id,
                              title,
                            }),
                          )
                        }
                      />
                    </h3>
                    <input
                      type="date"
                      className="in sm"
                      aria-label="Target date"
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
                    <span className="avs">
                      {m.coordinators.map((c) => (
                        <Avatar key={c} agent={agentById(state, c)} title={c} />
                      ))}
                    </span>
                    <span
                      className="muted"
                      style={{ fontSize: 12, whiteSpace: "nowrap" }}
                    >
                      {ru.done}/{ru.total} done ·{" "}
                      {moneyList(budgetsByCurrencyFor(state, ids))}
                    </span>
                    <button
                      className="btn sm ghost"
                      onClick={() => go({ kind: "milestone", id: m.id })}
                    >
                      Open
                    </button>
                    {editable && (
                      <button
                        className="rm"
                        title="Remove milestone"
                        aria-label={`Remove milestone ${m.sequenceCode}`}
                        onClick={() => {
                          void removeMilestone(
                            m.id,
                            m.sequenceCode,
                            m.title,
                          );
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                  <div className="rows">
                    <DeliverableTable
                      items={deliverablesIn(state, ids)}
                      header={false}
                    />
                    {ids.length === 0 && (
                      <div className="empty">
                        <b>No deliverables yet</b>Add one below, or schedule an
                        existing one from its inspector.
                      </div>
                    )}
                    <button
                      className="add"
                      onClick={() => addDeliverable(m.id)}
                    >
                      + Add deliverable to {m.sequenceCode}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="danger" style={{ margin: "40px 0 0" }}>
        <span>
          {editable
            ? "Removing a roadmap deletes the deliverables its milestones own."
            : LOCKED_HINT}
        </span>
        <button
          onClick={() => {
            void removeRoadmap();
          }}
          disabled={!editable}
        >
          Remove roadmap
        </button>
      </div>
    </div>
  );
}
