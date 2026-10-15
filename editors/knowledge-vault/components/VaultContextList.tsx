import { useState, type ReactNode } from "react";
import { prefetchOnHover } from "../lib/prefetch.js";
import type { VaultPlaceId } from "./VaultPlaces.js";
import { VaultIcon } from "./vault-icons.js";

export type VaultContextItem = {
  id: string;
  label: string;
  detail?: string;
  /** A dot before the row: a topic (`map`), the overview (`hub`), a contradiction (`warn`). */
  marker?: "map" | "hub" | "warn";
};

export type VaultContextListProps = {
  place: VaultPlaceId;
  title: string;
  subtitle: string;
  items: VaultContextItem[];
  activeId?: string;
  onOpen: (id: string) => void;
  onBack: () => void;
  /** Above the list: the current node, a link's stated reason. */
  header?: ReactNode;
  /** A filter box above the list ("Filter topics"); none when omitted. */
  filterPlaceholder?: string;
};

/** Pure: the rows a filter leaves, matched on what the row shows. */
export function filterContextItems(items: VaultContextItem[], query: string): VaultContextItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => `${item.label} ${item.detail ?? ""}`.toLowerCase().includes(q));
}

const BACK_LABEL: Record<VaultPlaceId, string> = {
  ask: "Back to Ask",
  notes: "Back to Notes",
  topics: "All topics",
  sources: "All sources",
  work: "Back to Work",
  graph: "Back to the graph",
  contradictions: "All contradictions",
};

/** Pure: the id `delta` steps away, wrapping at both ends. */
export function stepId(
  ids: string[],
  current: string | undefined,
  delta: number,
): string | undefined {
  if (ids.length === 0) return undefined;
  const index = current === undefined ? -1 : ids.indexOf(current);
  if (index === -1) return delta > 0 ? ids[0] : ids[ids.length - 1];
  const next = (index + delta + ids.length) % ids.length;
  return ids[next];
}

/** Pure: the step Alt+ArrowUp / Alt+ArrowDown asks for, or none. */
export function altStepDelta(
  key: string,
  altKey: boolean,
  typing: boolean,
): -1 | 1 | undefined {
  if (!altKey || typing) return undefined;
  if (key === "ArrowDown") return 1;
  if (key === "ArrowUp") return -1;
  return undefined;
}

export function VaultContextList({
  place,
  title,
  subtitle,
  items,
  activeId,
  onOpen,
  onBack,
  header,
  filterPlaceholder,
}: VaultContextListProps) {
  const [query, setQuery] = useState("");
  // Moving to another item starts the list over, filter cleared (design: the
  // list re-renders on every move).
  const [filteredFor, setFilteredFor] = useState(activeId);
  if (filteredFor !== activeId) {
    setFilteredFor(activeId);
    setQuery("");
  }
  const ids = items.map((item) => item.id);
  const rows = filterContextItems(items, query);
  const step = (delta: number) => {
    const next = stepId(ids, activeId, delta);
    if (next !== undefined) onOpen(next);
  };
  return (
    <div className="vs-ctx">
      <div className="vs-ctx-head">
        <button
          type="button"
          onClick={onBack}
          className="vs-iconbtn"
          title={BACK_LABEL[place]}
          aria-label={BACK_LABEL[place]}
        >
          <VaultIcon name="back" />
        </button>
        <div className="vs-ctx-title">
          <b title={title}>{title}</b>
          <small>{subtitle}</small>
        </div>
        <div className="vs-ctx-step">
          <button
            type="button"
            aria-label="Previous"
            title="Previous (Alt+↑)"
            onClick={() => step(-1)}
            disabled={items.length === 0}
          >
            <VaultIcon name="up" size={14} />
          </button>
          <button
            type="button"
            aria-label="Next"
            title="Next (Alt+↓)"
            onClick={() => step(1)}
            disabled={items.length === 0}
          >
            <VaultIcon name="arrowDown" size={14} />
          </button>
        </div>
      </div>
      {header}
      {filterPlaceholder && (
        <label className="vs-ctx-filter">
          <VaultIcon name="search" size={14} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={filterPlaceholder}
            aria-label={filterPlaceholder}
          />
        </label>
      )}
      <div role="listbox" aria-label={title} className="vs-ctx-list">
        {rows.map((item) => {
          const active = item.id === activeId;
          return (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={active}
              aria-current={active ? "true" : undefined}
              data-sidebar-active={active ? "true" : undefined}
              onClick={() => onOpen(item.id)}
              {...prefetchOnHover(item.id)}
              className="vs-ctx-row"
              data-marker={item.marker}
            >
              {item.marker && <span className="vs-ctx-mk" aria-hidden="true" />}
              <span className="vs-ctx-label">{item.label}</span>
              {item.detail && <span className="vs-ctx-detail">{item.detail}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
