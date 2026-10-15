import { role } from "../lib/theme.js";

/**
 * The sidebar's look, from the design (docs/design/vault-view/final.html:
 * `.side`, `.side-nav`, `.places`, `.side-foot`, the 78 px rail). Every colour
 * is a theme token (style.css); the sidebar renders this once.
 *
 * `[data-mode="rail"]` is the labelled icon rail: the user collapsed the
 * sidebar, or the frame is narrower than 900 px (VaultSidebar `sidebarMode`).
 */
export const SIDEBAR_CSS = `
.vault-sidebar {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  min-height: 0;
  padding: 12px 10px 10px;
  background: ${role("rail")};
  border-right: 1px solid var(--bai-border);
}
.vault-sidebar button { font: inherit; }
.vault-sidebar .vault-i { color: var(--bai-text-tertiary); }
.vault-sidebar .vs-anchor { position: relative; }

/* the vault: its glyph and name, which open the vault menu */
.vault-sidebar .vs-head { display: flex; align-items: center; gap: 2px; }
.vault-sidebar .vs-ident {
  flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px;
  height: 36px; padding: 0 8px; border-radius: 8px;
  color: var(--bai-text); font-size: 14px; font-weight: 600; text-align: left;
}
.vault-sidebar .vs-ident:hover, .vault-sidebar .vs-ident[aria-expanded="true"] { background: ${role("railHover")}; }
.vault-sidebar .vs-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vault-sidebar .vs-chev { display: inline-flex; }
.vault-sidebar .vs-iconbtn {
  width: 30px; height: 30px; flex: none; display: grid; place-items: center; border-radius: 7px;
}
.vault-sidebar .vs-iconbtn:hover { background: ${role("railHover")}; }
.vault-sidebar .vs-iconbtn:hover .vault-i { color: var(--bai-text); }
.vault-glyph { flex: none; }
.vault-glyph line { stroke: ${role("line")}; stroke-width: 4; }
.vault-glyph circle { fill: ${role("map")}; }
.vault-glyph circle.hub { fill: var(--bai-text); }

/* search, and adding to the vault */
.vault-sidebar .vs-search {
  display: flex; align-items: center; gap: 8px; width: 100%; height: 34px; padding: 0 7px 0 10px;
  border: 1px solid var(--bai-border); border-radius: 8px; background: ${role("input")};
  color: var(--bai-text-tertiary); font-size: 13px;
}
.vault-sidebar .vs-search:hover { border-color: color-mix(in srgb, var(--bai-accent) 35%, var(--bai-border)); color: var(--bai-text-secondary); }
.vault-sidebar .vs-search[aria-current="page"] { border-color: var(--bai-accent); color: var(--bai-text); }
.vault-sidebar .vs-search .lbl { flex: 1; text-align: left; }
.vault-sidebar kbd {
  font-size: 11px; line-height: 1; padding: 3px 5px 2px; border: 1px solid var(--bai-border); border-bottom-width: 2px;
  border-radius: 5px; color: var(--bai-text-tertiary); background: var(--bai-surface); white-space: nowrap;
}
.vault-sidebar .vs-add { display: flex; gap: 2px; height: 34px; margin-top: -6px; }
.vault-sidebar .vs-add-main, .vault-sidebar .vs-add-more {
  display: flex; align-items: center; background: var(--bai-accent-soft); color: var(--bai-accent);
}
.vault-sidebar .vs-add-main {
  flex: 1; gap: 8px; min-width: 0; padding: 0 10px; border-radius: 8px;
  font-size: 13px; font-weight: 550; white-space: nowrap;
}
.vault-sidebar .vs-add-main[data-split] { border-radius: 8px 0 0 8px; }
.vault-sidebar .vs-add-more { width: 30px; justify-content: center; border-radius: 0 8px 8px 0; }
.vault-sidebar .vs-add .vault-i { color: inherit; }
.vault-sidebar .vs-add-main:hover, .vault-sidebar .vs-add-more:hover, .vault-sidebar .vs-add-more[aria-expanded="true"] {
  background: color-mix(in srgb, var(--bai-accent) 18%, transparent);
}
[data-bai-theme="light"] .vault-sidebar .vs-add-main, [data-bai-theme="light"] .vault-sidebar .vs-add-more {
  background: var(--bai-surface); border: 1px solid var(--bai-border); box-shadow: ${role("raise")};
}
[data-bai-theme="light"] .vault-sidebar .vs-add-main:hover, [data-bai-theme="light"] .vault-sidebar .vs-add-more:hover {
  background: color-mix(in srgb, var(--bai-accent) 10%, var(--bai-surface));
}

/* the places */
.vault-sidebar .vs-body { flex: 1; min-height: 0; overflow-y: auto; margin: 0 -4px; padding: 0 4px; display: flex; flex-direction: column; gap: 10px; }
.vault-places { display: flex; flex-direction: column; gap: 2px; }
.vault-place {
  display: flex; align-items: center; gap: 10px; width: 100%; height: 34px; padding: 0 10px; border-radius: 8px;
  color: var(--bai-text-secondary); font-size: 13.5px; white-space: nowrap; text-align: left;
}
.vault-place:hover { background: ${role("railHover")}; }
.vault-place[aria-current="page"] {
  background: ${role("railCurrent")}; box-shadow: ${role("railCurrentShadow")}; color: var(--bai-text); font-weight: 550;
}
.vault-place[aria-current="page"] .vault-i { color: var(--bai-accent); }
.vault-place-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.vault-place-count { margin-left: auto; color: var(--bai-text-tertiary); font-size: 12.5px; font-weight: 400; font-variant-numeric: tabular-nums; }
.vault-place-count[data-tone="warn"] { color: var(--bai-warn); font-weight: 600; }
.vault-place-busy { display: inline-flex; margin-left: auto; transform: rotate(-90deg); }
.vault-place-busy + .vault-place-count { margin-left: 8px; }
.vault-place-busy circle { fill: none; stroke-width: 3.2; }
.vault-place-busy .track { stroke: var(--bai-hover); }
.vault-place-busy .arc { stroke: var(--bai-accent); stroke-linecap: round; transform-origin: 8px 8px; animation: vs-spin 1.1s linear infinite; }
@keyframes vs-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .vault-place-busy .arc { animation: none; } }

/* every place one click away while a list takes the height */
.vault-place-icons { display: flex; gap: 2px; padding: 3px; border-radius: 9px; background: var(--bai-bg); border: 1px solid var(--bai-border); }
[data-bai-theme="light"] .vault-place-icons { background: transparent; border-color: transparent; }
.vault-place-icons button { flex: 1; height: 30px; display: grid; place-items: center; border-radius: 7px; color: var(--bai-text-tertiary); }
.vault-place-icons button .vault-i { color: inherit; }
.vault-place-icons button:hover { background: ${role("railHover")}; color: var(--bai-text-secondary); }
.vault-place-icons button[aria-current="page"] { background: ${role("railCurrent")}; box-shadow: ${role("railCurrentShadow")}; color: var(--bai-accent); }
.vault-place-icons button[data-tone="warn"] { color: var(--bai-warn); }
/* Where you are reads as where you are: the current place is the accent, even the amber one. */
.vault-place-icons button[data-tone="warn"][aria-current="page"] { color: var(--bai-accent); }

/* the list of what you are in: a source folder, the topics, a graph node, the files */
.vault-sidebar .vs-list-head { display: flex; align-items: center; gap: 6px; padding: 0 2px; }
.vault-sidebar .vs-list-head b { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13.5px; font-weight: 600; color: var(--bai-text); }
.vault-sidebar .sidebar-search-input { border-color: ${role("field")}; background: ${role("input")}; }

.vault-sidebar .vs-ctx { display: flex; flex-direction: column; gap: 6px; min-height: 0; }
.vault-sidebar .vs-body[data-scroll="inner"] { overflow: hidden; }
.vault-sidebar .vs-body[data-scroll="inner"] > .vs-ctx { flex: 1; }
.vault-sidebar .vs-body[data-scroll="inner"] > .vs-tree { flex: 1; min-height: 0; overflow-y: auto; }
.vault-sidebar .vs-ctx-head { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: start; gap: 6px; padding: 2px 2px 4px; }
.vault-sidebar .vs-ctx-head .vs-iconbtn { width: 26px; height: 26px; }
.vault-sidebar .vs-ctx-title b {
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  font-size: 13.5px; font-weight: 600; line-height: 1.35; color: var(--bai-text);
}
.vault-sidebar .vs-ctx-title small { display: block; margin-top: 2px; font-size: 12px; color: var(--bai-text-tertiary); }
.vault-sidebar .vs-ctx-step { display: flex; gap: 2px; }
.vault-sidebar .vs-ctx-step button { width: 24px; height: 24px; display: grid; place-items: center; border-radius: 6px; }
.vault-sidebar .vs-ctx-step button:hover:not(:disabled) { background: var(--bai-hover); }
.vault-sidebar .vs-ctx-step button:hover:not(:disabled) .vault-i { color: var(--bai-text); }
.vault-sidebar .vs-ctx-list { display: flex; flex-direction: column; gap: 1px; flex: 1; min-height: 0; overflow-y: auto; margin: 0 -4px; padding: 0 4px 8px; }
.vault-sidebar .vs-ctx-filter {
  display: flex; align-items: center; gap: 7px; height: 30px; padding: 0 9px; border-radius: 7px;
  border: 1px solid ${role("field")}; background: ${role("input")}; color: var(--bai-text-tertiary);
}
.vault-sidebar .vs-ctx-filter:focus-within { border-color: var(--bai-accent); }
.vault-sidebar .vs-ctx-filter input { flex: 1; min-width: 0; border: 0; outline: 0; background: none; font: inherit; font-size: 12.5px; color: var(--bai-text); }
.vault-sidebar .vs-ctx-filter input::placeholder { color: var(--bai-text-tertiary); }
.vault-sidebar .vs-ctx-row {
  position: relative; display: flex; flex-direction: column; gap: 1px; width: 100%; padding: 7px 8px; border-radius: 7px; text-align: left;
}
.vault-sidebar .vs-ctx-row[data-marker] { display: grid; grid-template-columns: 14px minmax(0, 1fr); gap: 1px 8px; }
.vault-sidebar .vs-ctx-row[data-marker] > :not(.vs-ctx-mk) { grid-column: 2; }
.vault-sidebar .vs-ctx-mk { grid-row: 1 / 3; width: 7px; height: 7px; margin: 6px 0 0 3px; border-radius: 50%; background: ${role("map")}; }
.vault-sidebar .vs-ctx-row[data-marker="hub"] .vs-ctx-mk { background: var(--bai-text); }
.vault-sidebar .vs-ctx-row[data-marker="warn"] .vs-ctx-mk { background: var(--bai-warn); }
.vault-sidebar .vs-ctx-row:hover { background: ${role("railHover")}; }
.vault-sidebar .vs-ctx-row[aria-current="true"] { background: ${role("railCurrent")}; box-shadow: ${role("railCurrentShadow")}; }
.vault-sidebar .vs-ctx-row[aria-current="true"]::before {
  content: ""; position: absolute; left: -3px; top: 8px; bottom: 8px; width: 3px; border-radius: 3px; background: var(--bai-accent);
}
.vault-sidebar .vs-ctx-label {
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  font-size: 12.5px; line-height: 1.38; color: var(--bai-text-secondary);
}
.vault-sidebar .vs-ctx-row[aria-current="true"] .vs-ctx-label { color: var(--bai-text); }
.vault-sidebar .vs-ctx-detail { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11.5px; color: var(--bai-text-tertiary); }

/* recent chats, under the places */
.vault-sidebar .vs-chats { display: flex; flex-direction: column; margin-top: 2px; }
.vault-sidebar .vs-chats h2 { margin: 0 0 3px; padding: 0 10px; font-size: 12px; font-weight: 550; color: var(--bai-text-tertiary); }
.vault-sidebar .vs-chat {
  display: block; width: 100%; height: 30px; line-height: 30px; padding: 0 10px; border-radius: 7px; text-align: left;
  color: var(--bai-text-tertiary); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.vault-sidebar .vs-chat:hover { background: ${role("railHover")}; color: var(--bai-text-secondary); }
.vault-sidebar .vs-chat[aria-current="page"] { background: ${role("railCurrentSoft")}; box-shadow: ${role("railCurrentShadow")}; color: var(--bai-text); }
.vault-sidebar .vs-chat-all { font-size: 12.5px; }

/* the foot: this vault's settings and the guide */
.vault-sidebar .vs-foot { display: flex; flex-direction: column; gap: 2px; padding-top: 8px; border-top: 1px solid var(--bai-border); }
.vault-sidebar .vs-row {
  display: flex; align-items: center; gap: 10px; width: 100%; height: 34px; padding: 0 10px; border-radius: 8px;
  color: var(--bai-text-tertiary); font-size: 13px; white-space: nowrap; text-align: left;
}
.vault-sidebar .vs-row:hover { background: ${role("railHover")}; color: var(--bai-text-secondary); }
.vault-sidebar .vs-row[aria-expanded="true"], .vault-sidebar .vs-row[aria-current="page"] {
  background: ${role("railCurrent")}; box-shadow: ${role("railCurrentShadow")}; color: var(--bai-text);
}

/* menus */
.vault-sidebar .vs-catch { position: fixed; inset: 0; z-index: 49; }
.vault-sidebar .vs-pop {
  position: absolute; left: 0; z-index: 50; min-width: 248px; padding: 6px; border-radius: 10px;
  border: 1px solid var(--bai-border); background: var(--bai-surface);
}
.vault-sidebar .vs-pop[data-placement="below"] { top: calc(100% + 4px); }
.vault-sidebar .vs-pop[data-placement="above"] { bottom: calc(100% + 4px); }
.vault-sidebar .vs-pop h3 { margin: 4px 8px 6px; font-size: 11.5px; font-weight: 600; color: var(--bai-text-tertiary); }
.vault-sidebar .vs-mi {
  display: flex; align-items: center; gap: 10px; width: 100%; height: 34px; padding: 0 8px; border-radius: 7px;
  color: var(--bai-text-secondary); font-size: 13px; text-align: left; white-space: nowrap;
}
.vault-sidebar .vs-mi:hover, .vault-sidebar .vs-mi:focus-visible { background: var(--bai-hover); color: var(--bai-text); outline: none; }
.vault-sidebar .vs-mi-label { flex: 1; }
.vault-sidebar .vs-mi-hint { margin-left: 16px; font-size: 12px; color: var(--bai-text-tertiary); }

/* the resize handle */
.vault-sidebar .sidebar-resize-handle:hover { background-color: color-mix(in srgb, var(--bai-accent) 30%, transparent); }
.vault-sidebar .sidebar-resize-handle:active { background-color: color-mix(in srgb, var(--bai-accent) 50%, transparent); }

/* the labelled icon rail */
.vault-sidebar[data-mode="rail"] { gap: 10px; padding: 10px 8px; }
.vault-sidebar[data-mode="rail"] .vs-head { flex-direction: column; gap: 4px; }
.vault-sidebar[data-mode="rail"] .vs-ident { flex: none; width: 100%; justify-content: center; padding: 0; }
.vault-sidebar[data-mode="rail"] :is(.vs-name, .vs-chev, .vs-search .lbl, kbd, .vs-add-main .lbl, .vs-add-more, .vault-place-count, .vault-place-busy, .vs-row .lbl) { display: none; }
.vault-sidebar[data-mode="rail"] :is(.vs-search, .vs-add-main, .vs-row) { justify-content: center; padding: 0; }
.vault-sidebar[data-mode="rail"] .vs-add-main[data-split] { border-radius: 8px; }
.vault-sidebar[data-mode="rail"] .vault-place { flex-direction: column; justify-content: center; gap: 3px; height: 54px; padding: 0; font-size: 11px; font-weight: 500; }
.vault-sidebar[data-mode="rail"] .vault-place[aria-current="page"] { font-weight: 600; }
.vault-sidebar[data-mode="rail"] .vault-place-label { flex: none; max-width: 100%; text-align: center; }
.vault-sidebar[data-mode="rail"] .vault-place[data-place="contradictions"] { font-size: 9.5px; letter-spacing: -0.01em; }
.vault-sidebar[data-mode="rail"] .vault-place .vault-i { width: 18px; height: 18px; }
`;
