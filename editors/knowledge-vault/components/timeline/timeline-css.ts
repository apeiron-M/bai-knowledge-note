import { role } from "../../lib/theme.js";

/** The serif the vault sets titles in (library-css.ts). */
const SERIF = `"Source Serif 4 Variable", "Source Serif 4", Georgia, serif`;

/**
 * Sources › Timeline and the graph's time dock, from the approved design
 * (docs/design/source-timeline/final.html). Every colour is a theme token:
 * blue (`--v-note`) is knowledge — the strata; lavender (`--bai-accent`,
 * `--v-map`) is what you are looking at, and the topics.
 */
export const TIMELINE_CSS = `
.vault-tl { container: vtl / inline-size; min-height: 100%; background: var(--bai-bg); color: var(--bai-text); font-size: 13.5px; line-height: 1.5; }
.vault-tl .tl-page { padding: 16px 16px 64px; }
/* Zero specificity, so the vault's shared controls (.vault-chip, .vault-btn, .vault-seg) keep their own look. */
:where(.vault-tl) :where(button) { font: inherit; color: inherit; background: none; border: 0; padding: 0; text-align: inherit; cursor: pointer; }
.vault-tl :focus-visible { outline: 2px solid var(--bai-accent); outline-offset: 2px; border-radius: 6px; }
.vault-tl .vl-i { width: 16px; height: 16px; flex: none; stroke: currentColor; fill: none; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }

/* The header reads like the Folders tab's (SourceList): one place, two views. */
.vault-tl .tl-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
.vault-tl .tl-head h2 { margin: 0; font-size: 14px; font-weight: 600; color: var(--bai-text-tertiary); font-variant-numeric: tabular-nums; }
.vault-tl .tl-head .tools { margin-left: auto; display: flex; gap: 8px; }
.vault-tl .tl-sum { margin: 8px 0 0; max-width: 78ch; font-size: 14px; color: var(--bai-text-tertiary); }
.vault-tl .tl-sum b { color: var(--bai-text-secondary); font-weight: 600; }
.vault-tl .tl-btn-primary { display: inline-flex; align-items: center; gap: 7px; height: 30px; padding: 0 12px; border-radius: 8px; background: var(--bai-accent); color: var(--bai-accent-text); font-size: 12.5px; font-weight: 600; }
.vault-tl .tl-btn-primary:hover { background: color-mix(in srgb, var(--bai-accent) 86%, #fff); }

/* the strata */
.vault-tl .tl-panel { position: relative; margin-top: 18px; padding: 14px 18px 8px; border-radius: 14px; border: 1px solid var(--bai-border); background: var(--bai-surface); box-shadow: ${role("raise")}; }
.tl-chart { position: relative; }
.tl-scroll { overflow-x: auto; overflow-y: hidden; }
/* Its own lane under the dates, not over them; thick enough to grab. */
.tl-scroll.can-scroll { padding-bottom: 14px; cursor: grab; }
.tl-scroll.dragging { cursor: grabbing; user-select: none; }
.tl-scroll::-webkit-scrollbar { height: 10px; }
.tl-scroll::-webkit-scrollbar-track { background: color-mix(in srgb, var(--bai-text) 6%, transparent); border-radius: 999px; }
.tl-scroll::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--bai-text) 28%, transparent); border-radius: 999px; }
.tl-scroll::-webkit-scrollbar-thumb:hover { background: color-mix(in srgb, var(--bai-text) 42%, transparent); }
.tl-scroll:focus-visible { outline: 2px solid var(--bai-accent); outline-offset: 2px; border-radius: 6px; }
.tl-strata { display: block; max-width: none; height: auto; overflow: visible; touch-action: pan-x; }
.tl-yaxis { position: absolute; left: 0; top: 0; pointer-events: none; }
.tl-yaxis span { position: absolute; left: 2px; padding: 0 4px; border-radius: 4px; font: 11px "Inter Variable", Inter, sans-serif; color: var(--bai-text-tertiary); background: color-mix(in srgb, var(--bai-surface) 85%, transparent); font-variant-numeric: tabular-nums; }
.tl-tonow { position: absolute; right: 0; top: -2px; padding: 3px 9px; border-radius: 999px; border: 1px solid var(--bai-border); background: var(--bai-surface); color: var(--bai-accent); font-size: 12px; font-weight: 600; }
.tl-tonow:focus-visible { outline: 2px solid var(--bai-accent); outline-offset: 2px; }
.tl-strata .layer { stroke: none; transition: fill .12s ease, opacity .12s ease; }
.tl-strata .layer[data-alt="0"] { fill: color-mix(in srgb, ${role("note")} 30%, transparent); }
.tl-strata .layer[data-alt="1"] { fill: color-mix(in srgb, ${role("note")} 17%, transparent); }
.tl-strata .layer.hover { fill: color-mix(in srgb, ${role("note")} 44%, transparent); }
.tl-strata .edge { fill: none; stroke: color-mix(in srgb, ${role("note")} 75%, transparent); stroke-width: 1; stroke-linejoin: round; }
.tl-strata.picking .layer:not(.on) { opacity: .42; }
.tl-strata.picking .edge:not(.on) { opacity: .35; }
.tl-strata .layer.on { fill: color-mix(in srgb, var(--bai-accent) 46%, transparent); }
.tl-strata .edge.on { stroke: var(--bai-accent); stroke-width: 1.75; }
.tl-strata .label { font: 550 12px/1 "Inter Variable", Inter, sans-serif; fill: var(--bai-text); pointer-events: none; }
.tl-strata .label .v { font-weight: 400; fill: var(--bai-text-secondary); }
.tl-strata.picking .label:not(.on) { opacity: .78; }
.tl-strata .topic { fill: ${role("map")}; stroke: var(--bai-surface); stroke-width: 1; }
.tl-strata.picking .topic:not(.on) { opacity: .22; }
.tl-strata .grid { stroke: color-mix(in srgb, var(--bai-text) 7%, transparent); }
.tl-strata .gridlabel { font: 11px "Inter Variable", Inter, sans-serif; fill: var(--bai-text-tertiary); font-variant-numeric: tabular-nums; }
.tl-strata .base, .tl-strata .tick { stroke: var(--bai-border); }
.tl-strata .day { font: 600 12px "Inter Variable", Inter, sans-serif; fill: var(--bai-text-secondary); }
.tl-strata .hour { font: 11px "Inter Variable", Inter, sans-serif; fill: var(--bai-text-tertiary); font-variant-numeric: tabular-nums; }
.tl-strata .now { font: 600 12px "Inter Variable", Inter, sans-serif; fill: var(--bai-accent); }
.tl-strata .hatch { stroke: color-mix(in srgb, var(--bai-text) 7%, transparent); stroke-width: 2.2; }
.tl-strata .fold { pointer-events: none; }
.tl-strata .break { fill: none; stroke: var(--bai-text-tertiary); stroke-width: 1.3; stroke-linecap: round; stroke-linejoin: round; }
.tl-strata .foldlabel { font: italic 11px ${SERIF}; fill: var(--bai-text-tertiary); }
.tl-strata .cursor { stroke: var(--bai-text-tertiary); stroke-dasharray: 2 3; pointer-events: none; }
.tl-strata .live { fill: ${role("note")}; }
.tl-strata .livering { fill: none; stroke: ${role("note")}; stroke-width: 1.5; animation: vtl-ping 2.4s ease-out infinite; }
@keyframes vtl-ping { from { r: 4px; opacity: .9; } to { r: 15px; opacity: 0; } }
.vault-tl .tl-legend { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 18px; margin: 2px 0 4px; font-size: 12.5px; color: var(--bai-text-tertiary); }
.vault-tl .tl-legend .key { display: inline-block; width: 14px; height: 10px; margin-right: 6px; vertical-align: -1px; border-radius: 2px; background: color-mix(in srgb, ${role("note")} 30%, transparent); box-shadow: inset 0 1px 0 color-mix(in srgb, ${role("note")} 75%, transparent); }
.vault-tl .tl-legend .key.fold { background: repeating-linear-gradient(45deg, color-mix(in srgb, var(--bai-text) 7%, transparent) 0 2px, transparent 2px 5px); box-shadow: none; }
/* Tailwind's preflight makes every svg a block; these sit in a line of text. */
.vault-tl .tl-legend svg { display: inline-block; width: 10px; height: 10px; margin-right: 6px; vertical-align: -1px; }
.vault-tl .tl-legend svg rect { fill: ${role("map")}; }
.tl-tip { position: absolute; z-index: 5; pointer-events: none; min-width: min(200px, 100%); max-width: 300px; padding: 9px 11px; border-radius: 9px; background: var(--bai-overlay); border: 1px solid var(--bai-border); box-shadow: ${role("shadow")}; font-size: 12.5px; line-height: 1.45; color: var(--bai-text-secondary); }
.tl-tip b { display: block; color: var(--bai-text); font-weight: 600; }
.tl-tip .who { color: var(--bai-text); }

/* the tools above the ledger */
.vault-tl .tl-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 22px; }
.vault-tl .tl-tools .vault-chip .n { opacity: .72; font-variant-numeric: tabular-nums; }
.vault-tl .tl-tools .vault-chip[aria-pressed="true"] .n { opacity: 1; }
.vault-tl .tl-filter { display: flex; align-items: center; gap: 7px; height: 30px; width: 240px; margin-left: auto; padding: 0 10px; border: 1px solid var(--bai-border); border-radius: 8px; background: ${role("input")}; color: var(--bai-text-tertiary); }
.vault-tl .tl-filter:focus-within { border-color: var(--bai-accent); }
.vault-tl .tl-filter input { flex: 1; min-width: 0; border: 0; outline: 0; background: none; color: var(--bai-text); font: inherit; font-size: 12.5px; }

/* the ledger */
.vault-tl .tl-day { margin-top: 18px; }
.vault-tl .tl-dayhead { position: sticky; top: 0; z-index: 3; display: flex; align-items: baseline; gap: 10px; margin: 0; padding: 8px 0 6px; background: var(--bai-bg); font-size: 14px; font-weight: 650; }
.vault-tl .tl-dayhead small { font-size: 12.5px; font-weight: 400; color: var(--bai-text-tertiary); }
.vault-tl .tl-list { position: relative; list-style: none; margin: 0; padding: 0; }
.vault-tl .tl-list::before { content: ""; position: absolute; left: 96px; top: 14px; bottom: 18px; width: 1px; background: var(--bai-border); }
.vault-tl .tl-row { scroll-margin-top: 52px; position: relative; display: grid; grid-template-columns: 72px 34px minmax(0, 1fr); column-gap: 7px; padding: 8px 0 14px; }
.vault-tl .tl-when { padding-top: 6px; text-align: right; font-size: 12.5px; color: var(--bai-text-tertiary); font-variant-numeric: tabular-nums; }
.vault-tl .tl-dot { position: relative; z-index: 1; display: grid; place-items: center; width: 30px; height: 30px; margin-left: 2px; border-radius: 50%; border: 1px solid var(--bai-border); background: var(--bai-bg); color: var(--bai-text-tertiary); }
.vault-tl .tl-row:hover .tl-dot, .vault-tl .tl-row.hl .tl-dot, .vault-tl .tl-row.open .tl-dot { border-color: color-mix(in srgb, var(--bai-accent) 55%, var(--bai-border)); color: var(--bai-accent); }
.vault-tl .tl-row.live .tl-dot::after { content: ""; position: absolute; right: -1px; top: -1px; width: 8px; height: 8px; border-radius: 50%; background: ${role("note")}; box-shadow: 0 0 0 2px var(--bai-bg); }
.vault-tl .tl-body { min-width: 0; }
.vault-tl .tl-rowbtn { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 12px; width: 100%; padding-top: 3px; }
.vault-tl .tl-name { font-family: ${SERIF}; font-size: 17.5px; font-weight: 550; line-height: 1.3; color: var(--bai-text); overflow-wrap: anywhere; }
.vault-tl .tl-rowbtn:hover .tl-name, .vault-tl .tl-row.hl .tl-name { text-decoration: underline; text-decoration-color: var(--bai-accent); text-decoration-thickness: 1.5px; text-underline-offset: 4px; }
.vault-tl .tl-kind { font-size: 12.5px; color: var(--bai-text-tertiary); }
.vault-tl .tl-became { margin: 3px 0 0; max-width: 80ch; font-size: 13.5px; color: var(--bai-text-secondary); }
.vault-tl .tl-earlier { color: var(--bai-text-tertiary); }
.vault-tl .tl-prog { display: flex; align-items: center; gap: 10px; margin-top: 8px; font-size: 12.5px; color: var(--bai-text-tertiary); }
.vault-tl .tl-prog .bar { width: 150px; height: 5px; flex: none; border-radius: 999px; background: var(--bai-hover); overflow: hidden; }
.vault-tl .tl-prog .bar i { display: block; height: 100%; border-radius: inherit; background: ${role("note")}; }
.vault-tl .tl-prog.live > span:last-child { color: var(--bai-text-secondary); }

/* the open row */
.vault-tl .tl-detail { margin-top: 12px; padding: 16px 18px; border-radius: 12px; border: 1px solid var(--bai-border); background: var(--bai-surface); box-shadow: ${role("raise")}; }
.vault-tl .tl-facts { margin: 0 0 14px; max-width: 84ch; font-size: 13px; color: var(--bai-text-tertiary); }
.vault-tl .tl-cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 22px; }
.vault-tl .tl-detail h4 { margin: 0 0 8px; font-size: 13px; font-weight: 650; }
.vault-tl .tl-detail ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
.vault-tl .tl-topics button { display: flex; align-items: center; gap: 8px; color: var(--bai-text-secondary); text-align: left; }
.vault-tl .tl-topics button:hover { color: var(--bai-text); text-decoration: underline; text-decoration-color: var(--bai-accent); text-underline-offset: 3px; }
.vault-tl .tl-topics svg { width: 10px; height: 10px; flex: none; }
.vault-tl .tl-topics svg rect { fill: ${role("map")}; }
.vault-tl .tl-none { margin: 0; color: var(--bai-text-tertiary); font-size: 13px; }
.vault-tl .tl-from li { color: var(--bai-text-secondary); }
.vault-tl .tl-from b { color: var(--bai-text); font-weight: 600; font-variant-numeric: tabular-nums; }
.vault-tl .tl-tags { display: flex; flex-wrap: wrap; gap: 4px 10px; margin-top: 12px; }
.vault-tl .tl-tag { font-size: 12.5px; color: var(--bai-accent); }
.vault-tl .tl-tag i { font-style: normal; color: var(--bai-text-tertiary); }
.vault-tl .tl-detail > h4 { margin-top: 16px; }
.vault-tl .tl-sample button { font-family: ${SERIF}; font-size: 15px; line-height: 1.4; color: var(--bai-text); text-align: left; }
.vault-tl .tl-sample button:hover { text-decoration: underline; text-decoration-color: var(--bai-accent); text-underline-offset: 3px; }
.vault-tl .tl-acts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }

/* empty and failed */
.vault-tl .tl-empty { margin-top: 18px; padding: 30px 28px 26px; border-radius: 14px; border: 1px dashed var(--bai-border); text-align: center; }
.vault-tl .tl-empty > svg { display: block; width: 100%; max-width: 640px; height: 96px; margin: 0 auto 18px; }
.vault-tl .tl-empty h2 { margin: 0; font-family: ${SERIF}; font-size: 21px; font-weight: 550; }
.vault-tl .tl-empty p { max-width: 58ch; margin: 8px auto 0; color: var(--bai-text-tertiary); font-size: 14px; }
.vault-tl .tl-empty .acts { display: flex; justify-content: center; gap: 8px; margin-top: 18px; }
.vault-tl .calm { margin-top: 16px; padding: 28px 20px; text-align: center; border-radius: 12px; border: 1px dashed var(--bai-border); font-size: 14px; color: var(--bai-text-tertiary); }

@container vtl (max-width: 760px) {
  .vault-tl .tl-cols { grid-template-columns: minmax(0, 1fr); }
  .vault-tl .tl-filter { width: 100%; margin-left: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .tl-strata .livering { animation: none; opacity: 0; }
  .tl-strata .layer { transition: none; }
}
.tl-more { display: flex; justify-content: center; margin: 4px 0 28px; }
`;

