/**
 * Controls that sit on the vault's page — the bars above a view, tabs,
 * filters, suggested topics — from the design's `.btn-quiet`, its light-theme
 * `.chip` and `.seg` (docs/design/vault-view/final.html). In light the page
 * is grey, so a control drawn in the page's own grey (or none) disappears:
 * these are white, edged and lifted off it. In dark they are a shade below the
 * page with a hairline, as the design's quiet buttons are. Every colour is a
 * theme token (style.css); the vault's frame renders this once.
 */
export const VAULT_CONTROLS_CSS = `
.vault-btn {
  display: inline-flex; align-items: center; gap: 6px; min-width: 0; height: 30px; padding: 0 10px;
  border-radius: 8px; border: 1px solid var(--bai-border); background: var(--bai-surface); box-shadow: var(--v-raise);
  color: var(--bai-text-secondary); font: inherit; font-size: 12.5px; font-weight: 500; line-height: 1; white-space: nowrap;
  cursor: pointer; transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.vault-btn:hover { background: var(--bai-hover); color: var(--bai-text); }
.vault-btn[aria-expanded="true"] { border-color: color-mix(in srgb, var(--bai-accent) 45%, var(--bai-border)); color: var(--bai-text); }
.vault-btn:focus-visible { outline: 2px solid var(--bai-accent); outline-offset: 2px; }
.vault-btn > svg { flex: none; color: var(--bai-text-tertiary); }
.vault-btn:hover > svg, .vault-btn[aria-expanded="true"] > svg { color: var(--bai-text-secondary); }
.vault-btn[data-tone="warn"] { color: var(--bai-warn); }

.vault-chip {
  display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 12px;
  border-radius: 999px; border: 1px solid var(--bai-border); background: var(--bai-surface); box-shadow: var(--v-raise);
  color: var(--bai-text-secondary); font: inherit; font-size: 12px; line-height: 1; white-space: nowrap;
  cursor: pointer; transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.vault-chip:hover { border-color: color-mix(in srgb, var(--bai-accent) 40%, var(--bai-border)); color: var(--bai-text); }
.vault-chip[data-tone="accent"] { color: var(--bai-accent); }
.vault-chip[aria-pressed="true"] { background: var(--bai-accent); border-color: var(--bai-accent); color: var(--bai-accent-text); box-shadow: none; }
.vault-chip:focus-visible { outline: 2px solid var(--bai-accent); outline-offset: 2px; }

.vault-seg {
  display: inline-flex; gap: 2px; max-width: 100%; padding: 3px; overflow-x: auto;
  border-radius: 9px; border: 1px solid var(--bai-border); background: var(--bai-surface); box-shadow: var(--v-raise);
}
.vault-seg > button {
  display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 11px; border-radius: 6px;
  color: var(--bai-text-tertiary); font: inherit; font-size: 12.5px; font-weight: 500; white-space: nowrap; cursor: pointer;
}
.vault-seg > button:hover { color: var(--bai-text-secondary); }
.vault-seg > button[aria-current="page"], .vault-seg > button[aria-pressed="true"] { background: var(--bai-hover); color: var(--bai-text); font-weight: 600; }
.vault-seg > button:focus-visible { outline: 2px solid var(--bai-accent); outline-offset: 1px; }
.vault-seg .c { color: var(--bai-text-tertiary); font-weight: 400; font-variant-numeric: tabular-nums; }
@media (prefers-reduced-motion: reduce) { .vault-btn, .vault-chip { transition: none; } }
`;
