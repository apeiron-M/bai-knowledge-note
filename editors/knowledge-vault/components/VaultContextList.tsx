import type { ReactNode } from "react";
import { prefetchOnHover } from "../lib/prefetch.js";
import type { VaultPlaceId } from "./VaultPlaces.js";

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
    <div className="space-y-1">
      <button
        type="button"
        onClick={onBack}
        className="sidebar-row flex w-full items-center gap-1 rounded px-2 py-1 text-left text-xs"
        style={{ color: "var(--bai-text-muted)" }}
      >
        ‹ {BACK_LABEL[place]}
      </button>
      <div className="mb-1 flex items-start gap-2 px-2 py-1.5">
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-xs font-medium"
            style={{ color: "var(--bai-text-secondary)" }}
            title={title}
          >
            {title}
          </p>
          <p className="text-[10px]" style={{ color: "var(--bai-text-faint)" }}>
            {subtitle}
          </p>
        </div>
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            aria-label="Previous"
            onClick={() => step(-1)}
            disabled={items.length === 0}
            className="sidebar-collapse-btn rounded p-1"
            style={{ color: "var(--bai-text-faint)" }}
          >
            ↑
          </button>
          <button
            type="button"
            aria-label="Next"
            onClick={() => step(1)}
            disabled={items.length === 0}
            className="sidebar-collapse-btn rounded p-1"
            style={{ color: "var(--bai-text-faint)" }}
          >
            ↓
          </button>
        </div>
      </div>
      {header}
      <div role="listbox" aria-label={title} className="space-y-px">
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
              className="sidebar-row flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left"
              style={active ? { backgroundColor: "var(--bai-hover)" } : undefined}
            >
              <span
                className="sidebar-note-title truncate text-xs font-medium"
                style={{
                  color: active ? "var(--bai-accent)" : "var(--bai-text-secondary)",
                }}
              >
                {item.label}
              </span>
              {item.detail && (
                <span
                  className="truncate text-[10px]"
                  style={{ color: "var(--bai-text-faint)" }}
                >
                  {item.detail}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
