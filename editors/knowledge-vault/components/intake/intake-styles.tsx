/**
 * The intake's styles, once, scoped under `.bai-intake` so nothing leaks into
 * the vault or Connect. Every colour is a vault token, so the dark and light
 * themes come for free; motion stops for a reader who asked for less of it.
 *
 * Specificity: `.bai-intake .ik-*` (two classes) outranks Connect's element
 * rules for buttons and inputs, which once pushed text under an icon.
 */
const CSS = `
.bai-intake { color: var(--bai-text); }
.bai-intake :focus-visible { outline: 2px solid var(--bai-accent); outline-offset: 2px; }

/* buttons */
.bai-intake .ik-btn { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; border-radius: 7px; padding: 6px 12px; font-size: 12.5px; font-weight: 500; line-height: 1.2; border: 1px solid var(--bai-border); background: transparent; color: var(--bai-text-tertiary); cursor: pointer; transition: background-color 120ms ease, opacity 120ms ease, border-color 120ms ease; }
.bai-intake .ik-btn:hover:not(:disabled) { background: var(--bai-hover); }
.bai-intake .ik-btn:disabled { opacity: .45; cursor: default; }
.bai-intake .ik-btn-primary { background: var(--bai-accent); color: var(--bai-accent-text); border-color: transparent; font-weight: 600; }
.bai-intake .ik-btn-primary:hover:not(:disabled) { background: var(--bai-accent); opacity: .9; }
.bai-intake .ik-btn-secondary { color: var(--bai-accent); border-color: color-mix(in srgb, var(--bai-accent) 45%, var(--bai-border)); }
.bai-intake .ik-btn-quiet { border-color: transparent; padding: 6px 8px; }
.bai-intake .ik-btn-accent { color: var(--bai-accent); }
.bai-intake .ik-btn-big { font-size: 14px; padding: 10px 18px; border-radius: 9px; }
.bai-intake .ik-x { display: grid; place-items: center; width: 28px; height: 28px; flex: none; border-radius: 7px; border: 0; background: transparent; color: var(--bai-text-muted); cursor: pointer; }
.bai-intake .ik-x:hover { background: var(--bai-hover); color: var(--bai-text-secondary); }
.bai-intake .ik-x svg, .bai-intake .ik-btn svg { width: 14px; height: 14px; }
.bai-intake .ik-link { border: 0; background: none; padding: 0; font: inherit; font-weight: 500; color: var(--bai-accent); cursor: pointer; }
.bai-intake .ik-link:hover { text-decoration: underline; }

/* the panel */
.bai-intake.ik-panel { background: var(--bai-surface); border: 1px solid var(--bai-border); border-radius: 12px; }
.bai-intake .ik-head { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding: 15px 14px 14px 18px; }
.bai-intake .ik-head-what { min-width: 0; flex: 1 1 260px; }
.bai-intake .ik-head h3 { margin: 0; display: flex; align-items: center; gap: 9px; font-size: 15px; font-weight: 600; color: var(--bai-text); }
.bai-intake .ik-head p { margin: 3px 0 0; font-size: 13px; color: var(--bai-text-tertiary); }
.bai-intake .ik-head-tools { display: flex; align-items: center; gap: 6px; position: relative; }
.bai-intake .ik-ready { color: var(--bai-accent); font-weight: 500; }
.bai-intake .ik-look { color: var(--bai-warn); font-weight: 500; }
.bai-intake .ik-tick { display: grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; background: var(--bai-ok-soft); color: var(--bai-ok); }
.bai-intake .ik-tick svg { width: 12px; height: 12px; }
.bai-intake .ik-menu { position: absolute; top: calc(100% + 6px); right: 0; z-index: 20; min-width: 240px; padding: 5px; border-radius: 10px; background: var(--bai-overlay); border: 1px solid var(--bai-border); box-shadow: 0 12px 32px rgba(0,0,0,.28); }
.bai-intake .ik-menu button { display: block; width: 100%; text-align: left; border: 0; background: none; border-radius: 7px; padding: 8px 10px; font-size: 13px; color: var(--bai-text-secondary); cursor: pointer; }
.bai-intake .ik-menu button:hover:not(:disabled), .bai-intake .ik-menu button:focus-visible { background: var(--bai-overlay-hover); outline: none; }
.bai-intake .ik-menu button:disabled { color: var(--bai-text-muted); cursor: default; }
.bai-intake .ik-notice { display: flex; align-items: flex-start; gap: 10px; margin: 0 14px 12px 18px; padding: 9px 8px 9px 12px; border-radius: 9px; background: var(--bai-warn-soft); font-size: 12.5px; line-height: 1.5; color: var(--bai-text-secondary); }
.bai-intake .ik-notice > svg { width: 15px; height: 15px; flex: none; margin-top: 2px; color: var(--bai-warn); }
.bai-intake .ik-notice ul { margin: 2px 0 0; padding: 0; list-style: none; }
.bai-intake .ik-notice .ik-x { width: 24px; height: 24px; margin: -2px 0 -2px auto; }
.bai-intake .ik-note { padding: 0 18px 14px; font-size: 12px; color: var(--bai-text-tertiary); }

/* one file */
.bai-intake .ik-rows { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--bai-border); }
.bai-intake .ik-row { display: grid; grid-template-columns: 26px minmax(0, 1fr) auto 28px; column-gap: 14px; align-items: center; padding: 12px 14px 12px 18px; border-bottom: 1px solid var(--bai-border); }
.bai-intake .ik-row-main { min-width: 0; }
.bai-intake .ik-name { font-size: 13.5px; font-weight: 500; color: var(--bai-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bai-intake .ik-row[data-done] .ik-name { color: var(--bai-text-tertiary); }
.bai-intake .ik-sub { display: flex; align-items: center; gap: 12px; margin-top: 8px; min-width: 0; }
.bai-intake .ik-cap { min-width: 0; font-size: 12.5px; color: var(--bai-text-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bai-intake .ik-cap-ok { color: var(--bai-ok); }
.bai-intake .ik-cap-warn { color: var(--bai-warn); }
.bai-intake .ik-cap-danger { color: var(--bai-danger); }
.bai-intake .ik-sep { display: inline-block; width: 1px; height: 11px; margin: 0 10px; vertical-align: -1px; background: var(--bai-border); }
.bai-intake .ik-right { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
.bai-intake .ik-time { min-width: 34px; text-align: right; font-size: 12.5px; color: var(--bai-text-tertiary); font-variant-numeric: tabular-nums; }
.bai-intake .ik-addrow { display: flex; align-items: center; gap: 12px; padding: 12px 18px; font-size: 13px; color: var(--bai-text-tertiary); border-radius: 0 0 12px 12px; border: 1px dashed transparent; }
.bai-intake .ik-addrow[data-over] { border-color: var(--bai-accent); background: var(--bai-accent-soft); }
.bai-intake .ik-addrow .ik-plus { display: grid; place-items: center; width: 26px; height: 26px; flex: none; border-radius: 7px; border: 1px dashed color-mix(in srgb, var(--bai-accent) 50%, var(--bai-border)); color: var(--bai-accent); }
.bai-intake .ik-addrow .ik-plus svg { width: 13px; height: 13px; }

/* the file icon */
.bai-intake .ik-ficon { display: block; width: 26px; height: 32px; }
.bai-intake .ik-ficon-hero { width: 34px; height: 42px; }
.bai-intake .ik-ficon-page { fill: var(--bai-hover); }
.bai-intake .ik-ficon-fold { fill: var(--bai-text-faint); }
.bai-intake .ik-ficon text { fill: var(--bai-text-secondary); font: 700 6.6px Inter, system-ui, sans-serif; letter-spacing: .02em; }

/* the bar that becomes the sections */
.bai-intake .ik-strip, .bai-intake .ik-track { flex: none; width: min(100%, 380px); height: 6px; }
.bai-intake .ik-strip { display: flex; gap: 2px; }
.bai-intake .ik-strip > * { display: block; flex-basis: 0; min-width: 8px; height: 100%; border: 0; padding: 0; border-radius: 2px; background: var(--bai-accent); }
.bai-intake .ik-strip > .ik-off { background: transparent; box-shadow: inset 0 0 0 1px var(--bai-text-faint); }
.bai-intake .ik-strip[data-tone="added"] > :not(.ik-off) { background: var(--bai-ok); opacity: .8; }
.bai-intake .ik-strip[data-size="map"] { width: 100%; height: 8px; gap: 3px; }
.bai-intake .ik-strip[data-size="map"] > * { min-width: 12px; opacity: .4; cursor: pointer; }
.bai-intake .ik-strip[data-size="map"] > .ik-here { opacity: 1; }
.bai-intake .ik-strip[data-size="map"] > .ik-off { opacity: .8; }
.bai-intake .ik-strip[data-split] { animation: ik-crack 450ms cubic-bezier(.2,.8,.2,1); }
.bai-intake .ik-strip[data-split] > .ik-off { animation: ik-let-go 600ms 250ms ease-out both; }
@keyframes ik-crack { from { gap: 0; } to { gap: 2px; } }
@keyframes ik-let-go { from { background: var(--bai-accent); box-shadow: none; } to { background: transparent; box-shadow: inset 0 0 0 1px var(--bai-text-faint); } }
.bai-intake .ik-track { position: relative; overflow: hidden; border-radius: 3px; background: var(--bai-hover); }
.bai-intake .ik-track-fill { position: absolute; top: 0; bottom: 0; left: 0; border-radius: 3px; background: var(--bai-accent); transition: width 500ms ease; }
.bai-intake .ik-track-glow { position: absolute; top: 0; bottom: 0; left: 0; width: 34%; border-radius: 3px; background: linear-gradient(90deg, transparent, var(--bai-accent) 35%, var(--bai-accent) 65%, transparent); transform: translateX(95%); animation: ik-glow 1.6s ease-in-out infinite; }
@keyframes ik-glow { from { transform: translateX(-100%); } to { transform: translateX(300%); } }

/* folded to one line */
.bai-intake.ik-folded { display: flex; align-items: center; gap: 12px; padding: 10px 12px 10px 16px; background: var(--bai-surface); border: 1px solid var(--bai-border); border-radius: 12px; font-size: 13px; color: var(--bai-text-tertiary); }
.bai-intake.ik-folded b { color: var(--bai-text); font-weight: 600; }
.bai-intake.ik-folded .ik-folded-tools { margin-left: auto; display: flex; gap: 6px; }
.bai-intake .ik-mark { width: 22px; height: 22px; flex: none; }
.bai-intake .ik-mark line { stroke: var(--bai-text-faint); stroke-width: 1.4; }
.bai-intake .ik-mark circle { fill: var(--bai-text-faint); }
.bai-intake .ik-mark .ik-mark-hub { fill: var(--bai-accent); }
.bai-intake .ik-mark-working .ik-mark-n1 { animation: ik-blink 2.4s infinite; }
.bai-intake .ik-mark-working .ik-mark-n2 { animation: ik-blink 2.4s .8s infinite; }
.bai-intake .ik-mark-working .ik-mark-n3 { animation: ik-blink 2.4s 1.6s infinite; }
@keyframes ik-blink { 0%, 60%, 100% { fill: var(--bai-text-faint); } 20% { fill: var(--bai-accent); } }

/* the drop zone */
.bai-intake .ik-drop { border: 1.5px dashed color-mix(in srgb, var(--bai-accent) 40%, var(--bai-border)); border-radius: 16px; padding: 28px 24px 24px; text-align: center; background: color-mix(in srgb, var(--bai-accent) 3%, var(--bai-surface)); transition: border-color 120ms ease, background-color 120ms ease; }
.bai-intake .ik-drop[data-over] { border-color: var(--bai-accent); background: var(--bai-accent-soft); }
.bai-intake .ik-drop[data-disabled] { opacity: .5; }
.bai-intake .ik-drop-demo { display: flex; align-items: center; justify-content: center; gap: 14px; margin-bottom: 18px; }
.bai-intake .ik-drop-demo .ik-strip { width: 150px; height: 10px; gap: 3px; }
.bai-intake .ik-drop-demo .ik-strip > * { border-radius: 3px; }
.bai-intake .ik-drop-arrow { position: relative; width: 28px; height: 1.5px; background: var(--bai-text-faint); }
.bai-intake .ik-drop-arrow::after { content: ""; position: absolute; right: -1px; top: -3px; border: 4px solid transparent; border-left: 5px solid var(--bai-text-faint); border-right: 0; }
.bai-intake .ik-drop-title { font-size: 15px; font-weight: 500; color: var(--bai-text); }
.bai-intake .ik-drop .ik-btn { margin-top: 14px; }
.bai-intake .ik-drop-small { margin-top: 12px; font-size: 12.5px; color: var(--bai-text-tertiary); }

/* the review */
.bai-intake.ik-review { position: fixed; inset: 0; z-index: 100; }
.bai-intake .ik-scrim { position: absolute; inset: 0; background: rgba(8, 8, 14, .58); }
[data-bai-theme="light"] .bai-intake .ik-scrim, html[data-bai-toast-theme="light"] .bai-intake .ik-scrim { background: rgba(31, 41, 55, .28); }
.bai-intake .ik-sheet { position: absolute; top: 0; right: 0; bottom: 0; width: min(1040px, 100%); display: grid; grid-template-rows: auto minmax(0, 1fr) auto; background: var(--bai-surface); border-left: 1px solid var(--bai-border); box-shadow: -30px 0 70px rgba(0,0,0,.35); animation: ik-sheet-in 180ms cubic-bezier(.2,.8,.2,1); outline: none; }
@keyframes ik-sheet-in { from { transform: translateX(28px); opacity: 0; } to { transform: none; opacity: 1; } }
.bai-intake .ik-shead { padding: 20px 22px 18px 26px; border-bottom: 1px solid var(--bai-border); }
.bai-intake .ik-shead-top { display: flex; align-items: flex-start; gap: 16px; }
.bai-intake .ik-shead h2 { flex: 1; margin: 0; font-size: 19px; line-height: 1.3; font-weight: 600; color: var(--bai-text); overflow-wrap: anywhere; outline: none; }
.bai-intake .ik-lead { margin: 7px 0 0; max-width: 72ch; font-size: 13.5px; line-height: 1.55; color: var(--bai-text-secondary); }
.bai-intake .ik-meta { margin: 3px 0 0; font-size: 12.5px; color: var(--bai-text-tertiary); }
.bai-intake .ik-callout { display: flex; gap: 10px; margin-top: 12px; padding: 10px 13px; border-radius: 9px; background: var(--bai-warn-soft); font-size: 13px; line-height: 1.5; color: var(--bai-text-secondary); }
.bai-intake .ik-callout > svg { width: 16px; height: 16px; flex: none; margin-top: 2px; color: var(--bai-warn); }
.bai-intake .ik-callout .ik-link { margin-left: 4px; }
.bai-intake .ik-callout[data-tone="info"] { background: var(--bai-accent-soft); }
.bai-intake .ik-callout[data-tone="info"] > svg { color: var(--bai-accent); }
.bai-intake .ik-shead .ik-strip { margin-top: 16px; }
.bai-intake .ik-sbody { display: grid; grid-template-columns: minmax(240px, 320px) minmax(0, 1fr); min-height: 0; }
.bai-intake .ik-slist { overflow: auto; padding: 10px 10px 14px; border-right: 1px solid var(--bai-border); }
.bai-intake .ik-all { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; padding: 8px 10px 10px; border-bottom: 1px solid var(--bai-border); font-size: 12.5px; color: var(--bai-text-tertiary); cursor: pointer; }
.bai-intake .ik-all b { font-weight: 500; color: var(--bai-text-secondary); }
.bai-intake .ik-all span { margin-left: auto; }
.bai-intake .ik-sec { display: grid; grid-template-columns: 16px minmax(0, 1fr) auto; gap: 10px; align-items: start; padding: 8px 10px; border-radius: 8px; }
.bai-intake .ik-sec:hover { background: var(--bai-hover); }
.bai-intake .ik-sec[data-here] { background: var(--bai-accent-soft); box-shadow: inset 2px 0 0 var(--bai-accent); }
.bai-intake .ik-sec-title { border: 0; background: none; padding: 0; text-align: left; font-size: 13px; line-height: 1.4; color: var(--bai-text-secondary); cursor: pointer; }
.bai-intake .ik-sec[data-off] .ik-sec-title { color: var(--bai-text-tertiary); }
.bai-intake .ik-why { display: block; margin-top: 2px; font-size: 12px; color: var(--bai-text-tertiary); }
.bai-intake .ik-sec-time { padding-top: 1px; font-size: 12px; color: var(--bai-text-tertiary); white-space: nowrap; }
.bai-intake input[type="checkbox"] { width: 15px; height: 15px; margin: 2px 0 0; accent-color: var(--bai-accent); cursor: pointer; }
.bai-intake .ik-reader { overflow: auto; padding: 22px 32px 30px; }
.bai-intake .ik-rtop { display: flex; align-items: center; gap: 14px; margin-bottom: 6px; }
.bai-intake .ik-rtop h3 { flex: 1; margin: 0; font-size: 17px; font-weight: 600; color: var(--bai-text); }
.bai-intake .ik-keep { display: inline-flex; align-items: center; gap: 7px; padding: 5px 10px 5px 8px; border: 1px solid var(--bai-border); border-radius: 7px; font-size: 12.5px; color: var(--bai-text-secondary); cursor: pointer; }
.bai-intake .ik-keep input { margin: 0; }
.bai-intake .ik-stepper { display: inline-flex; align-items: center; gap: 2px; font-size: 12.5px; color: var(--bai-text-tertiary); font-variant-numeric: tabular-nums; }
.bai-intake .ik-stepper .ik-x { width: 26px; height: 26px; }
.bai-intake .ik-joined { margin: 0 0 4px; font-size: 12px; color: var(--bai-text-tertiary); }
.bai-intake .ik-content { max-width: 68ch; margin-top: 14px; }
/* The section's own headings sit under the reader's title, so they stay below its size. */
.bai-intake .ik-content .md-preview h1.md-h1 { font-size: 16px; font-weight: 600; margin: 18px 0 6px; }
.bai-intake .ik-content .md-preview h2.md-h2 { font-size: 15px; font-weight: 600; margin: 18px 0 6px; border-bottom: 0; padding-bottom: 0; }
.bai-intake .ik-content .md-preview h3.md-h3, .bai-intake .ik-content .md-preview h4.md-h4, .bai-intake .ik-content .md-preview h5.md-h5, .bai-intake .ik-content .md-preview h6.md-h6 { font-size: 14px; font-weight: 600; color: var(--bai-text); margin: 14px 0 4px; }
.bai-intake .ik-content > div.md-preview:first-of-type > :first-child { margin-top: 0; }
.bai-intake .ik-figure { margin: 14px 0 18px; }
.bai-intake .ik-figure img { display: block; width: auto; max-width: 100%; height: auto; margin: 0 auto; border-radius: 8px; background: #fff; box-shadow: 0 0 0 1px var(--bai-border); }
.bai-intake .ik-figure[data-kind="formula"] img { max-height: 120px; }
.bai-intake .ik-figure figcaption { margin-top: 6px; text-align: center; font-size: 12px; color: var(--bai-text-tertiary); }
.bai-intake .ik-sfoot { display: flex; align-items: center; gap: 20px; padding: 14px 22px 14px 26px; border-top: 1px solid var(--bai-border); }
.bai-intake .ik-where { min-width: 0; flex: 1; font-size: 12.5px; line-height: 1.55; color: var(--bai-text-tertiary); }
.bai-intake .ik-crumb { color: var(--bai-text-secondary); font-weight: 500; overflow-wrap: anywhere; }
.bai-intake .ik-dest { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; margin-bottom: 4px; }
.bai-intake .ik-dest label { display: inline-flex; align-items: center; gap: 8px; color: var(--bai-text-tertiary); }
.bai-intake .ik-dest input[type="text"], .bai-intake .ik-dest select { box-sizing: border-box; padding: 5px 9px; border-radius: 7px; border: 1px solid var(--bai-border); background: var(--bai-bg); color: var(--bai-text-secondary); font-size: 12.5px; }
.bai-intake .ik-dest input[type="text"] { width: 260px; max-width: 100%; }
.bai-intake .ik-dest input[type="text"]:focus, .bai-intake .ik-dest select:focus { border-color: var(--bai-accent); outline: none; }
.bai-intake .ik-error { color: var(--bai-danger); }
@media (max-width: 760px) {
  .bai-intake .ik-sbody { grid-template-columns: 1fr; grid-template-rows: minmax(0, 38%) minmax(0, 1fr); }
  .bai-intake .ik-slist { border-right: 0; border-bottom: 1px solid var(--bai-border); }
  .bai-intake .ik-reader { padding: 18px 20px 24px; }
  .bai-intake .ik-sfoot { flex-wrap: wrap; }
  .bai-intake .ik-row { grid-template-columns: 26px minmax(0, 1fr) 28px; }
  .bai-intake .ik-right { grid-column: 2; grid-row: 2; justify-content: flex-start; margin-top: 10px; }
}

@media (prefers-reduced-motion: reduce) {
  .bai-intake .ik-track-glow { animation: none; }
  .bai-intake .ik-strip[data-split], .bai-intake .ik-strip[data-split] > .ik-off { animation: none; }
  .bai-intake .ik-mark-working circle { animation: none; }
  .bai-intake .ik-sheet { animation: none; }
}
`;

export function IntakeStyles() {
  return <style>{CSS}</style>;
}
