/**
 * Find a note by its title — or its id, pasted — instead of typing an id from
 * memory. A picker only: the editor that uses it decides what picking means
 * and asks for confirmation when the write cannot be undone.
 */
import { useId, useMemo, useState } from "react";
import type { VaultDocSummary } from "./vault-doc-index-store.js";

const LIMIT = 6;

/** The notes a query finds: an exact id first, else titles holding every word, best first. */
export function matchNotes(
  query: string,
  docs: readonly VaultDocSummary[],
  exclude: ReadonlySet<string> = new Set(),
  limit = LIMIT,
): VaultDocSummary[] {
  const q = query.trim();
  if (!q) return [];
  const byId = docs.find((d) => d.id === q);
  if (byId) return exclude.has(byId.id) ? [] : [byId];
  const lower = q.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean);
  return docs
    .filter((d) => !exclude.has(d.id))
    .filter((d) => {
      const title = d.title.toLowerCase();
      return words.every((w) => title.includes(w));
    })
    .sort((a, b) => {
      const as = a.title.toLowerCase().startsWith(lower) ? 0 : 1;
      const bs = b.title.toLowerCase().startsWith(lower) ? 0 : 1;
      return as - bs || a.title.length - b.title.length || a.title.localeCompare(b.title);
    })
    .slice(0, limit);
}

const CSS = `
.nf { position: relative; flex: 1; min-width: 0; }
.nf input { width: 100%; box-sizing: border-box; padding: 7px 10px; border-radius: 8px; background: var(--bai-surface); border: 1px solid var(--v-field, var(--bai-border)); color: var(--bai-text); font: inherit; font-size: 13px; }
.nf input:focus { outline: none; border-color: var(--bai-accent); }
.nf ul { list-style: none; margin: 6px 0 0; padding: 4px; border-radius: 10px; background: var(--bai-overlay, var(--bai-surface)); border: 1px solid var(--bai-border); }
.nf li button { display: block; width: 100%; text-align: left; padding: 7px 9px; border: 0; border-radius: 7px; background: none; color: var(--bai-text); font: inherit; font-size: 13px; cursor: pointer; }
.nf li[aria-selected="true"] button, .nf li button:hover { background: var(--bai-hover); }
.nf .nf-none { margin: 6px 2px 0; font-size: 12.5px; color: var(--bai-text-tertiary); }
`;

export function NoteFinder({
  docs,
  exclude,
  label,
  placeholder = "Find a note by its title",
  autoFocus = false,
  disabled = false,
  onPick,
  onEscape,
}: {
  docs: readonly VaultDocSummary[];
  exclude?: ReadonlySet<string>;
  /** The field's accessible name. */
  label: string;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  onPick: (doc: VaultDocSummary) => void;
  /** Escape on an empty field: the editor may close what holds the finder. */
  onEscape?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const results = useMemo(() => matchNotes(query, docs, exclude), [query, docs, exclude]);
  const listId = useId();
  const pick = (doc: VaultDocSummary | undefined) => {
    if (!doc) return;
    onPick(doc);
    setQuery("");
    setActive(0);
  };
  const open = query.trim().length > 0;
  return (
    <div className="nf">
      <style aria-hidden="true">{CSS}</style>
      <input
        role="combobox"
        aria-label={label}
        aria-expanded={open && results.length > 0}
        aria-controls={listId}
        aria-activedescendant={open && results[active] ? `${listId}-${active}` : undefined}
        aria-autocomplete="list"
        value={query}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(results[active]);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            if (query) setQuery("");
            else onEscape?.();
          }
        }}
      />
      {open &&
        (results.length > 0 ? (
          <ul role="listbox" id={listId} aria-label="Matching notes">
            {results.map((doc, i) => (
              <li key={doc.id} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
                <button type="button" tabIndex={-1} onMouseEnter={() => setActive(i)} onClick={() => pick(doc)}>
                  {doc.title}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="nf-none">No note in this vault matches “{query.trim()}”.</p>
        ))}
    </div>
  );
}
