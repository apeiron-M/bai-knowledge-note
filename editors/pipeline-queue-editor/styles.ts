/**
 * Scoped to .pq-editor. The app's --bai-* tokens carry both themes; the one
 * distinctive element is the phase strip, everything around it stays quiet.
 */
export const PIPELINE_QUEUE_STYLES = `
.pq-editor .pq-body { padding: 24px; display: grid; gap: 20px; }
.pq-editor .pq-head h1 { font-size: 1.375rem; font-weight: 650; letter-spacing: -0.01em; color: var(--bai-text); }
.pq-editor .pq-summary { margin-top: 4px; font-size: 0.9375rem; color: var(--bai-text-secondary); max-width: 72ch; }
.pq-editor .pq-muted { color: var(--bai-text-muted); }

.pq-editor .pq-flow { display: flex; align-items: stretch; gap: 0; list-style: none; margin: 0; padding: 0; }
.pq-editor .pq-flow-step { display: flex; align-items: center; flex: 1 1 0; min-width: 0; }
.pq-editor .pq-flow-button { flex: 1; display: grid; gap: 2px; text-align: left; padding: 14px 16px; border-radius: 10px;
  background: var(--bai-surface); border: 1px solid var(--bai-border); color: var(--bai-text); cursor: pointer;
  transition: border-color 120ms ease, background-color 120ms ease; }
.pq-editor .pq-flow-button:hover { background: var(--bai-hover); }
.pq-editor .pq-flow-button:focus-visible, .pq-editor .pq-tab:focus-visible, .pq-editor .pq-link:focus-visible,
.pq-editor .pq-expand:focus-visible, .pq-editor .pq-more:focus-visible, .pq-editor .pq-scroll:focus-visible,
.pq-editor .pq-search input:focus-visible { outline: 2px solid var(--bai-accent); outline-offset: 2px; }
.pq-editor .pq-flow-button.is-selected { border-color: var(--bai-accent); background: var(--bai-accent-soft); }
.pq-editor .pq-flow-count { font-size: 1.75rem; font-weight: 650; line-height: 1.1; font-variant-numeric: tabular-nums; }
.pq-editor .pq-flow-button.is-empty .pq-flow-count { color: var(--bai-text-faint); }
.pq-editor .pq-flow-button.is-human:not(.is-empty) .pq-flow-count { color: var(--bai-accent); }
.pq-editor .pq-flow-name { font-size: 0.875rem; font-weight: 600; color: var(--bai-text-secondary); }
.pq-editor .pq-flow-hint { font-size: 0.75rem; color: var(--bai-text-muted); }
.pq-editor .pq-flow-arrow { width: 22px; flex: 0 0 22px; height: 1px; background: var(--bai-border); position: relative; }
.pq-editor .pq-flow-arrow::after { content: ""; position: absolute; right: 0; top: -3px; border: 3.5px solid transparent; border-left-color: var(--bai-text-faint); border-right: 0; }

.pq-editor .pq-panel { background: var(--bai-surface); border: 1px solid var(--bai-border); border-radius: 12px; overflow: hidden; }
.pq-editor .pq-controls { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid var(--bai-border); }
.pq-editor .pq-tabs { display: flex; flex-wrap: wrap; gap: 4px; }
.pq-editor .pq-tab { font-size: 0.8125rem; padding: 6px 10px; border-radius: 7px; color: var(--bai-text-tertiary); background: transparent; cursor: pointer; }
.pq-editor .pq-tab:hover { background: var(--bai-hover); color: var(--bai-text); }
.pq-editor .pq-tab.is-selected { background: var(--bai-hover); color: var(--bai-text); font-weight: 600; }
.pq-editor .pq-tab-count { margin-left: 4px; font-variant-numeric: tabular-nums; color: var(--bai-text-muted); }
.pq-editor .pq-search input { width: 220px; font-size: 0.8125rem; padding: 6px 10px; border-radius: 7px; background: var(--bai-bg); border: 1px solid var(--bai-border); color: var(--bai-text); }
.pq-editor .pq-search input::placeholder { color: var(--bai-text-muted); }
.pq-editor .pq-filter-note { padding: 8px 14px; font-size: 0.8125rem; color: var(--bai-text-tertiary); border-bottom: 1px solid var(--bai-border); }

.pq-editor .pq-scroll { max-height: min(62vh, 720px); overflow: auto; }
.pq-editor .pq-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 0.8125rem; }
.pq-editor .pq-table thead th { position: sticky; top: 0; z-index: 1; background: var(--bai-surface); text-align: left; font-weight: 600;
  color: var(--bai-text-muted); padding: 9px 14px; border-bottom: 1px solid var(--bai-border); white-space: nowrap; }
.pq-editor .pq-table td { padding: 8px 14px; border-bottom: 1px solid var(--bai-border); vertical-align: middle; }
.pq-editor .pq-row:hover td { background: var(--bai-hover); }
.pq-editor .pq-row.is-expanded td { border-bottom-color: transparent; }
.pq-editor .pq-right { text-align: right; white-space: nowrap; }
.pq-editor .pq-truncate { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pq-editor .pq-source { display: flex; align-items: center; gap: 6px; min-width: 0; max-width: 460px; }
.pq-editor .pq-link { color: var(--bai-text); text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: none; cursor: pointer; border-radius: 3px; }
.pq-editor .pq-link:hover { text-decoration: underline; text-underline-offset: 3px; color: var(--bai-accent); }
.pq-editor .pq-plain { color: var(--bai-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pq-editor .pq-type { font-size: 0.6875rem; padding: 1px 6px; border-radius: 5px; background: var(--bai-hover); color: var(--bai-text-tertiary); }
.pq-editor .pq-expand { width: 20px; height: 20px; flex: 0 0 20px; display: grid; place-items: center; border-radius: 5px; background: none; cursor: pointer; color: var(--bai-text-muted); }
.pq-editor .pq-expand:hover { background: var(--bai-hover); color: var(--bai-text); }
.pq-editor .pq-chevron { width: 6px; height: 6px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: rotate(-45deg); transition: transform 120ms ease; }
.pq-editor .pq-expand[aria-expanded="true"] .pq-chevron { transform: rotate(45deg); }

.pq-editor .pq-track { display: inline-flex; gap: 3px; vertical-align: middle; }
.pq-editor .pq-seg { width: 18px; height: 6px; border-radius: 3px; background: var(--bai-hover); }
.pq-editor .pq-seg.is-done { background: var(--bai-text-tertiary); }
.pq-editor .pq-seg.is-current { background: var(--bai-accent); }
.pq-editor .pq-seg.is-stopped { background: var(--bai-danger); }

.pq-editor .pq-status { font-size: 0.75rem; font-weight: 600; white-space: nowrap; }
.pq-editor .pq-status.is-review { color: var(--bai-accent); }
.pq-editor .pq-status.is-blocked, .pq-editor .pq-status.is-failed { color: var(--bai-danger); }
.pq-editor .pq-status.is-working { color: var(--bai-status-review); }
.pq-editor .pq-status.is-queued { color: var(--bai-text-tertiary); }
.pq-editor .pq-status.is-done { color: var(--bai-ok); }

.pq-editor .pq-detail td { background: var(--bai-deep); padding: 4px 14px 14px 42px; }
.pq-editor .pq-handoffs { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.pq-editor .pq-handoffs li { display: grid; grid-template-columns: 72px 1fr; column-gap: 12px; row-gap: 2px; }
.pq-editor .pq-handoff-phase { font-weight: 600; color: var(--bai-text-secondary); grid-row: span 2; }
.pq-editor .pq-handoff-text { color: var(--bai-text-secondary); max-width: 90ch; }
.pq-editor .pq-handoff-meta { font-size: 0.75rem; color: var(--bai-text-muted); }
.pq-editor .pq-empty-note { font-size: 0.8125rem; color: var(--bai-text-muted); }

.pq-editor .pq-table-foot { display: flex; justify-content: space-between; align-items: center; padding: 9px 14px; font-size: 0.75rem; color: var(--bai-text-muted); }
.pq-editor .pq-more { font-size: 0.8125rem; padding: 5px 10px; border-radius: 7px; background: var(--bai-hover); color: var(--bai-text); cursor: pointer; }
.pq-editor .pq-empty { padding: 36px 14px; text-align: center; font-size: 0.875rem; color: var(--bai-text-muted); }

@media (max-width: 720px) {
  .pq-editor .pq-body { padding: 14px; }
  .pq-editor .pq-flow { flex-direction: column; gap: 6px; }
  .pq-editor .pq-flow-arrow { display: none; }
  .pq-editor .pq-search input { width: 100%; }
  .pq-editor .pq-search { flex: 1 1 100%; }
}
@media (prefers-reduced-motion: reduce) {
  .pq-editor * { transition: none !important; }
}
`;
