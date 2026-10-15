import type { ReactNode } from "react";
import { prefetchOnHover } from "../lib/prefetch.js";
import type { VaultPlaceId } from "./VaultPlaces.js";
import { VaultIcon } from "./vault-icons.js";

export type VaultContextItem = { id: string; label: string; detail?: string };

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
};

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
}: VaultContextListProps) {
  const ids = items.map((item) => item.id);
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
      <div role="listbox" aria-label={title} className="vs-ctx-list">
        {items.map((item) => {
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
            >
              <span className="vs-ctx-label">{item.label}</span>
              {item.detail && <span className="vs-ctx-detail">{item.detail}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
