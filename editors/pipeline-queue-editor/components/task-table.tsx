import { setSelectedNode } from "@powerhousedao/reactor-browser";
import type { PipelineTask } from "document-models/pipeline-queue";
import { Fragment, useState } from "react";
import { GROUP_LABEL, groupOf, phaseStates, relativeTime, type PhaseState } from "../lib/tasks.js";

const PAGE = 200;

function PhaseTrack(props: { task: PipelineTask; phases: string[] }) {
  const states = phaseStates(props.task, props.phases);
  const label = props.phases.map((p, i) => `${p}: ${describe(states[i])}`).join(", ");
  return (
    <span className="pq-track" role="img" aria-label={label} title={label}>
      {states.map((s, i) => (
        <span key={props.phases[i]} className={`pq-seg is-${s}`} />
      ))}
    </span>
  );
}
const describe = (s: PhaseState) => ({ done: "done", current: "current", upcoming: "to do", stopped: "stopped here" })[s];

function Handoffs(props: { task: PipelineTask; now: number }) {
  const handoffs = props.task.handoffs;
  if (handoffs.length === 0) return <p className="pq-empty-note">No phase has finished yet.</p>;
  return (
    <ol className="pq-handoffs">
      {handoffs.map((h) => (
        <li key={h.id}>
          <span className="pq-handoff-phase">{h.phase}</span>
          <span className="pq-handoff-text">{h.workDone}</span>
          <span className="pq-handoff-meta">
            {h.completedBy ?? "unknown"}, {relativeTime(h.completedAt, props.now)}
            {h.filesModified.length ? `, ${h.filesModified.length} document${h.filesModified.length === 1 ? "" : "s"}` : ""}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function TaskTable(props: { tasks: PipelineTask[]; phases: string[]; now: number; emptyText: string }) {
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);
  const rows = props.tasks.slice(0, shown);

  if (props.tasks.length === 0) return <p className="pq-empty">{props.emptyText}</p>;

  return (
    <div className="pq-table-wrap">
      <div className="pq-scroll" tabIndex={0} aria-label="Tasks">
        <table className="pq-table">
          <thead>
            <tr>
              <th scope="col">Source</th>
              <th scope="col">Progress</th>
              <th scope="col">Status</th>
              <th scope="col">Assigned to</th>
              <th scope="col" className="pq-right">Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((task, index) => {
              // Composite key: ADD_TASK has no duplicate-id guard in the model,
              // so a queue can carry two tasks with one id.
              const key = `${task.id}-${index}`;
              const group = groupOf(task);
              const expanded = open === key;
              return (
                <Fragment key={key}>
                  <tr className={`pq-row is-${group}${expanded ? " is-expanded" : ""}`}>
                    <td className="pq-source">
                      <button type="button" className="pq-expand" aria-expanded={expanded} aria-label={`${expanded ? "Hide" : "Show"} what each phase did`} onClick={() => setOpen(expanded ? null : key)}>
                        <span aria-hidden="true" className="pq-chevron" />
                      </button>
                      {task.documentRef ? (
                        <button type="button" className="pq-link" onClick={() => setSelectedNode(task.documentRef!)} title={`Open "${task.target}"`}>
                          {task.target}
                        </button>
                      ) : (
                        <span className="pq-plain">{task.target}</span>
                      )}
                      {task.taskType !== "claim" && <span className="pq-type">{task.taskType}</span>}
                    </td>
                    <td>
                      <PhaseTrack task={task} phases={props.phases} />
                    </td>
                    <td>
                      <span className={`pq-status is-${group}`}>{GROUP_LABEL[group]}</span>
                    </td>
                    <td className="pq-muted pq-truncate" title={task.assignedTo ?? undefined}>
                      {task.assignedTo ?? "—"}
                    </td>
                    <td className="pq-muted pq-right" title={task.updatedAt ?? task.createdAt}>
                      {relativeTime(task.updatedAt ?? task.createdAt, props.now)}
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="pq-detail">
                      <td colSpan={5}>
                        <Handoffs task={task} now={props.now} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="pq-table-foot">
        <span>
          Showing {rows.length} of {props.tasks.length}
        </span>
        {rows.length < props.tasks.length && (
          <button type="button" className="pq-more" onClick={() => setShown((n) => n + PAGE)}>
            Show {Math.min(PAGE, props.tasks.length - rows.length)} more
          </button>
        )}
      </div>
    </div>
  );
}
