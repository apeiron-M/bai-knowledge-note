import { role } from "../lib/theme.js";

/** The serif the design sets titles in; the desktop app ships it, a browser falls back to Georgia. */
export const SERIF = `"Source Serif 4 Variable", "Source Serif 4", Georgia, serif`;
/** The design's UI face, for text set inside a serif line. */
const SANS = `"Inter Variable", Inter, system-ui, sans-serif`;

/**
 * The vault's library pages — Topics and Contradictions — from the design
 * (docs/design/vault-view/final.html: `.lib`, `.overview`, `.topic-list`,
 * `.tcard`, `.vs`, `.seg`). Every colour is a theme token (style.css).
 *
 * Widths follow the content column, not the window: the page is its own
 * container (`vlib`), so a dragged sidebar or the rail moves the breakpoints
 * with it. The design's 1180 / 900 / 720 px window breakpoints are its
 * content widths here.
 */
export const LIBRARY_CSS = `
.vault-libwrap { container: vlib / inline-size; min-height: 100%; background: var(--bai-bg); }
.vault-lib { max-width: 1160px; margin: 0 auto; padding: 26px 28px 64px; color: var(--bai-text); font-size: 13.5px; line-height: 1.5; }
/* A low-precedence reset (:where), so the vault's shared controls (.vault-seg, .vault-btn) keep their own look here. */
.vault-lib :where(button) { font: inherit; color: inherit; letter-spacing: inherit; background: none; border: 0; padding: 0; text-align: inherit; cursor: pointer; }
.vault-lib .vl-i { width: 16px; height: 16px; flex: none; stroke: currentColor; fill: none; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }
.vault-lib :focus-visible { outline: 2px solid var(--bai-accent); outline-offset: 2px; border-radius: 6px; }

/* shared library chrome */
.vault-lib .lib-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; }
.vault-lib .lib-head h1 { margin: 0; font-size: 22px; font-weight: 650; letter-spacing: -0.01em; color: var(--bai-text); }
.vault-lib .lib-head .count { color: var(--bai-text-tertiary); font-size: 15px; font-variant-numeric: tabular-nums; }
.vault-lib .lib-tools { margin-left: auto; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.vault-lib .lib-sub { margin: 6px 0 0; max-width: 70ch; font-size: 14px; color: var(--bai-text-tertiary); }
.vault-lib .lib-loading { margin-top: 22px; }

.vault-lib .btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; height: 32px; padding: 0 13px; border-radius: 8px; font-size: 13px; font-weight: 550; white-space: nowrap; }
.vault-lib .btn-primary { background: var(--bai-accent); color: var(--bai-accent-text); }
.vault-lib .btn-primary:hover { background: color-mix(in srgb, var(--bai-accent) 86%, #fff); }
.vault-lib .btn-quiet { border: 1px solid var(--bai-border); background: var(--bai-surface); color: var(--bai-text-secondary); box-shadow: ${role("raise")}; }
.vault-lib .btn-quiet:hover { background: var(--bai-hover); color: var(--bai-text); }
.vault-lib .btn-ghost { color: var(--bai-text-tertiary); }
.vault-lib .btn-ghost:hover { background: var(--bai-hover); color: var(--bai-text-secondary); }

.vault-lib .filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 14px; }
/* filters use the vault's shared segmented control (.vault-seg, vault-controls-css.ts) */

.vault-lib .calm { margin-top: 16px; padding: 40px 20px; text-align: center; border-radius: 12px; border: 1px dashed var(--bai-border); font-size: 14px; color: var(--bai-text-tertiary); }

/* Topics */
.vault-lib .overview { display: grid; grid-template-columns: 132px minmax(0, 1fr) auto; align-items: center; gap: 20px; width: 100%; margin-top: 22px; padding: 16px 20px 16px 12px; border-radius: 14px; border: 1px solid var(--bai-border); background: var(--bai-surface); box-shadow: ${role("raise")}; text-align: left; }
.vault-lib .overview:hover { border-color: color-mix(in srgb, var(--bai-accent) 40%, var(--bai-border)); }
.vault-lib .overview svg { width: 132px; height: 92px; }
.vault-lib .overview svg line { stroke: ${role("line")}; stroke-width: 1.4; }
.vault-lib .overview svg circle { fill: ${role("map")}; }
.vault-lib .overview svg circle.hub { fill: var(--bai-text); }
.vault-lib .ov-title { display: block; font-family: ${SERIF}; font-size: 21px; font-weight: 550; color: var(--bai-text); }
.vault-lib .ov-sub { display: block; margin: 3px 0 0; font-size: 13.5px; color: var(--bai-text-tertiary); }
.vault-lib .topic-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 40px; margin: 20px 0 0; padding: 0; list-style: none; }
.vault-lib .topic { display: block; width: 100%; padding: 14px 0 16px; border-top: 1px solid var(--bai-border); text-align: left; }
.vault-lib .topic .tt { display: flex; align-items: baseline; gap: 14px; font-family: ${SERIF}; font-size: 18px; font-weight: 550; line-height: 1.3; color: var(--bai-text); }
.vault-lib .topic:hover .tt > span:first-child, .vault-lib .topic:focus-visible .tt > span:first-child { text-decoration: underline; text-decoration-color: var(--bai-accent); text-underline-offset: 4px; }
.vault-lib .topic .n { margin-left: auto; font: 450 12.5px/1 ${SANS}; color: var(--bai-text-tertiary); white-space: nowrap; }
.vault-lib .topic .td { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin: 5px 0 0; font-size: 13.5px; color: var(--bai-text-tertiary); }

/* Contradictions: two notes that disagree, side by side */
.vault-lib .tcard { margin-top: 16px; border-radius: 14px; border: 1px solid var(--bai-border); background: var(--bai-surface); overflow: hidden; box-shadow: ${role("raise")}; }
.vault-lib .tcard-top { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 14px 18px 0; }
.vault-lib .tcard-top .st { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; background: var(--bai-warn-soft); color: var(--bai-warn); font-size: 12px; }
.vault-lib .tcard-top .st[data-status="RESOLVED"] { background: var(--bai-ok-soft); color: var(--bai-ok); }
.vault-lib .tcard-top .st[data-status="DISSOLVED"] { background: var(--bai-hover); color: var(--bai-text-tertiary); }
.vault-lib .tcard-top .st::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.vault-lib .tcard-top small { font-size: 12.5px; color: var(--bai-text-tertiary); }
.vault-lib .vs { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: stretch; gap: 0; padding: 14px 18px; }
.vault-lib .vs[data-claims="many"] { grid-template-columns: minmax(0, 1fr); gap: 8px; }
.vault-lib .claim-c { display: flex; flex-direction: column; gap: 6px; padding: 14px 16px; border-radius: 12px; border: 1px solid var(--bai-border); background: var(--bai-deep); text-align: left; }
.vault-lib .claim-c:hover { border-color: color-mix(in srgb, var(--bai-accent) 45%, var(--bai-border)); }
.vault-lib .claim-c[data-dead] { cursor: default; border-style: dashed; }
.vault-lib .claim-c[data-dead]:hover { border-color: var(--bai-border); }
.vault-lib .claim-c b { font-family: ${SERIF}; font-size: 17px; font-weight: 550; line-height: 1.35; color: var(--bai-text); }
.vault-lib .claim-c[data-dead] b { font-family: inherit; font-size: 13px; font-weight: 500; color: var(--bai-text-tertiary); word-break: break-all; }
.vault-lib .claim-c span { font-size: 13px; line-height: 1.5; color: var(--bai-text-secondary); }
.vault-lib .claim-c small { margin-top: auto; padding-top: 4px; font-size: 12px; color: var(--bai-text-tertiary); }
.vault-lib .vs-mid { display: grid; place-items: center; padding: 0 12px; }
.vault-lib .vs-mid span { writing-mode: vertical-rl; transform: rotate(180deg); font-size: 11.5px; letter-spacing: 0.04em; color: var(--bai-warn); }
.vault-lib .tcard-why { margin: 0 18px; padding: 10px 12px; border-radius: 9px; background: var(--bai-warn-soft); font-size: 13px; line-height: 1.55; color: var(--bai-text-secondary); }
.vault-lib .tcard-why b { color: var(--bai-text); font-weight: 600; }
.vault-lib .tcard-acts { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 14px 18px 16px; }
.vault-lib .tcard-acts .grow { flex: 1; font-size: 12.5px; color: var(--bai-text-tertiary); }

@container vlib (max-width: 900px) {
  .vault-lib .topic-list { grid-template-columns: minmax(0, 1fr); }
}
@container vlib (max-width: 640px) {
  .vault-lib { padding: 16px 16px 56px; }
  .vault-lib .overview { grid-template-columns: 96px minmax(0, 1fr); }
  .vault-lib .overview svg { width: 96px; height: 68px; }
  .vault-lib .overview .btn { grid-column: 2; justify-self: start; }
  .vault-lib .vs { grid-template-columns: minmax(0, 1fr); }
  .vault-lib .vs-mid { padding: 8px 0; }
  .vault-lib .vs-mid span { writing-mode: horizontal-tb; transform: none; }
}
@media (prefers-reduced-motion: reduce) { .vault-lib * { transition: none !important; } }
`;
