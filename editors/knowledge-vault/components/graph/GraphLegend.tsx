import type { ReactNode } from "react";
import {
  EMPTY_GRAPH_FILTER,
  hidesAnything,
  LINK_KIND_LABEL,
  LINK_KINDS,
  LINK_TYPE_COLOR_HEX,
  MOC_COLOR_HEX,
  NODE_KIND_LABEL,
  NODE_KINDS,
  STATUS_COLOR_HEX,
  toggleLinkKind,
  toggleNodeKind,
  type GraphFilter,
  type LinkKind,
  type NodeKind,
} from "./model.js";

/*
 * The graph's legend, which is also its filter: each node and link entry
 * hides or shows its kind. Hidden entries are struck through, and "Show all"
 * appears while anything is hidden. The state belongs to the vault
 * (DriveExplorer), so it survives leaving the graph and coming back.
 */

function nodeSwatch(kind: NodeKind): ReactNode {
  if (kind === "MOC")
    return (
      <span
        className="inline-block h-3 w-3"
        style={{
          backgroundColor: MOC_COLOR_HEX,
          clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
        }}
      />
    );
  return (
    <span
      className="inline-block h-2.5 w-2.5 rounded-full"
      style={{ backgroundColor: STATUS_COLOR_HEX[kind] }}
    />
  );
}

function linkSwatch(kind: LinkKind): ReactNode {
  return (
    <span
      className="inline-block h-0 w-3 border-t-2"
      style={{
        borderColor:
          kind === "CORE_IDEA" ? MOC_COLOR_HEX : LINK_TYPE_COLOR_HEX[kind],
      }}
    />
  );
}

function LegendToggle(props: {
  kind: string;
  label: string;
  hidden: boolean;
  textColor: string;
  swatch: ReactNode;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      data-kind={props.kind}
      aria-pressed={!props.hidden}
      onClick={props.onToggle}
      className="flex items-center gap-1.5 rounded px-0.5"
      style={{ opacity: props.hidden ? 0.5 : 1 }}
    >
      {props.swatch}
      <span
        style={{
          color: props.textColor,
          textDecoration: props.hidden ? "line-through" : "none",
        }}
      >
        {props.label}
      </span>
    </button>
  );
}

export function GraphLegend(props: {
  filter: GraphFilter;
  onChange: (filter: GraphFilter) => void;
}) {
  const { filter, onChange } = props;
  return (
    <div
      role="group"
      aria-label="Legend"
      className="absolute bottom-4 left-4 z-10 flex flex-col gap-2 rounded-lg px-3 py-2.5 text-[10px] backdrop-blur-sm"
      style={{
        backgroundColor:
          "color-mix(in srgb, var(--bai-bg, #11111b) 90%, transparent)",
        border: "1px solid var(--bai-border, rgba(255,255,255,0.1))",
      }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {NODE_KINDS.map((kind) => (
          <LegendToggle
            key={kind}
            kind={kind}
            label={NODE_KIND_LABEL[kind]}
            hidden={filter.hiddenNodes.includes(kind)}
            textColor="var(--bai-text-tertiary, #9ca3af)"
            swatch={nodeSwatch(kind)}
            onToggle={() => onChange(toggleNodeKind(filter, kind))}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {LINK_KINDS.map((kind) => (
          <LegendToggle
            key={kind}
            kind={kind}
            label={LINK_KIND_LABEL[kind]}
            hidden={filter.hiddenLinks.includes(kind)}
            textColor="var(--bai-text-muted, #6b7280)"
            swatch={linkSwatch(kind)}
            onToggle={() => onChange(toggleLinkKind(filter, kind))}
          />
        ))}
      </div>
      {hidesAnything(filter) && (
        <button
          type="button"
          onClick={() => onChange(EMPTY_GRAPH_FILTER)}
          className="self-start underline"
          style={{ color: "var(--bai-text-secondary, #d4d4d8)" }}
        >
          Show all
        </button>
      )}
    </div>
  );
}
