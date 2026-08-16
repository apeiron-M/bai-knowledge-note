import { useState } from "react";
import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import type {
  Goal,
  WorkBreakdownStructureAction,
} from "document-models/work-breakdown-structure";
import { GoalRow } from "./GoalRow.js";
import { AddGoalRow } from "./AddGoalRow.js";

type Dispatch = DocumentDispatch<WorkBreakdownStructureAction>;

type GoalTreeProps = {
  goals: Goal[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  dispatch: Dispatch;
};

type Row = { goal: Goal; depth: number; hasChildren: boolean };

function visibleRows(goals: Goal[], collapsed: Set<string>): Row[] {
  const byParent = new Map<string | null, Goal[]>();
  for (const g of goals) {
    const k = g.parentId ?? null;
    byParent.set(k, [...(byParent.get(k) ?? []), g]);
  }
  const out: Row[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const g of byParent.get(parentId) ?? []) {
      const kids = byParent.get(g.id) ?? [];
      out.push({ goal: g, depth, hasChildren: kids.length > 0 });
      if (!collapsed.has(g.id)) walk(g.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function GoalTree({
  goals,
  selectedId,
  onSelect,
  dispatch,
}: GoalTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  function toggleCollapse(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expand(id: string) {
    setCollapsed((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  const rows = visibleRows(goals, collapsed);

  return (
    <div>
      <h2
        className="mb-2 text-xs font-semibold uppercase tracking-wider"
        style={{ color: "var(--bai-text-muted)" }}
      >
        Goals ({goals.length})
      </h2>

      {goals.length === 0 ? (
        <p
          className="py-6 text-center text-sm"
          style={{ color: "var(--bai-text-faint)" }}
        >
          No goals yet — add the first one below.
        </p>
      ) : (
        <div className="space-y-1">
          {rows.map((row) => (
            <GoalRow
              key={row.goal.id}
              goal={row.goal}
              depth={row.depth}
              hasChildren={row.hasChildren}
              collapsed={collapsed.has(row.goal.id)}
              onToggleCollapse={toggleCollapse}
              onExpand={expand}
              allGoals={goals}
              selected={row.goal.id === selectedId}
              onSelect={onSelect}
              dispatch={dispatch}
            />
          ))}
        </div>
      )}

      <AddGoalRow parentId={null} dispatch={dispatch} />
    </div>
  );
}
