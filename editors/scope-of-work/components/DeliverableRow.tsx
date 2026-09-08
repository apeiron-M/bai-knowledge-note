import { actions, type Deliverable } from "document-models/scope-of-work";
import type { ReactNode } from "react";
import { useEditor } from "../lib/context.js";
import {
  agentById,
  budgetOf,
  isEditable,
  isQuoted,
  LOCKED_HINT,
  milestoneOf,
  money,
  pctOf,
  progressText,
  projectOf,
} from "../lib/model.js";
import { Avatar, Badges, Bar, StatusChip } from "./ui.js";

/**
 * Deliverables as a real table: columns share their widths across every row, numbers
 * are right-aligned with tabular digits, and the title column takes what is left and truncates.
 */
export function DeliverableTable({
  items,
  header = true,
  footer,
}: {
  items: Deliverable[];
  header?: boolean;
  footer?: ReactNode;
}) {
  return (
    <table className="tbl">
      {header && (
        <thead>
          <tr>
            <th>Code</th>
            <th className="grow">Deliverable</th>
            <th>Status</th>
            <th>Owner</th>
            <th className="prog">Progress</th>
            <th className="num">Budget</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
      )}
      <tbody>
        {items.map((d) => (
          <DeliverableRow key={d.id} deliverable={d} />
        ))}
      </tbody>
      {footer}
    </table>
  );
}

export function DeliverableRow({
  deliverable: d,
}: {
  deliverable: Deliverable;
}) {
  const { state, dispatch, selected, select, confirm } = useEditor();
  const m = milestoneOf(state, d.id);
  const p = projectOf(state, d.id);
  const owner = agentById(state, d.owner);
  const pct = pctOf(d);
  const editable = isEditable(state);
  const remove = async () => {
    const ok = await confirm({
      title: "Remove deliverable",
      body: `Remove "${d.title || "this deliverable"}" from every project and milestone?`,
    });
    if (!ok) return;
    dispatch(actions.removeDeliverable({ id: d.id }));
  };
  return (
    <tr
      className={selected === d.id ? "sel" : ""}
      tabIndex={0}
      onClick={() => select(d.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          select(d.id);
        }
      }}
      aria-label={`Inspect ${d.title || "untitled deliverable"}`}
    >
      <td className="mono faint code">{d.code || "—"}</td>
      <td className="grow">
        <div className="t">
          {d.title || <span className="faint">Untitled deliverable</span>}{" "}
          <Badges state={state} deliverable={d} />
        </div>
        <div className="sub">
          {p ? `${p.code} · ` : ""}
          {m ? `${m.milestone.sequenceCode} ${m.milestone.title}` : ""}
        </div>
      </td>
      <td>
        <StatusChip status={d.status} />
      </td>
      <td>
        {owner ? (
          <span className="owner">
            <Avatar agent={owner} />
            <span>{owner.name}</span>
          </span>
        ) : (
          <span className="faint">Unassigned</span>
        )}
      </td>
      <td className="prog">
        <Bar pct={pct} tone={d.status === "BLOCKED" ? "signal" : undefined} />
        <div className="faint" style={{ fontSize: 11, marginTop: 3 }}>
          {progressText(d)}
        </div>
      </td>
      <td className="num">
        {/* ADD_DELIVERABLE initialises a zeroed anchor, so "has an anchor" is
            not "has a budget": show a figure only with a payer and a quote —
            the same test the Unfunded / Unquoted badges use. */}
        {p && isQuoted(d) ? (
          money(budgetOf(d), p.currency)
        ) : (
          <span className="faint">—</span>
        )}
      </td>
      <td className="end">
        {editable ? (
          <button
            className="rm"
            title="Remove deliverable"
            aria-label={`Remove ${d.title || "deliverable"}`}
            onClick={(e) => {
              e.stopPropagation();
              void remove();
            }}
          >
            ×
          </button>
        ) : (
          <span className="rm" title={LOCKED_HINT} aria-hidden="true" />
        )}
      </td>
    </tr>
  );
}
