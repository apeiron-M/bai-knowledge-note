import { role } from "../../lib/theme.js";
import { SERIF } from "../library-css.js";

/**
 * The Notes page (design: docs/design/notes-view/final.html). It sits inside
 * the library frame (LIBRARY_CSS: `.vault-libwrap` / `.vault-lib`), so widths
 * follow the content column (`vlib`), not the window. Colour is the Graph's:
 * a note is a blue dot sized by its links, a topic a lavender diamond.
 */
export const NOTES_CSS = `
.vault-notes .lib-sub { max-width: 74ch; }
.vault-notes .vn-tools { margin-left: auto; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.vault-notes .vn-search { display: flex; align-items: center; gap: 8px; width: 260px; height: 32px; padding: 0 8px 0 10px; border: 1px solid var(--bai-border); border-radius: 8px; background: ${role("input")}; color: var(--bai-text-tertiary); }
.vault-notes .vn-search:focus-within { border-color: color-mix(in srgb, var(--bai-accent) 60%, var(--bai-border)); }
.vault-notes .vn-search input { flex: 1; min-width: 0; height: 100%; border: 0; background: none; outline: none; color: var(--bai-text); font: inherit; font-size: 13px; }
.vault-notes .vn-search input::placeholder { color: var(--bai-text-tertiary); }
.vault-notes .vn-search input::-webkit-search-cancel-button { display: none; }
.vault-notes .vn-x { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 6px; color: var(--bai-text-tertiary); }
.vault-notes .vn-x:hover { background: var(--bai-hover); color: var(--bai-text); }
.vault-notes mark { background: color-mix(in srgb, var(--bai-accent) 26%, transparent); color: inherit; border-radius: 3px; padding: 0 1px; }

/* the Graph's marks */
.vault-notes .vn-dot { display: inline-block; flex: none; width: var(--d, 6px); height: var(--d, 6px); border-radius: 50%; background: ${role("note")}; }
.vault-notes .vn-dia { display: inline-block; flex: none; width: 7px; height: 7px; transform: rotate(45deg); border-radius: 1.5px; background: ${role("map")}; }

/* how notes work: a real sequence, so its steps are numbered */
.vault-notes .vn-how { position: relative; margin-top: 18px; padding: 16px 18px 14px; border-radius: 14px; border: 1px solid var(--bai-border); background: var(--bai-surface); box-shadow: ${role("raise")}; }
.vault-notes .vn-how h2 { margin: 0; font-size: 14.5px; font-weight: 650; color: var(--bai-text); }
.vault-notes .vn-how ol { list-style: none; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 18px; margin: 12px 0 0; padding: 0; counter-reset: vn-step; }
.vault-notes .vn-how li { counter-increment: vn-step; position: relative; padding-left: 30px; }
.vault-notes .vn-how li::before { content: counter(vn-step); position: absolute; left: 0; top: 0; width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; background: var(--bai-accent-soft); color: var(--bai-accent); font-size: 11.5px; font-weight: 700; }
.vault-notes .vn-how li > b { display: block; font-size: 13.5px; font-weight: 600; line-height: 1.35; color: var(--bai-text); }
.vault-notes .vn-ex { display: flex; align-items: flex-start; gap: 8px; margin-top: 7px; font-size: 13px; line-height: 1.45; color: var(--bai-text-tertiary); }
.vault-notes .vn-ex .vn-dot, .vault-notes .vn-ex .vn-dia { margin-top: 0.45em; }
.vault-notes .vn-ex q { font-family: ${SERIF}; font-size: 14px; color: var(--bai-text-secondary); }
.vault-notes .vn-ex > svg { margin-top: 1px; color: var(--bai-text-tertiary); }
.vault-notes .vn-how-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--bai-border); font-size: 13px; color: var(--bai-text-tertiary); }
.vault-notes .vn-how-foot span { flex: 1; min-width: 240px; }
.vault-notes .vn-how > .vn-x { position: absolute; right: 10px; top: 10px; width: 28px; height: 28px; }

.vault-notes .vn-scope { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; margin-top: 16px; padding: 10px 12px 10px 14px; border-radius: 10px; border: 1px solid var(--bai-border); background: var(--bai-surface); font-size: 13.5px; color: var(--bai-text-secondary); }
.vault-notes .vn-scope span { flex: 1; }
.vault-notes .vn-scope b { color: var(--bai-text); font-weight: 600; }

/* controls */
.vault-notes .vn-ctrl { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; margin-top: 18px; }
.vault-notes .vn-ctrl .vn-grow { flex: 1; }
.vault-notes .vn-res { font-size: 13px; color: var(--bai-text-tertiary); }
.vault-notes .vn-res b { color: var(--bai-text); font-weight: 600; }
.vault-notes .vn-menuwrap { position: relative; }
.vault-notes .vn-catch { position: fixed; inset: 0; z-index: 19; }
.vault-notes .vn-menu { position: absolute; right: 0; top: 36px; z-index: 20; width: 340px; max-height: 420px; overflow: auto; padding: 6px; border-radius: 12px; background: var(--bai-overlay); border: 1px solid var(--bai-border); box-shadow: ${role("shadow")}; }
.vault-notes .vn-menu[data-align="left"] { right: auto; left: 0; }
.vault-notes .vn-menu { max-width: calc(100vw - 16px); }
.vault-notes .vn-menu button { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 10px; width: 100%; padding: 7px 10px; border-radius: 8px; font-size: 13px; color: var(--bai-text-secondary); text-align: left; }
.vault-notes .vn-menu button:hover, .vault-notes .vn-menu button:focus-visible, .vault-notes .vn-menu button[aria-checked="true"] { background: var(--bai-hover); color: var(--bai-text); outline: none; }
.vault-notes .vn-menu button[data-indent] > span:first-child { padding-left: 14px; }
.vault-notes .vn-menu small { grid-column: 1; font-size: 12px; color: var(--bai-text-tertiary); }
.vault-notes .vn-menu .vn-n { grid-row: 1; grid-column: 2; color: var(--bai-text-tertiary); font-variant-numeric: tabular-nums; }

/* a section: what it is in the margin, its ideas beside it */
.vault-notes .vn-sec { display: grid; grid-template-columns: 272px minmax(0, 1fr); gap: 20px 44px; margin-top: 30px; padding-top: 26px; border-top: 1px solid var(--bai-border); }
.vault-notes .vn-sec:first-of-type { margin-top: 22px; }
.vault-notes .vn-margin { position: sticky; top: 18px; align-self: start; min-width: 0; }
.vault-notes .vn-kick { display: flex; align-items: center; gap: 7px; margin: 0; font-size: 12.5px; color: var(--bai-text-tertiary); }
.vault-notes .vn-margin h2 { margin: 6px 0 0; font-family: ${SERIF}; font-size: 23px; line-height: 1.22; font-weight: 560; letter-spacing: -0.005em; color: var(--bai-text); overflow-wrap: anywhere; }
.vault-notes .vn-facts { margin: 8px 0 0; font-size: 13px; line-height: 1.55; color: var(--bai-text-tertiary); }
.vault-notes .vn-facts b { color: var(--bai-text-secondary); font-weight: 600; }
.vault-notes .vn-md { margin: 8px 0 0; font-size: 13px; line-height: 1.5; color: var(--bai-text-tertiary); }
.vault-notes .vn-margin h3 { margin: 18px 0 6px; font-size: 12.5px; font-weight: 600; color: var(--bai-text-secondary); }
.vault-notes .vn-fed { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 7px; }
.vault-notes .vn-fed li { display: grid; grid-template-columns: 12px minmax(0, 1fr) auto; align-items: baseline; column-gap: 7px; font-size: 12.5px; line-height: 1.35; color: var(--bai-text-secondary); }
.vault-notes .vn-fed li > .vn-dia { transform: translateY(-1px) rotate(45deg); }
.vault-notes .vn-fed .vn-n { color: var(--bai-text-tertiary); font-variant-numeric: tabular-nums; }
.vault-notes .vn-bar { grid-column: 2 / 4; height: 4px; margin-top: 3px; border-radius: 2px; background: color-mix(in srgb, var(--bai-text) 7%, transparent); overflow: hidden; }
.vault-notes .vn-bar::after { content: ""; display: block; width: var(--w); height: 100%; border-radius: 2px; background: color-mix(in srgb, ${role("map")} 62%, transparent); }
.vault-notes .vn-fed[data-of="sources"] .vn-bar::after { background: color-mix(in srgb, var(--bai-text) 34%, transparent); }
.vault-notes .vn-fed li > svg { align-self: center; color: var(--bai-text-tertiary); }
.vault-notes .vn-fed .vn-more { grid-template-columns: 12px auto; color: var(--bai-text-tertiary); }
.vault-notes .vn-cx { list-style: none; margin: 0; padding: 0; font-size: 12.5px; line-height: 1.5; color: var(--bai-text-secondary); }
.vault-notes .vn-cx li + li { margin-top: 3px; }
.vault-notes .vn-cx small { font-size: 12.5px; color: var(--bai-text-tertiary); }
.vault-notes .vn-wait { margin-top: 14px; padding: 10px 12px; border-radius: 10px; background: var(--bai-warn-soft); font-size: 12.5px; line-height: 1.5; color: var(--bai-text-secondary); }
.vault-notes .vn-wait b { color: var(--bai-warn); font-weight: 600; }
.vault-notes .vn-wait button { display: block; margin-top: 6px; color: var(--bai-warn); font-weight: 600; }
.vault-notes .vn-wait button:hover { text-decoration: underline; text-underline-offset: 3px; }
.vault-notes .vn-acts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }

.vault-notes .vn-body { min-width: 0; }
.vault-notes .vn-lbl { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 10px; margin: 0 0 2px; font-size: 12.5px; font-weight: 600; color: var(--bai-text-secondary); }
.vault-notes .vn-lbl small { font-weight: 400; font-size: 12.5px; color: var(--bai-text-tertiary); }
.vault-notes .vn-outline { margin-top: 18px; }
.vault-notes .vn-olhead { display: flex; align-items: baseline; gap: 12px; padding-bottom: 6px; border-bottom: 1px solid var(--bai-border); }
.vault-notes .vn-olhead .vn-lbl { flex: 1; margin: 0; }
.vault-notes .vn-link { color: var(--bai-accent); font-size: 12.5px; font-weight: 550; }
.vault-notes .vn-link:hover { text-decoration: underline; text-underline-offset: 3px; }
.vault-notes .vn-ol { list-style: none; margin: 0; padding: 0; }
.vault-notes .vn-ch > button { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; align-items: center; column-gap: 8px; width: 100%; min-height: 38px; padding: 7px 4px 7px 0; border-bottom: 1px solid color-mix(in srgb, var(--bai-border) 70%, transparent); font-size: 13.5px; color: var(--bai-text-secondary); }
.vault-notes .vn-ch > button:hover { color: var(--bai-text); }
.vault-notes .vn-ch > button > svg { justify-self: center; color: var(--bai-text-tertiary); transition: transform 0.15s; }
.vault-notes .vn-ch > button[aria-expanded="true"] > svg { transform: rotate(90deg); }
.vault-notes .vn-ch .vn-t { display: flex; align-items: center; gap: 8px; min-width: 0; }
.vault-notes .vn-ch .vn-t span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vault-notes .vn-ch .vn-n { font-size: 12.5px; color: var(--bai-text-tertiary); font-variant-numeric: tabular-nums; }
.vault-notes .vn-ch > .vn-list { padding: 2px 0 8px 26px; border-bottom: 1px solid color-mix(in srgb, var(--bai-border) 70%, transparent); }
.vault-notes .vn-ch .vn-td { margin: 0 0 4px 26px; padding-top: 8px; font-size: 13px; color: var(--bai-text-tertiary); max-width: 70ch; }
.vault-notes .vn-skipped { margin: 10px 0 0; font-size: 12.5px; line-height: 1.5; color: var(--bai-text-tertiary); }
.vault-notes .vn-subhd { display: flex; align-items: center; gap: 8px; margin: 16px 0 0; padding-bottom: 4px; border-bottom: 1px solid var(--bai-border); font-size: 12.5px; font-weight: 600; color: var(--bai-text-secondary); }
.vault-notes .vn-subhd:first-child { margin-top: 0; }
.vault-notes .vn-subhd small { font-weight: 400; color: var(--bai-text-tertiary); }
.vault-notes .vn-flat { max-width: 900px; margin-top: 20px; }

/* a note: the claim, then one quiet line about it */
.vault-notes .vn-list { list-style: none; margin: 0; padding: 0; }
.vault-notes .vn-row { position: relative; display: grid; grid-template-columns: 18px minmax(0, 1fr) 30px; column-gap: 8px; padding: 9px 0 10px; border-top: 1px solid color-mix(in srgb, var(--bai-border) 70%, transparent); }
.vault-notes .vn-row:first-child { border-top: 0; }
.vault-notes .vn-row > .vn-nd { display: flex; justify-content: center; padding-top: 0.62em; }
.vault-notes .vn-claim { grid-column: 2; max-width: 70ch; font-family: ${SERIF}; font-size: 16px; line-height: 1.42; font-weight: 450; color: var(--bai-text); text-align: left; }
.vault-notes .vn-claim:hover { text-decoration: underline; text-decoration-color: color-mix(in srgb, var(--bai-accent) 70%, transparent); text-underline-offset: 3px; }
.vault-notes .vn-pk { grid-column: 3; grid-row: 1; align-self: start; display: grid; place-items: center; width: 28px; height: 28px; border-radius: 7px; color: var(--bai-text-tertiary); }
.vault-notes .vn-pk:hover { background: var(--bai-hover); color: var(--bai-text); }
.vault-notes .vn-pk > svg { transition: transform 0.15s; }
.vault-notes .vn-pk[aria-expanded="true"] > svg { transform: rotate(180deg); }
.vault-notes .vn-meta { grid-column: 2; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; margin-top: 4px; font-size: 12.5px; color: var(--bai-text-tertiary); }
.vault-notes .vn-meta .vn-kd { color: var(--bai-text-secondary); }
.vault-notes .vn-meta .vn-tp { display: inline-flex; align-items: center; gap: 7px; }
.vault-notes .vn-meta i { font-style: normal; color: var(--bai-text-secondary); }
.vault-notes .vn-meta .vn-wt { display: inline-flex; align-items: center; gap: 6px; color: var(--bai-warn); }
.vault-notes .vn-meta .vn-wt::before { content: ""; width: 6px; height: 6px; border-radius: 50%; border: 1.5px solid currentColor; }
.vault-notes .vn-key .vn-row { padding: 12px 0 13px; }
.vault-notes .vn-key .vn-claim { font-size: 18.5px; line-height: 1.38; font-weight: 500; }
.vault-notes .vn-key .vn-row > .vn-nd { padding-top: 0.72em; }

/* a note opened in place */
.vault-notes .vn-peek { grid-column: 2 / 4; margin: 10px 0 2px; padding: 14px 16px; border-radius: 12px; background: var(--bai-surface); border: 1px solid var(--bai-border); }
.vault-notes .vn-peek p { margin: 0; max-width: 72ch; }
.vault-notes .vn-pd { font-size: 14px; line-height: 1.55; color: var(--bai-text-secondary); }
.vault-notes .vn-prow { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 4px 14px; margin-top: 12px; font-size: 13px; line-height: 1.5; color: var(--bai-text-secondary); }
.vault-notes .vn-prow > span { color: var(--bai-text-tertiary); }
.vault-notes .vn-prow b { font-weight: 550; color: var(--bai-text); }
.vault-notes .vn-lk { display: block; }
.vault-notes .vn-lk + .vn-lk { margin-top: 8px; }
.vault-notes .vn-lk button { font-family: ${SERIF}; font-size: 14.5px; color: var(--bai-text); text-align: left; }
.vault-notes .vn-lk button:hover { text-decoration: underline; text-underline-offset: 3px; }
.vault-notes .vn-lk small { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin-top: 1px; font-size: 12.5px; color: var(--bai-text-tertiary); }

/* more as you scroll */
.vault-notes .vn-more-row { display: flex; align-items: center; justify-content: center; gap: 10px; margin-top: 22px; padding: 16px 0 4px; font-size: 13px; color: var(--bai-text-tertiary); }
.vault-notes .vn-more-row[data-end] { gap: 14px; border-top: 1px solid var(--bai-border); padding-top: 18px; }
.vault-notes .vn-spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid color-mix(in srgb, var(--bai-text) 18%, transparent); border-top-color: var(--bai-text-secondary); animation: vn-spin 0.8s linear infinite; }
@keyframes vn-spin { to { transform: rotate(360deg); } }
.vault-notes .vn-none { margin-top: 22px; padding: 36px 20px; text-align: center; border-radius: 12px; border: 1px dashed var(--bai-border); font-size: 14px; color: var(--bai-text-tertiary); }
.vault-notes .vn-none b { color: var(--bai-text-secondary); }

/* nothing yet */
.vault-notes .vn-empty { max-width: 760px; margin: 48px auto 0; text-align: center; }
.vault-notes .vn-empty > h2 { margin: 0; font-family: ${SERIF}; font-size: 26px; font-weight: 550; color: var(--bai-text); }
.vault-notes .vn-empty > p { margin: 10px auto 0; max-width: 58ch; font-size: 14.5px; line-height: 1.6; color: var(--bai-text-tertiary); }
.vault-notes .vn-empty .vn-acts { justify-content: center; margin-top: 18px; }
.vault-notes .vn-empty .vn-how { text-align: left; margin-top: 34px; }

@container vlib (max-width: 1020px) { .vault-notes .vn-how ol { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@container vlib (max-width: 860px) {
  .vault-notes .vn-sec { grid-template-columns: minmax(0, 1fr); gap: 14px; }
  .vault-notes .vn-margin { position: static; }
  .vault-notes .vn-fed { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px 22px; }
  .vault-notes .vn-search { width: 200px; }
}
@container vlib (max-width: 560px) {
  .vault-notes .vn-how ol, .vault-notes .vn-fed { grid-template-columns: minmax(0, 1fr); }
  .vault-notes .vn-tools { width: 100%; margin-left: 0; }
  .vault-notes .vn-search { flex: 1; width: auto; }
}
@media (prefers-reduced-motion: reduce) {
  .vault-notes .vn-spin { animation: none; }
  .vault-notes .vn-pk > svg, .vault-notes .vn-ch > button > svg { transition: none; }
}
`;