/** The graph's time dock (Graph › Over time): the strata as a scrubber, play, the moment and its words. */
export const DOCK_CSS = `
.tl-dock { position: absolute; left: 12px; right: 12px; bottom: 12px; z-index: 20; display: flex; flex-direction: column; gap: 8px; padding: 10px 14px 12px; border-radius: 14px; border: 1px solid var(--bai-border); background: var(--bai-surface); box-shadow: ${role("shadow")}; color: var(--bai-text); font-size: 13px; line-height: 1.45; container: tldock / inline-size; }
.tl-sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.tl-dock-top { display: flex; align-items: baseline; gap: 12px; }
.tl-dock-caption { flex: 1; min-width: 0; margin: 0; font-size: 13.5px; color: var(--bai-text-secondary); }
.tl-dock-caption .lead { font-family: ${SERIF}; font-size: 15.5px; color: var(--bai-text); }
.tl-dock-all { flex: none; color: var(--bai-accent); font-weight: 600; font-size: 13px; }
.tl-dock-row { display: grid; grid-template-columns: auto 132px minmax(0, 1fr) auto; align-items: center; gap: 14px; }
.tl-play { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; background: var(--bai-accent); color: var(--bai-accent-text); }
.tl-play:hover { background: color-mix(in srgb, var(--bai-accent) 86%, #fff); }
.tl-play:focus-visible, .tl-dock-all:focus-visible { outline: 2px solid var(--bai-accent); outline-offset: 2px; }
.tl-dock-when b { display: block; font-size: 13.5px; font-weight: 650; }
.tl-dock-when span { font-size: 12.5px; color: var(--bai-text-tertiary); font-variant-numeric: tabular-nums; }
.tl-dock-track { position: relative; height: 44px; cursor: pointer; touch-action: none; }
.tl-dock-track:focus-visible { outline: 2px solid var(--bai-accent); outline-offset: 4px; border-radius: 6px; }
.tl-dock-track .future { position: absolute; top: 0; bottom: 0; right: 0; background: color-mix(in srgb, var(--bai-surface) 62%, transparent); pointer-events: none; }
.tl-dock-track .head { position: absolute; top: -5px; bottom: -5px; width: 2px; margin-left: -1px; background: var(--bai-accent); pointer-events: none; }
.tl-dock-track .head::before { content: ""; position: absolute; top: -4px; left: -5px; width: 12px; height: 12px; border-radius: 50%; background: var(--bai-accent); box-shadow: 0 0 0 3px var(--bai-surface); }
.tl-dock-track .mark { position: absolute; bottom: -3px; width: 1px; height: 7px; background: var(--bai-text-tertiary); pointer-events: none; }
.tl-dock-count { text-align: right; font-size: 12.5px; color: var(--bai-text-tertiary); font-variant-numeric: tabular-nums; white-space: nowrap; }
.tl-dock-count b { color: var(--bai-text); font-weight: 600; }
@container tldock (max-width: 560px) {
  .tl-dock-row { grid-template-columns: auto minmax(0, 1fr) auto; gap: 10px; }
  .tl-dock-when { display: none; }
  .tl-dock-caption { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
}
@container tldock (max-width: 400px) {
  .tl-dock-row { grid-template-columns: auto minmax(0, 1fr); }
  .tl-dock-count { display: none; }
}
`;
