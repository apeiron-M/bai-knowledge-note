/** Scoped stylesheet for the Scope of Work editor. Every selector is prefixed with `.sow`. */
export const SOW_CSS = `
.sow{--canvas:var(--bai-bg);--panel:var(--bai-surface);--panel-2:var(--bai-hover);--ink:var(--bai-text);--ink-2:var(--bai-text-secondary);--ink-3:var(--bai-text-muted);--rule:var(--bai-border);--rule-2:var(--bai-border);
  --meridian:var(--bai-status-canonical);--meridian-soft:color-mix(in srgb,var(--bai-status-canonical) 16%,transparent);--signal:var(--bai-status-review);--signal-soft:color-mix(in srgb,var(--bai-status-review) 16%,transparent);--ember:rgb(248,113,113);--ember-soft:rgba(248,113,113,.15);--slate:var(--bai-text-muted);--slate-soft:var(--bai-hover);--focus:var(--bai-accent);
  --r:10px;--display:"Bricolage Grotesque",Inter,system-ui,sans-serif;--ui:Inter,system-ui,sans-serif;--mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
  font:14px/1.45 var(--ui);color:var(--ink);background:var(--canvas);-webkit-font-smoothing:antialiased;
  display:grid;grid-template-columns:264px minmax(0,1fr) 372px;grid-template-rows:minmax(0,1fr);grid-template-areas:"rail canvas inspector";overflow:visible;height:calc(100vh - 96px);min-height:420px}
[data-bai-theme="dark"] .sow{color-scheme:dark}
[data-bai-theme="light"] .sow{color-scheme:light}
.sow.no-inspector{grid-template-columns:264px minmax(0,1fr) 0}
.sow.no-rail{grid-template-columns:0 minmax(0,1fr) 372px}
.sow.no-rail.no-inspector{grid-template-columns:0 minmax(0,1fr) 0}
.sow.no-rail .rail{display:none}
.sow *{box-sizing:border-box}
/* -- hosted inside the vault shell ---------------------------------------
   DriveExplorer reserves a left column as wide as this editor's rail and puts
   the vault tab bar in the column beside it, so the rail reaches the top of
   the window like the vault's own sidebar instead of starting below the bar.
   The bar covers this editor's top-right corner; the shell publishes its
   height as --vault-topbar-h.

   A reserved top ROW, not padding on the canvas: the canvas and inspector
   keep their own spacing exactly as designed, and the rail spans both rows so
   it still starts at the very top. The rail keeps its own outline toggle
   where it puts it -- the shell leaves a gutter beside the rail wide enough
   for it.

   The document toolbar is the one piece that has to move. It is first in the
   flow and full width, so in place it would slide under the tab bar and, once
   opened, push the rail down out of the top-left corner. Parked in the corner
   the bar and the sidebar leave -- below one, beside the other -- it does
   neither, and the row above reserves its height so it never covers the
   canvas. Its handle hangs from its own bottom edge and follows it. Every
   value defaults to 0, so outside the vault this block is inert. */
[data-vault-hosts-editor] .sow{grid-template-rows:calc(var(--vault-topbar-h,0px) + var(--vault-doctoolbar-h,0px)) minmax(0,1fr);grid-template-areas:"rail . ." "rail canvas inspector"}
[data-vault-hosts-editor] .sow-tb{position:absolute;top:var(--vault-topbar-h,0px);left:var(--vault-sidebar-w,0px);right:0}
.sow button:where(:not(.wbs-embed *)),.sow input:where(:not(.wbs-embed *)),.sow select:where(:not(.wbs-embed *)),.sow textarea:where(:not(.wbs-embed *)){font:inherit;color:inherit}
.sow button:where(:not(.wbs-embed *)){cursor:pointer;background:none;border:0;padding:0}
.sow :focus-visible{outline:2px solid var(--focus);outline-offset:2px;border-radius:4px}
.sow .mono{font-family:var(--mono);font-size:12.5px;letter-spacing:.01em}
.sow .muted{color:var(--ink-2)} .sow .faint{color:var(--ink-3)}
.sow .btn{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:8px;border:1px solid var(--rule-2);background:var(--panel);font-weight:500;font-size:13px;white-space:nowrap}
.sow .btn:hover{background:var(--panel-2)} .sow .btn.primary{background:var(--bai-accent);color:var(--bai-accent-text);border-color:var(--bai-accent)} .sow .btn.primary:hover{opacity:.92}
.sow .btn.ghost{border-color:transparent} .sow .btn.sm{height:26px;padding:0 9px;font-size:12.5px;border-radius:7px} .sow .btn.danger{color:var(--ember)}
/* collapsible document toolbar — zero height when folded; the handle floats over the canvas's top padding */
.sow-tb{position:relative;z-index:6}
.sow .sow-rail-wrap{grid-area:rail;position:relative;min-width:0;min-height:0;height:100%}
/* One drawer handle, hung from two edges. The toolbar's hangs from the bar's
   bottom edge, the rail's from the rail's right edge; both are absolutely
   positioned so a hover that widens the label never re-lays-out the grid the
   canvas lives in — the difference between a smooth reveal and a judder.
   The rail selectors carry an extra 'button' so they outrank the .sow button reset. */
.sow-tb-handle,.sow button.sow-rail-handle{position:absolute;z-index:6;display:inline-flex;align-items:center;gap:4px;height:14px;padding:0 7px;border:1px solid var(--bai-border);background:var(--bai-surface);color:var(--bai-text-faint);font:10px/1 Inter,system-ui,sans-serif;letter-spacing:.03em;white-space:nowrap;cursor:pointer;opacity:.75;transition:opacity .12s ease,color .12s ease,background .12s ease}
.sow-tb-handle{left:50%;top:100%;transform:translateX(-50%);border-top:0;border-radius:0 0 8px 8px}
.sow button.sow-rail-handle{left:100%;top:20px;border-left:0;border-radius:0 8px 8px 0}
.sow-tb-handle:hover,.sow-tb-handle:focus-visible,.sow button.sow-rail-handle:hover,.sow button.sow-rail-handle:focus-visible{opacity:1;color:var(--bai-text-secondary);background:var(--bai-hover)}
.sow-tb-handle:focus-visible,.sow button.sow-rail-handle:focus-visible{outline:2px solid var(--bai-accent);outline-offset:1px}
.sow-tb-chev,.sow-rail-chev{display:inline-block;font-size:9px;transition:transform .15s ease}
.sow-tb-handle.open .sow-tb-chev{transform:rotate(180deg)}
.sow-rail-chev{transform:rotate(-90deg)}
.sow-rail-handle.open .sow-rail-chev{transform:rotate(90deg)}
.sow-tb-label,.sow-rail-label{display:inline-block;max-width:0;overflow:hidden;white-space:nowrap;transition:max-width .15s ease}
.sow-tb-handle:hover .sow-tb-label,.sow-tb-handle:focus-visible .sow-tb-label,.sow-tb-handle.open .sow-tb-label,.sow-rail-handle:hover .sow-rail-label,.sow-rail-handle:focus-visible .sow-rail-label{max-width:60px}
/* embedded WBS (wbs-editor components, tailwind + --bai vars): give tailwind a sane base and keep .sow resets away */
.sow .wbs-embed{font:13px/1.5 var(--ui);color:var(--bai-text)}
.sow .wbs-embed button{cursor:pointer}
/* rail */
.sow .rail{min-width:0;min-height:0;height:100%;border-right:1px solid var(--rule);background:var(--panel);overflow:auto;padding:12px 10px}
.sow .sect{margin-top:14px;padding:0 4px 0 2px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);display:flex;align-items:center;justify-content:space-between;gap:8px}
.sow .sect button{color:var(--ink-3);font-size:12px} .sow .sect button:hover{color:var(--ink)}
/* a section label that is also a view link; outranks the .sect button reset above */
.sow .sect button.sect-label{font:inherit;letter-spacing:inherit;text-transform:inherit;color:inherit;padding:2px 5px;margin-left:-2px;border-radius:5px}
.sow .sect button.sect-label:hover{color:var(--ink);background:var(--panel-2)}
.sow .sect button.sect-label.active{color:var(--ink);background:var(--slate-soft);font-weight:600}
/* list views: a roadmap row folds open to its milestones */
.sow .tbl td.fold{width:26px;padding:0 0 0 6px}
.sow .tbl tr.sub td{background:color-mix(in srgb,var(--panel-2) 45%,transparent)}
.sow .tbl tr.sub td.grow{padding-left:34px}
.sow .msdot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--panel);border:2px solid var(--rule-2);margin-right:8px;vertical-align:-1px;flex:none}
.sow .msdot.done{background:var(--meridian);border-color:var(--meridian)}
.sow .msdot.live{border-color:var(--signal);box-shadow:0 0 0 3px var(--signal-soft)}
.sow .msdot.overdue{border-color:var(--ember);background:var(--ember-soft)}
.sow .tbl td .prog-sub.ember{color:var(--ember)}
.sow .tbl td .prog-sub{font-size:11.5px;color:var(--ink-3);margin-top:3px;font-variant-numeric:tabular-nums}
/* A table's primary column never collapses: td.grow's max-width:0 hands it only
   the leftover width, and with enough nowrap siblings that is zero. min-width
   wins over max-width, and .rows.scroll lets a too-wide table scroll instead of
   the later .rows{overflow:hidden} clipping it. */
.sow .tbl td.grow.primary,.sow .tbl th.grow.primary{min-width:200px}
.sow .rows.scroll{overflow-x:auto}
.sow .tbl tfoot tr+tr td{border-top:1px solid var(--rule)}
/* a footer row that is one quiet link to the rest of the list */
.sow .tbl tfoot td.link{font-weight:500;background:transparent;padding:0}
.sow .tbl tfoot td.link button{display:block;width:100%;text-align:left;padding:9px 12px;color:var(--ink-2);font-size:12.5px}
.sow .tbl tfoot td.link button:hover{color:var(--ink);background:var(--panel-2)}
.sow .sect-toggle{display:inline-flex;align-items:center;gap:2px;min-width:0;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:inherit}
.sow .chev{width:18px;height:22px;flex:none;display:inline-flex;align-items:center;justify-content:center;color:var(--ink-3);transform:rotate(0deg);transition:transform .15s ease;border-radius:4px;font-size:11px;line-height:1}
.sow .chev.open{transform:rotate(90deg)}
.sow .chev:hover{color:var(--ink);background:var(--panel-2)}
.sow .chev.spacer{visibility:hidden;pointer-events:none}
.sow .node{display:flex;align-items:center;gap:2px;width:100%;text-align:left;padding:2px 6px 2px 2px;border-radius:7px;color:var(--ink-2);font-size:13px}
.sow button.node{padding:6px 8px;gap:8px}
.sow .node:hover{background:var(--panel-2);color:var(--ink)} .sow .node.active{background:var(--slate-soft);color:var(--ink);font-weight:500}
.sow .node .main{display:flex;align-items:center;gap:8px;flex:1;min-width:0;text-align:left;padding:4px 4px;border-radius:6px;color:inherit;font:inherit;font-weight:inherit}
.sow .node .main>span:not(.code){overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sow .node .code{font-family:var(--mono);font-size:11px;color:var(--ink-3);min-width:26px;flex:none}
.sow .node .cnt{margin-left:auto;font-size:11px;color:var(--ink-3);font-family:var(--mono);flex:none;padding-right:4px}
.sow .node.child{padding-left:20px;font-size:12.5px} .sow .node.child .ring{margin-left:auto}
.sow .node.signal,.sow .node.signal .main{color:var(--signal)}
.sow .ring{--p:0;width:14px;height:14px;border-radius:50%;background:conic-gradient(var(--meridian) calc(var(--p)*1%),var(--rule) 0);position:relative;flex:none}
.sow .ring::after{content:"";position:absolute;inset:3px;border-radius:50%;background:var(--panel)}
/* canvas */
.sow .canvas{grid-area:canvas;overflow:auto;padding:28px 36px 80px}
.sow .doc{max-width:980px;margin:0 auto}
.sow .eyebrow{font-size:11.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);font-weight:600}
.sow .eyebrow-row{display:flex;align-items:center;gap:10px;min-width:0;flex-wrap:wrap}
.sow .doc-id{display:inline-flex;align-items:center;gap:5px;min-width:0;max-width:100%;font-family:var(--mono);font-size:10.5px;font-weight:500;letter-spacing:0;text-transform:none;color:var(--ink-3);background:transparent;border:1px solid transparent;border-radius:6px;padding:1px 5px;cursor:pointer;transition:background .12s ease,color .12s ease,border-color .12s ease}
.sow .doc-id:hover{background:var(--panel-2);color:var(--ink-2);border-color:var(--rule-2)}
.sow .doc-id:focus-visible{outline:0;border-color:var(--focus);color:var(--ink-2)}
.sow .doc-id[data-copied]{color:var(--meridian);border-color:transparent;background:var(--meridian-soft)}
.sow .doc-id-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sow .doc-id-icon{flex:none;opacity:.75}
.sow .doc-id:hover .doc-id-icon{opacity:1}
.sow .doc-id-said{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.sow h1.title{font-family:var(--display);font-size:34px;font-weight:700;letter-spacing:-.02em;line-height:1.1;margin:6px 0 8px}
.sow h2:where(:not(.wbs-embed *)){font-family:var(--display);font-size:20px;font-weight:650;letter-spacing:-.01em;margin:0}
.sow h3:where(:not(.wbs-embed *)){font-size:14px;font-weight:600;margin:0}
.sow .inline{background:transparent;border:1px solid transparent;border-radius:6px;padding:2px 6px;margin-left:-6px;width:100%;color:inherit;font:inherit;letter-spacing:inherit;line-height:inherit}
.sow .inline:hover{background:var(--panel-2)} .sow .inline:focus{background:var(--panel);outline:0;border-color:var(--focus)}
.sow .inline::placeholder{color:var(--ink-3);font-weight:400}
.sow textarea.inline{resize:none;overflow:hidden}
.sow .desc{max-width:680px;color:var(--ink-2);font-size:15px;margin:0}
.sow .chip{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 8px;border-radius:999px;font-size:12px;font-weight:500;background:var(--slate-soft);color:var(--ink-2);white-space:nowrap}
.sow .chip::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.8}
.sow .chip.DELIVERED,.sow .chip.FINISHED,.sow .chip.APPROVED{background:var(--meridian-soft);color:var(--meridian)}
.sow .chip.IN_PROGRESS,.sow .chip.SUBMITTED{background:var(--signal-soft);color:var(--signal)}
.sow .chip.BLOCKED,.sow .chip.REJECTED{background:var(--ember-soft);color:var(--ember)}
.sow .chip.CANCELED,.sow .chip.WONT_DO{text-decoration:line-through;opacity:.7}
.sow .chip.TODO{background:var(--slate-soft);color:var(--slate)}
.sow .chip.DRAFT{background:transparent;border:1px dashed var(--rule-2);color:var(--ink-3)} .sow .chip.DRAFT::before{display:none}
.sow .tag{display:inline-flex;align-items:center;height:20px;padding:0 7px;border-radius:5px;font-size:11.5px;font-weight:500;background:var(--ember-soft);color:var(--ember)}
.sow .tag.warn{background:var(--signal-soft);color:var(--signal)}
.sow .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:26px 0}
.sow .kpis.three{grid-template-columns:repeat(3,1fr)}
.sow .kpi{background:var(--panel);border:1px solid var(--rule);border-radius:var(--r);padding:14px 16px;min-width:0}
.sow .kpi .l{font-size:12px;color:var(--ink-3)} .sow .kpi .v{font-family:var(--display);font-size:26px;font-weight:650;letter-spacing:-.02em;margin-top:2px;overflow-wrap:anywhere} .sow .kpi .s{font-size:12px;color:var(--ink-2);margin-top:2px}
/* several currencies in one figure: amount column right-aligned, code beside it */
.sow .money-stack{display:inline-grid;grid-template-columns:auto auto;column-gap:8px;row-gap:1px;align-items:baseline;font-variant-numeric:tabular-nums}
.sow .money-stack .money-row{display:contents}
.sow .money-stack .amt{text-align:right}
.sow .money-stack .cur{font-family:var(--mono);font-size:11px;font-weight:500;letter-spacing:.04em;color:var(--ink-3)}
.sow .kpi .v .money-stack{font-size:17px;line-height:1.3;margin-top:4px}
.sow .tbl .money-stack{font-family:var(--mono);font-size:12.5px;font-weight:400;letter-spacing:.01em;row-gap:0}
.sow .tbl .money-stack .cur{font-size:10.5px}
.sow .card{background:var(--panel);border:1px solid var(--rule);border-radius:var(--r);padding:18px 20px}
.sow .section{margin-top:34px} .sow .section .hd{display:flex;align-items:baseline;gap:12px;margin-bottom:12px;flex-wrap:wrap} .sow .grow{flex:1}
.sow .toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:6px;font-size:12.5px;color:var(--ink-2)}
.sow .toolbar select,.sow .toolbar input{height:30px}
/* next up: every dated milestone as an unlabelled tick on one proportional
   time line; the list beneath names the few that matter now */
.sow .minimap{padding:0 8px;margin:2px 0 12px}
.sow .minimap .track{position:relative;height:52px}
.sow .minimap .end{position:absolute;top:0;font-size:10.5px;color:var(--ink-3);font-variant-numeric:tabular-nums;white-space:nowrap}
.sow .minimap .end.lo{left:0} .sow .minimap .end.hi{right:0}
.sow .minimap .axis{position:absolute;left:0;right:0;top:25px;height:2px;background:var(--rule-2);border-radius:2px}
.sow .minimap .today{position:absolute;top:17px;width:1px;height:18px;background:var(--ink-2);transform:translateX(-50%)}
.sow .minimap .today span{position:absolute;top:20px;left:50%;transform:translateX(-50%);font-size:10.5px;color:var(--ink-3);white-space:nowrap}
.sow .minimap .tick{position:absolute;top:20px;width:12px;height:12px;border-radius:50%;background:var(--panel);border:2px solid var(--rule-2);transform:translateX(-50%);display:inline-flex;align-items:center;justify-content:center;font:9px/1 var(--mono);color:var(--ink-2);transition:transform .12s ease}
.sow .minimap .tick.multi{width:16px;height:16px;top:18px}
.sow .minimap .tick.done{background:var(--meridian);border-color:var(--meridian);color:#fff}
.sow .minimap .tick.live{border-color:var(--signal);box-shadow:0 0 0 4px var(--signal-soft)}
.sow .minimap .tick.overdue{border-color:var(--ember);background:var(--ember-soft);color:var(--ember)}
.sow .minimap .tick:hover,.sow .minimap .tick:focus-visible{transform:translateX(-50%) scale(1.3);z-index:1}
/* triage: only what needs a decision, only while it does */
.sow .triage{display:flex;flex-wrap:wrap;gap:8px;margin:-10px 0 0}
.sow .pill{display:inline-flex;align-items:center;gap:7px;height:26px;padding:0 11px 0 9px;border-radius:13px;border:1px solid var(--rule);background:var(--panel);font-size:12.5px;font-weight:500;color:var(--ink-2)}
.sow .pill i{width:8px;height:8px;border-radius:50%;background:var(--slate);flex:none}
.sow .pill.ember{color:var(--ember);background:var(--ember-soft);border-color:transparent} .sow .pill.ember i{background:var(--ember)}
.sow .pill.signal{color:var(--signal);background:var(--signal-soft);border-color:transparent} .sow .pill.signal i{background:var(--signal)}
.sow .pill:hover{filter:brightness(1.08)}
.sow .bar{height:6px;background:var(--rule);border-radius:4px;overflow:hidden;min-width:60px} .sow .bar i{display:block;height:100%;background:var(--meridian);border-radius:4px;transition:width .4s}
.sow .bar.signal i{background:var(--signal)}
/* plan: envelopes down, milestones across; a cell counts what lands there */
.sow .plan{display:grid;border:1px solid var(--rule);border-radius:var(--r);overflow:hidden;background:var(--panel)}
.sow .plan.wide{overflow:auto;max-height:72vh}
.sow .plan .c{padding:8px;border-right:1px solid var(--rule);border-bottom:1px solid var(--rule);min-height:52px;min-width:0;display:flex;align-items:center;justify-content:center}
.sow .plan .c.h{background:var(--panel-2);font-size:11.5px;color:var(--ink-2);flex-direction:column;align-items:flex-start;justify-content:flex-end;gap:1px;padding:8px 8px 7px;min-height:0}
.sow .plan .c.h .code{font-family:var(--mono);font-size:11px;color:var(--ink-3)}
.sow .plan .c.h b{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;max-width:100%;font-weight:600;color:var(--ink);overflow:hidden;white-space:normal;overflow-wrap:anywhere;line-height:1.25}
.sow .plan .c.h .dt{font-size:10.5px;color:var(--ink-3);font-variant-numeric:tabular-nums;white-space:nowrap}
.sow .plan .c.h.agg .dt{white-space:normal}
.sow .plan .c.h.agg b{overflow-wrap:normal}
.sow .plan .c.agg{background:color-mix(in srgb,var(--panel-2) 45%,transparent)}
.sow .plan .c.h.agg{background:color-mix(in srgb,var(--panel-2) 70%,var(--panel))}
.sow .plan .c.key{position:relative;overflow:hidden;padding:0;min-height:72px;display:block}
.sow .plan .key-diag{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none}
.sow .plan .key-diag line{stroke:var(--rule);stroke-width:1;vector-effect:non-scaling-stroke}
.sow .plan .key-col,.sow .plan .key-row{position:absolute;z-index:1;font-size:11px;font-weight:500;color:var(--ink-3);line-height:1.2}
.sow .plan .key-col{top:8px;right:10px;text-align:right}
.sow .plan .key-row{bottom:8px;left:10px}
.sow .plan .c.rh{display:block;background:var(--panel-2);font-size:12.5px;padding:10px}
.sow .plan .rh .code{font-family:var(--mono);font-size:11px;color:var(--ink-3)}
.sow .plan .rh b{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-weight:600;color:var(--ink);line-height:1.3}
.sow .plan .rh .money{font-family:var(--mono);font-size:11.5px;color:var(--ink-2);margin-top:4px}
.sow .plan.wide .c.rh,.sow .plan.wide .c.key{position:sticky;left:0;z-index:2}
.sow .plan.wide .c.h{position:sticky;top:0;z-index:3}
.sow .plan.wide .c.key{z-index:4}
.sow .hc{min-width:32px;height:26px;padding:0 9px;border-radius:13px;display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--rule-2);background:var(--panel);color:var(--ink);font-family:var(--mono);font-size:12.5px;font-variant-numeric:tabular-nums;transition:background .12s ease,border-color .12s ease}
.sow .hc i{width:6px;height:6px;border-radius:50%;background:var(--slate);flex:none}
.sow .hc.DELIVERED{border-color:var(--meridian);color:var(--meridian)} .sow .hc.DELIVERED i{background:var(--meridian)}
.sow .hc.IN_PROGRESS{border-color:var(--signal)} .sow .hc.IN_PROGRESS i{background:var(--signal)}
.sow .hc.BLOCKED{border-color:var(--ember);color:var(--ember);background:var(--ember-soft)} .sow .hc.BLOCKED i{background:var(--ember)}
.sow .hc:hover{background:var(--panel-2)}
/* the plan at two densities. cards: a small plan shows every deliverable in its
   cell. chips: a count per cell; clicking one zooms that cell in place — its
   column widens, its row grows, the sibling columns compress to their codes */
.sow .plan{transition:grid-template-columns .22s ease}
.sow .plan.zoomed{overflow-x:auto}
.sow .plan.cards .c{display:block;padding:8px}
.sow .plan.cards .c.h{display:flex}
.sow .plan .c.h{position:relative}
.sow .plan .c.h .h-open{position:absolute;top:5px;right:5px;padding:1px 6px;border-radius:5px;font-size:10.5px;color:var(--ink-2);background:var(--panel);border:1px solid var(--rule);opacity:0;transition:opacity .12s ease}
.sow .plan .c.h:hover .h-open,.sow .plan .c.h .h-open:focus-visible{opacity:1}
.sow .plan .c.h .h-open:hover{color:var(--ink);background:var(--panel-2)}
.sow .plan .mini{display:flex;align-items:center;gap:6px;width:100%;min-width:0;text-align:left;padding:6px 8px;border:1px solid var(--rule);border-radius:7px;background:var(--panel);font-size:12.5px}
.sow .plan .mini+.mini{margin-top:6px}
.sow .plan .mini:hover{border-color:var(--rule-2);background:var(--panel-2)} .sow .plan .mini.sel{border-color:var(--focus);box-shadow:0 0 0 2px var(--bai-accent-soft)}
.sow .plan .mini .st{width:7px;height:7px;border-radius:50%;background:var(--slate);flex:none}
.sow .plan .mini.DELIVERED .st{background:var(--meridian)} .sow .plan .mini.IN_PROGRESS .st{background:var(--signal)} .sow .plan .mini.BLOCKED .st{background:var(--ember)}
.sow .plan .mini .code{font-family:var(--mono);font-size:11px;color:var(--ink-3);flex:none} .sow .plan .mini .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sow .plan.zoomed .c:not(.zoom):not(.rh):not(.key){padding:6px 4px}
.sow .plan.zoomed .c.h:not(.focus):not(.agg) b,.sow .plan.zoomed .c.h:not(.focus) .dt{display:none}
.sow .plan.zoomed .hc{min-width:26px;height:22px;padding:0 6px;font-size:11.5px;gap:4px}
.sow .plan.zoomed .c.in-row,.sow .plan.zoomed .c.focus{background:color-mix(in srgb,var(--panel-2) 55%,var(--panel))}
.sow .plan.zoomed .c.h.focus{color:var(--ink);box-shadow:inset 0 -2px 0 var(--focus)}
.sow .plan.zoomed .c.rh.in-row{box-shadow:inset 2px 0 0 var(--focus)}
.sow .plan .c.zoom,.sow .plan.zoomed .c.zoom{display:block;padding:10px;background:var(--panel);box-shadow:inset 0 0 0 1px var(--focus)}
.sow .plan .zoom-hd{display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:12px;color:var(--ink-2)}
.sow .plan .zoom-hd .where{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap} .sow .plan .zoom-hd .where b{color:var(--ink);font-weight:600}
.sow .plan .zoom-x{width:22px;height:22px;flex:none;border-radius:6px;color:var(--ink-3);font-size:15px;line-height:1} .sow .plan .zoom-x:hover{color:var(--ink);background:var(--panel-2)}
.sow .plan .zoom-more{display:block;width:100%;text-align:left;margin-top:6px;padding:7px 8px;font-size:12px;color:var(--ink-2);border:1px dashed var(--rule-2);border-radius:7px} .sow .plan .zoom-more:hover{color:var(--ink);background:var(--panel-2)}
.sow .av{width:20px;height:20px;border-radius:50%;background:var(--slate-soft);color:var(--ink-2);font-size:10px;font-weight:600;display:inline-flex;align-items:center;justify-content:center;flex:none;border:1px solid var(--panel)}
.sow .av.none{border:1px dashed var(--rule-2);background:transparent}
.sow .avs{display:inline-flex} .sow .avs .av+.av{margin-left:-6px}
/* tables: shared column widths across rows, right-aligned numbers, one flexible title column */
.sow table.tbl{width:100%;border-collapse:collapse;table-layout:auto;background:var(--panel)}
.sow .tbl th,.sow .tbl td{padding:9px 12px;border-bottom:1px solid var(--rule);vertical-align:middle;text-align:left;white-space:nowrap}
.sow .tbl th{font-size:11.5px;color:var(--ink-3);text-transform:uppercase;letter-spacing:.06em;font-weight:500;background:var(--panel-2)}
.sow .tbl td.grow,.sow .tbl th.grow{width:100%;max-width:0;white-space:normal}
.sow .tbl td.grow .t{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sow .tbl td.grow .sub{font-size:12px;color:var(--ink-3);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sow .tbl .num,.sow .tbl th.num{text-align:right;font-family:var(--mono);font-size:12.5px;font-variant-numeric:tabular-nums}
.sow .tbl td.prog{min-width:150px}.sow .tbl td.code{max-width:120px;overflow:hidden;text-overflow:ellipsis}
.sow .tbl td.end{text-align:right}.sow .tbl td.end>*{vertical-align:middle}.sow .tbl td.end .rm{margin-left:6px}
.sow .tbl .owner{display:inline-flex;align-items:center;gap:8px}
.sow .tbl tbody tr{cursor:pointer}.sow .tbl tbody tr:hover td{background:var(--panel-2)}.sow .tbl tbody tr.sel td{background:var(--slate-soft)}
.sow .tbl tbody tr:focus-visible{outline:2px solid var(--focus);outline-offset:-2px}
.sow .tbl tfoot td{font-weight:600;background:var(--panel-2);border-bottom:0}
.sow .tbl tbody tr:hover .rm,.sow .tbl tbody tr:focus-within .rm{opacity:1}
/* collision guards: numbers never wrap, text truncates, nothing overlaps */
.sow .plan .c,.sow .node>*,.sow .kpi>*{min-width:0}
.sow .money,.sow .mono,.sow .lock,.sow .calc,.sow .kpi .v,.sow .node .cnt,.sow .tot{font-variant-numeric:tabular-nums}
.sow .money,.sow .lock,.sow .node .cnt{white-space:nowrap}
.sow .rows{overflow-x:auto}
.sow .node>span:nth-child(2){overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sow .kpi .v{overflow-wrap:anywhere;line-height:1.15}
.sow .calc div{flex-wrap:wrap}.sow .calc div>span:last-child{margin-left:auto;text-align:right;white-space:nowrap}
.sow .member .s{white-space:normal}
.sow .plan .rh .money{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* rows */
.sow .rows{border:1px solid var(--rule);border-radius:var(--r);overflow:hidden;background:var(--panel)}
.sow .add{display:flex;align-items:center;gap:8px;width:100%;padding:10px 14px;color:var(--ink-3);font-size:13px;border-top:1px dashed var(--rule);text-align:left} .sow .add:hover{color:var(--ink);background:var(--panel-2)}
.sow .vspine{position:relative;padding-left:26px} .sow .vspine::before{content:"";position:absolute;left:6px;top:8px;bottom:8px;width:2px;background:var(--rule-2)}
.sow .ms{position:relative;margin-bottom:22px} .sow .ms::before{content:"";position:absolute;left:-26px;top:6px;width:14px;height:14px;border-radius:50%;background:var(--panel);border:2px solid var(--rule-2)}
.sow .ms.done::before{background:var(--meridian);border-color:var(--meridian)} .sow .ms.live::before{border-color:var(--signal);box-shadow:0 0 0 4px var(--signal-soft)}
.sow .ms .hd{display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap} .sow .ms .hd .code{font-family:var(--mono);font-size:12px;color:var(--ink-3)}
.sow .empty{padding:32px 18px;text-align:center;color:var(--ink-3);font-size:13px} .sow .empty b{display:block;color:var(--ink-2);font-weight:600;margin-bottom:6px}
/* checklist */
.sow .check{display:grid;grid-template-columns:repeat(2,1fr);gap:8px 20px;margin-top:10px}
.sow .ck{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--ink-2)} .sow .ck i{width:16px;height:16px;border-radius:50%;border:1.5px solid var(--rule-2);display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-style:normal;flex:none}
.sow .ck.ok{color:var(--ink)} .sow .ck.ok i{background:var(--meridian);border-color:var(--meridian);color:var(--bai-accent-text)}
.sow .ck button{color:var(--focus);font-weight:500;margin-left:auto;font-size:12.5px}
/* inspector */
.sow .inspector{grid-area:inspector;border-left:1px solid var(--rule);background:var(--panel);overflow:auto;min-width:0}
.sow.no-inspector .inspector{display:none}
.sow .insp-hd{position:sticky;top:0;background:var(--panel);padding:14px 18px 10px;border-bottom:1px solid var(--rule);z-index:2}
.sow .insp-hd .eyebrow{display:flex;justify-content:space-between;align-items:center}
.sow .x{color:var(--ink-3);font-size:16px;line-height:1} .sow .x:hover{color:var(--ink)}
.sow .field{padding:0 18px;margin-top:14px} .sow .field label,.sow .lbl{display:block;font-size:11.5px;color:var(--ink-3);margin-bottom:5px;font-weight:500}
.sow .in{width:100%;height:34px;border:1px solid var(--rule-2);border-radius:8px;padding:0 10px;background:var(--panel);color:var(--ink)} .sow .in:focus{border-color:var(--focus);outline:0}
.sow .in.sm{height:30px;width:auto;display:inline-block}
.sow .in.invalid{border-color:var(--ember)}
.sow textarea.in{height:auto;min-height:64px;padding:8px 10px;resize:vertical}
.sow select.in{appearance:none;background-image:linear-gradient(45deg,transparent 50%,var(--ink-3) 50%),linear-gradient(135deg,var(--ink-3) 50%,transparent 50%);background-position:calc(100% - 14px) 14px,calc(100% - 9px) 14px;background-size:5px 5px;background-repeat:no-repeat;padding-right:28px}
.sow select.in.sm{background-position:calc(100% - 14px) 12px,calc(100% - 9px) 12px}
.sow .two{display:grid;grid-template-columns:1fr 1fr;gap:10px} .sow .three{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}
.sow .seg{display:inline-grid;grid-auto-flow:column;border:1px solid var(--rule-2);border-radius:8px;overflow:hidden;background:var(--panel-2)}
.sow .seg button{height:30px;padding:0 12px;font-size:12.5px;font-weight:500;color:var(--ink-2)} .sow .seg button.on{background:var(--panel);color:var(--ink);box-shadow:inset 0 0 0 1px var(--rule-2)}
.sow .seg.sm button{height:26px;padding:0 10px}
.sow .range{width:100%;accent-color:var(--meridian)}
.sow .calc{margin:8px 18px 0;padding:10px 12px;border:1px solid var(--rule);border-radius:8px;background:var(--panel-2);font-family:var(--mono);font-size:12.5px}
.sow .calc div{display:flex;justify-content:space-between;padding:2px 0;gap:12px} .sow .calc .tot{border-top:1px solid var(--rule-2);margin-top:4px;padding-top:6px;font-weight:600}
.sow .hint{padding:0 18px;font-size:12px;color:var(--ink-3);margin-top:6px} .sow .err{color:var(--ember)}
.sow .insp-sec{margin-top:22px;padding:0 18px;font-size:11.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);font-weight:600}
.sow .krs{margin:8px 18px 0;border:1px solid var(--rule);border-radius:8px;overflow:hidden}
.sow .kr{display:flex;gap:8px;align-items:center;padding:8px 10px;border-bottom:1px solid var(--rule);font-size:13px} .sow .kr:last-child{border-bottom:0}
.sow .kr a{color:var(--focus);text-decoration:none;font-size:12px;margin-left:auto} .sow .kr .x{font-size:14px}
.sow .kr input{border:0;background:transparent;flex:1;min-width:0} .sow .kr input:focus{outline:0}
.sow .danger{margin:26px 18px 30px;display:flex;justify-content:space-between;align-items:center;font-size:12.5px;color:var(--ink-3)} .sow .danger button{color:var(--ember);font-weight:500}
.sow .filters{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 12px;align-items:center} .sow .filters select,.sow .filters input{height:30px;border:1px solid var(--rule-2);border-radius:8px;padding:0 10px;background:var(--panel);font-size:12.5px;color:var(--ink)}
/* A native select sizes its control to its widest option, and an option can be a
   150-character title. Cap the control; the labels are clipped in the view so the
   open list stays well inside the window, with the full text in each option's tooltip. */
.sow .filters select{flex:0 1 auto;min-width:110px;max-width:210px;text-overflow:ellipsis}
.sow .filters input{flex:1 1 220px;min-width:160px;max-width:380px}
/* tags sit after a title and can stack (Unfunded + Unscheduled): keep the house
   tag style, just space them out */
.sow .tag+.tag{margin-left:4px}
.sow .tbl td.grow .t .tag{margin-left:2px;vertical-align:middle}
.sow .team{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-top:18px}
.sow .member{display:flex;gap:12px;align-items:center;padding:12px 14px;background:var(--panel);border:1px solid var(--rule);border-radius:var(--r);text-align:left;width:100%}
.sow .member .av{width:36px;height:36px;font-size:13px} .sow .member .n{font-weight:600} .sow .member .r{font-size:12px;color:var(--ink-3)} .sow .member .s{margin-left:auto;font-size:12px;color:var(--ink-2);text-align:right;white-space:nowrap}
.sow .member.dashed{justify-content:center;color:var(--ink-3);border-style:dashed;cursor:pointer} .sow .member.dashed:hover{color:var(--ink);background:var(--panel-2)}
.sow .legend{display:flex;gap:10px 18px;flex-wrap:wrap;align-items:center;font-size:12px;color:var(--ink-3);margin-top:10px;padding:0 2px}
.sow .legend b{color:var(--ink-2);font-weight:600}.sow .legend i{display:inline-block;width:8px;height:8px;border-radius:50%;margin:0 5px 0 8px;vertical-align:middle;background:var(--slate)}
.sow .legend i.DELIVERED{background:var(--meridian)}.sow .legend i.IN_PROGRESS{background:var(--signal)}.sow .legend i.BLOCKED{background:var(--ember)}
.sow .legend .sep{width:1px;height:14px;background:var(--rule-2)}
.sow .chip.is-fixed{background:var(--meridian-soft);color:var(--meridian)}.sow .chip.is-fixed::before{display:none}
.sow .chip.over{background:var(--ember-soft);color:var(--ember)}.sow .chip.over::before{display:none}
.sow .lock{display:inline-flex;align-items:center;gap:5px;white-space:nowrap;font-family:var(--mono);font-size:12.5px;padding:2px 6px;border-radius:6px;border:1px solid transparent;color:var(--ink);justify-self:end}
.sow .lock:hover{border-color:var(--rule-2);background:var(--panel)}.sow .lock.derived{color:var(--ink-3);font-style:italic}.sow .lock.neg{color:var(--ember)}
.sow .ledger[role=button]:focus-visible{outline:2px solid var(--focus);outline-offset:-2px}
.sow .budgetctl{display:inline-flex;align-items:center;gap:8px}
.sow .rm{width:22px;height:22px;border-radius:6px;color:var(--ink-3);font-size:15px;line-height:1;display:inline-flex;align-items:center;justify-content:center;opacity:0;transition:opacity .12s}
.sow .row:hover .rm,.sow .cellend{display:inline-flex;align-items:center;gap:6px;justify-self:end}
.sow .danger button:disabled{color:var(--ink-3);cursor:not-allowed;font-weight:400}
.sow .spend{display:grid;grid-template-columns:1fr 1fr minmax(0,2fr);gap:14px;align-items:end}
.sow .insp-body .col{min-width:0}
.sow-scrim{position:fixed;inset:0;z-index:40;background:color-mix(in srgb,#11111b 45%,transparent);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;align-items:flex-start;justify-content:center;padding:6vh 24px}
.sow-modal{width:min(1040px,100%);max-height:88vh;overflow:auto;background:var(--panel);border:1px solid var(--rule);border-radius:14px;box-shadow:0 30px 80px rgba(0,0,0,.25);color:var(--ink);font:14px/1.45 var(--ui)}
.sow-modal .insp-hd{border-radius:14px 14px 0 0}
.sow-modal .insp-body{display:grid;grid-template-columns:1fr 1fr;column-gap:12px;padding-bottom:6px}
.sow-modal .insp-body .col+.col{border-left:1px solid var(--rule)}
.sow-modal .insp-hd input[aria-label=Title]{font-size:16px}
.sow-modal textarea.in{min-height:250px;height:250px}
.sow-modal .danger{grid-column:1/-1}
/* The goal panel is one column; the inspector's 1040px would stretch its fields. */
.sow-modal.sow-modal-goal{width:min(640px,100%)}
.sow .toast{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:var(--ink);color:var(--canvas);padding:9px 14px;border-radius:8px;font-size:13px;z-index:50;display:flex;gap:12px;align-items:center;max-width:70vw}
.sow .toast.error{background:var(--ember);color:#fff} .sow .toast button{color:inherit;opacity:.8;font-weight:600}
.sow .sow-confirm{position:fixed;inset:0;z-index:60;background:color-mix(in srgb,#11111b 50%,transparent);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:24px}
.sow .sow-confirm-box{width:min(400px,100%);background:var(--panel);border:1px solid var(--rule);border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.22);padding:20px 20px 16px;color:var(--ink)}
.sow .sow-confirm-box h2{font-family:var(--display);font-size:18px;font-weight:650;letter-spacing:-.01em;margin:0 0 8px}
.sow .sow-confirm-box p{margin:0;color:var(--ink-2);font-size:14px;line-height:1.45}
.sow .sow-confirm-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}
.sow .sow-confirm-actions .btn.confirm-go{background:var(--ember);color:#fff;border-color:var(--ember)}
.sow .sow-confirm-actions .btn.confirm-go:hover{opacity:.92}
.sow kbd{font-family:var(--mono);font-size:11px;border:1px solid var(--rule-2);border-bottom-width:2px;border-radius:4px;padding:0 5px;color:var(--ink-2)}
@media (prefers-reduced-motion:reduce){.sow *{transition:none!important}}
@media (max-width:1180px){.sow{grid-template-columns:220px minmax(0,1fr) 320px}.sow.no-inspector{grid-template-columns:220px minmax(0,1fr) 0}.sow.no-rail{grid-template-columns:0 minmax(0,1fr) 320px}.sow.no-rail.no-inspector{grid-template-columns:0 minmax(0,1fr) 0}.sow .kpis{grid-template-columns:repeat(2,1fr)}}
`;
