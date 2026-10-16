import { useId, useMemo, useRef, useState } from "react";
import type { SourceTimeline } from "../../../../processors/graph-indexer/source-timeline.js";
import { clock, countOf, dayLabel } from "../../lib/timeline/additions.js";
import { axisMarks, foldedAxis, type TimeWords } from "../../lib/timeline/axis.js";
import { bandAt, bandPaths, HEADROOM, scaleY, stackStrata, strataLabels, strataLayers, type StrataLayer } from "../../lib/timeline/strata.js";

export interface StrataChartProps {
  timeline: SourceTimeline;
  now: number;
  /** The chart's width in px; nothing is drawn until it is known. */
  width: number;
  height?: number;
  /** Layers only — no axis, labels, grid or topics — for the graph's dock. */
  compact?: boolean;
  words?: TimeWords;
  /** The addition still being read: a pulse at now on its layer. */
  live?: string | null;
  /** The open addition: its layer lit, the rest dimmed. */
  selected?: string | null;
  /** The addition the pointer is over elsewhere (a ledger row). */
  hovered?: string | null;
  label: string;
  onHover?: (additionIds: readonly string[] | null) => void;
  onPick?: (additionId: string) => void;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function niceTicks(max: number): number[] {
  if (max <= 0) return [];
  const raw = max / 3;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((m) => m >= raw) ?? raw;
  const out: number[] = [];
  for (let v = step; v < max; v += step) out.push(Math.round(v));
  return out;
}

const cls = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(" ");

interface Hover {
  px: number;
  left: number;
  top: number;
  layer: StrataLayer | null;
  text: { when: string; quiet: string | null; mine: string | null; total: string };
}

const TIP_WIDTH = 300;

/** Where the hover card goes: beside the pointer, kept inside the chart however narrow it is. */
export function tipBox(pointerLeft: number, chartWidth: number): { left: number; width: number } {
  const width = Math.min(TIP_WIDTH, chartWidth);
  return { left: Math.max(0, Math.min(pointerLeft + 14, chartWidth - width)), width };
}

export function StrataChart(props: StrataChartProps) {
  const { timeline, now, width, compact = false } = props;
  const locale = props.words?.locale;
  const timeZone = props.words?.timeZone;
  const height = props.height ?? (compact ? 52 : 200);
  const top = compact ? 4 : 22;
  const axisH = compact ? 0 : 40;
  const pattern = `tl-fold-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);

  const model = useMemo(() => {
    if (width <= 0) return null;
    const words = { locale, timeZone };
    const layers = strataLayers(timeline.additions, timeline.notes, words);
    const times = [
      ...timeline.additions.map((a) => Date.parse(a.addedAt)),
      ...timeline.notes.map((n) => Date.parse(n.addedAt ?? "")),
      ...timeline.topics.map((t) => Date.parse(t.addedAt ?? "")),
    ].filter(Number.isFinite);
    const ax = foldedAxis(times, width, now, { gapPx: compact ? 18 : 40 });
    const stack = stackStrata(layers, ax, compact ? 4 : 3);
    const y = scaleY(stack, height, top);
    const keyOf = new Map<string, string>();
    for (const l of layers) for (const id of l.additionIds) keyOf.set(id, l.key);
    return {
      layers,
      ax,
      stack,
      y,
      paths: bandPaths(stack, y),
      labels: compact ? [] : strataLabels(stack, { height, top, minPx: 17 }),
      marks: compact ? null : axisMarks(ax, now, words),
      keyOf,
      ticks: compact ? [] : niceTicks(stack.max),
    };
  }, [timeline, now, width, height, top, compact, locale, timeZone]);

  if (!model) return <div className="tl-chart" ref={box} />;
  const { ax, stack, y, keyOf } = model;
  const selectedKey = props.selected ? keyOf.get(props.selected) : undefined;
  const hoverKey = hover?.layer?.key ?? (props.hovered ? keyOf.get(props.hovered) : undefined);
  const live = props.live ? keyOf.get(props.live) : undefined;
  const last = stack.xs.length - 1;

  const at = (e: { clientX: number; clientY: number }) => {
    const svg = box.current?.querySelector("svg");
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * width;
    const py = ((e.clientY - r.top) / r.height) * (height + axisH);
    const value = Math.max(1, stack.max * HEADROOM) * (1 - (py - top) / (height - top));
    const band = bandAt(stack, px, value);
    const k = Math.max(0, Math.min(last, Math.round(px / stack.step)));
    const t = ax.t(px);
    const gap = ax.gaps.find((g) => t > g.t0 && t < g.t1);
    const layer = band >= 0 ? stack.bands[band].layer : null;
    const words = { locale, timeZone };
    return {
      px,
      left: e.clientX - (box.current?.getBoundingClientRect().left ?? 0),
      top: e.clientY - (box.current?.getBoundingClientRect().top ?? 0),
      layer,
      t,
      text: {
        when: `${dayLabel(t, now, words)}, ${clock(t, words)}`,
        quiet: gap ? (gap.t1 - gap.t0 >= 2 * DAY ? `${Math.round((gap.t1 - gap.t0) / DAY)} quiet days` : `${Math.round((gap.t1 - gap.t0) / HOUR)} quiet hours`) : null,
        mine: band >= 0 ? `${countOf(stack.bands[band].hi[k] - stack.bands[band].lo[k], "note")} by then` : null,
        total: `${countOf(stack.bands.at(-1)?.hi[k] ?? 0, "note")} in the vault`,
      },
    };
  };

  return (
    <div
      className="tl-chart"
      ref={box}
      onPointerMove={(e) => {
        const h = at(e);
        if (!h || compact) return;
        setHover(h);
        props.onHover?.(h.layer?.additionIds ?? null);
      }}
      onPointerLeave={() => {
        setHover(null);
        props.onHover?.(null);
      }}
      onClick={(e) => {
        const h = at(e);
        if (!h?.layer || !props.onPick) return;
        // A merged run opens the member nearest the moment clicked.
        const members = timeline.additions.filter((a) => h.layer?.additionIds.includes(a.id));
        const before = members.filter((a) => Date.parse(a.addedAt) <= h.t);
        props.onPick((before.at(-1) ?? members[0]).id);
      }}
    >
      <svg className={selectedKey ? "tl-strata picking" : "tl-strata"} viewBox={`0 0 ${width} ${height + axisH}`} width={width} height={height + axisH} role="img" aria-label={props.label}>
        <defs>
          <pattern id={pattern} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" className="hatch" />
          </pattern>
        </defs>
        {model.ticks.map((v) =>
          y(v) > top + 10 ? (
            <g key={v}>
              <line className="grid" x1={0} x2={width} y1={y(v)} y2={y(v)} />
              <text className="gridlabel" x={4} y={y(v) - 4}>
                {v.toLocaleString("en-US")}
              </text>
            </g>
          ) : null,
        )}
        {model.paths.map((p, j) => {
          const key = model.layers[j].key;
          return <path key={`a-${key}`} className={cls("layer", key === selectedKey && "on", key === hoverKey && "hover")} data-alt={j % 2} data-layer={key} d={p.area} />;
        })}
        {model.paths.map((p, j) => {
          const key = model.layers[j].key;
          return <path key={`e-${key}`} className={cls("edge", key === selectedKey && "on")} d={p.edge} />;
        })}
        {ax.gaps.map((g) => (
          <rect key={`f-${g.x0}`} className="fold" x={g.x0} y={top - 2} width={g.x1 - g.x0} height={height - top + 2} fill={`url(#${pattern})`} />
        ))}
        {model.labels.map((l) => (
          <text key={`l-${l.key}`} className={cls("label", l.key === selectedKey && "on")} x={width - 10} y={l.y} textAnchor="end">
            {l.title.length > 40 ? `${l.title.slice(0, 39)}…` : l.title} <tspan className="v">{l.count.toLocaleString("en-US")}</tspan>
          </text>
        ))}
        {!compact &&
          timeline.topics.map((t) => {
            const at = Date.parse(t.addedAt ?? "");
            if (!Number.isFinite(at)) return null;
            const x = ax.x(at);
            const key = t.additionId ? keyOf.get(t.additionId) : undefined;
            return <rect key={`t-${t.documentId}`} className={cls("topic", key !== undefined && key === selectedKey && "on")} x={x - 3} y={top - 13} width={6} height={6} transform={`rotate(45 ${x} ${top - 10})`} />;
          })}
        {live !== undefined &&
          (() => {
            const j = model.layers.findIndex((l) => l.key === live);
            if (j < 0) return null;
            const cy = y(stack.bands[j].hi[last]);
            return (
              <g>
                <circle className="live" cx={width - 3} cy={cy} r={4} />
                <circle className="livering" cx={width - 3} cy={cy} r={4} />
              </g>
            );
          })()}
        {model.marks && (
          <g>
            <line className="base" x1={0} x2={width} y1={height} y2={height} />
            {model.marks.days.map((d) => (
              <text key={`d-${d.x}`} className="day" x={d.x + 2} y={height + 32}>
                {d.label}
              </text>
            ))}
            {model.marks.ticks.map((t) => (
              <g key={`k-${t.x}`}>
                <line className="tick" x1={t.x} x2={t.x} y1={height} y2={height + 4} />
                <text className="hour" x={t.x} y={height + 16} textAnchor="middle">
                  {t.label}
                </text>
              </g>
            ))}
            {model.marks.folds.map((f) => (
              <g key={`b-${f.x}`}>
                <path className="break" d={`M${f.x - 5},${height - 6} l4,-6 l2,12 l4,-6`} />
                <text className="foldlabel" x={f.x} y={height + 16} textAnchor="middle">
                  {f.label}
                </text>
              </g>
            ))}
            <text className="now" x={width} y={height + 32} textAnchor="end">
              {model.marks.now.label}
            </text>
          </g>
        )}
        {hover && <line className="cursor" x1={hover.px} x2={hover.px} y1={top - 14} y2={height} />}
      </svg>
      {hover && (
        <div className="tl-tip" style={{ left: tipBox(hover.left, width).left, maxWidth: tipBox(hover.left, width).width, top: Math.max(0, hover.top - 96) }}>
          <b>{hover.text.when}</b>
          {hover.text.quiet && <div>{hover.text.quiet}: nothing was added.</div>}
          {hover.layer && (
            <div>
              <span className="who">{hover.layer.title}</span>: {hover.text.mine}
              {hover.layer.run ? `, from ${countOf(hover.layer.additionIds.length, "addition")}` : ""}.
            </div>
          )}
          <div>{hover.text.total}.</div>
        </div>
      )}
    </div>
  );
}
