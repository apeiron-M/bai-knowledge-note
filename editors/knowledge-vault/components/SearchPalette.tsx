import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { role } from "../lib/theme.js";
import {
  paletteGroups,
  paletteRows,
  stepRow,
  type GotoKey,
  type PaletteData,
  type PaletteRow,
  type PaletteScope,
  type PaletteSemantic,
} from "../lib/palette-search.js";
import { VaultIcon, type VaultIconName } from "./vault-icons.js";

/**
 * Ctrl K (design: docs/design/vault-view, "Ctrl K"): one box that finds
 * notes, topics, sources and chats, asks the vault, and goes anywhere in it.
 * ↑ and ↓ move, Enter opens, Esc closes; the mouse moves the same selection.
 */
export function SearchPalette({
  vaultName,
  data,
  scope = "all",
  query,
  semantic = null,
  onQueryChange,
  onSelect,
  onClose,
}: {
  vaultName: string;
  data: PaletteData;
  /** Everything, or only the chats ("All chats"). */
  scope?: PaletteScope;
  /** Kept by the vault, so the box opens on the last search. */
  query: string;
  /** The server's closest notes and maps for `query`, once it answers (usePaletteSemantic). */
  semantic?: PaletteSemantic | null;
  onQueryChange: (query: string) => void;
  onSelect: (row: PaletteRow) => void;
  onClose: () => void;
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const groups = useMemo(() => paletteGroups(query, data, scope, semantic), [query, data, scope, semantic]);
  const placeholder = scope === "chats" ? "Search your chats" : "Search notes, topics, sources and chats";
  const rows = useMemo(() => paletteRows(groups), [groups]);
  const [selected, setSelected] = useState(0);
  // Typing starts over at the top: the Ask row, or the first of what is newest.
  useEffect(() => setSelected(0), [query]);
  // Undefined while the list is empty.
  const current = rows.at(Math.min(selected, rows.length - 1));
  const currentKey = current?.key;
  const rowId = (row: PaletteRow) => `${listId}-${row.key}`;

  // Open on the last search, selected, so typing replaces it — and when the
  // palette closes, focus goes back where it was before it opened.
  useLayoutEffect(() => {
    const before = document.activeElement;
    inputRef.current?.focus();
    inputRef.current?.select();
    return () => {
      if (before instanceof HTMLElement && before.isConnected) before.focus();
    };
  }, []);
  // Keep the selected row in view as the keys move it.
  useEffect(() => {
    if (!currentKey) return;
    document.getElementById(`${listId}-${currentKey}`)?.scrollIntoView({ block: "nearest" });
  }, [currentKey, listId]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Enter that commits an input method's candidate (Japanese, Chinese…) is not a choice.
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((at) => stepRow(rows.length, at, e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (current) onSelect(current);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "Tab") {
      // The box is the dialog's one stop; Tab must not wander behind the scrim.
      e.preventDefault();
    }
  };

  return (
    <div className="vault-pal" onKeyDown={onKeyDown}>
      <style aria-hidden="true">{PALETTE_CSS}</style>
      <div className="pal-scrim" onMouseDown={onClose} aria-hidden="true" />
      <div
        className="pal"
        role="dialog"
        aria-modal="true"
        aria-label={`Search ${vaultName}`}
        // A click anywhere in the palette leaves the typing in the box, where its keys work.
        onMouseDown={(e) => {
          if (e.target !== inputRef.current) e.preventDefault();
        }}
      >
        <label className="pal-in">
          <VaultIcon name="search" size={18} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={current ? rowId(current) : undefined}
            spellCheck={false}
          />
          <kbd>Esc</kbd>
        </label>
        <div className="pal-res" id={listId} role="listbox" aria-label="Results">
          {groups.map((group) => (
            <div key={group.key} role="group" aria-label={group.heading ?? "Ask"}>
              {group.heading && <h3 aria-hidden="true">{group.heading}</h3>}
              {group.rows.map((row) => {
                const index = rows.indexOf(row);
                const isSelected = row === current;
                return (
                  <div
                    key={row.key}
                    id={rowId(row)}
                    role="option"
                    aria-selected={isSelected}
                    className="mi"
                    onMouseMove={() => {
                      if (selected !== index) setSelected(index);
                    }}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onSelect(row)}
                  >
                    <PaletteRowBody row={row} vaultName={vaultName} />
                    {isSelected && <kbd className="enter">Enter</kbd>}
                  </div>
                );
              })}
            </div>
          ))}
          {rows.length === 0 && (
            <p className="pal-empty">
              {scope === "chats"
                ? query.trim()
                  ? `No chat asks about “${query.trim()}”.`
                  : "No chats yet. Ask the vault something to start one."
                : "Nothing in this vault yet. Add sources to fill it."}
            </p>
          )}
        </div>
        <div className="pal-foot">Use ↑ and ↓ to move, Enter to open, Esc to close.</div>
      </div>
    </div>
  );
}

const GOTO_ICON: Record<GotoKey, VaultIconName> = {
  "add-sources": "plus",
  "new-chat": "chatNew",
  "new-project": "layers",
  "new-scope": "work",
  "vault-settings": "gear",
  "processing-queue": "queue",
};

function PaletteRowBody({ row, vaultName }: { row: PaletteRow; vaultName: string }): ReactNode {
  switch (row.kind) {
    case "ask":
      return (
        <>
          <VaultIcon name="ask" />
          <span className="lbl">
            Ask {vaultName} about <b>“{row.query}”</b>
          </span>
        </>
      );
    case "note":
      return (
        <>
          <VaultIcon name="notes" />
          <span className="two">
            <span className="tt">{row.title}</span>
            {row.detail && <small>{row.detail}</small>}
          </span>
        </>
      );
    case "topic":
      return (
        <>
          <VaultIcon name="topics" />
          <span className="lbl">{row.title}</span>
          <span className="r">{row.detail}</span>
        </>
      );
    case "source":
      return (
        <>
          <VaultIcon name="doc" />
          <span className="lbl">{row.title}</span>
          <span className="r">{row.detail}</span>
        </>
      );
    case "chat":
      return (
        <>
          <VaultIcon name="ask" />
          <span className="lbl">{row.title}</span>
          {row.detail && <span className="r">{row.detail}</span>}
        </>
      );
    case "more":
      return (
        <>
          <VaultIcon name="search" />
          <span className="lbl">
            Search all notes for <b>“{row.query}”</b>
          </span>
        </>
      );
    case "goto":
      return (
        <>
          <VaultIcon name={GOTO_ICON[row.goto]} />
          <span className="lbl">{row.title}</span>
        </>
      );
  }
}

/** The palette's look, from the design (`#palette`, `.pal-in`, `.pal-res`, `.mi`, `.pal-foot`). */
const PALETTE_CSS = `
.vault-pal { position: absolute; inset: 0; z-index: 60; color: var(--bai-text); font-size: 13.5px; line-height: 1.5; }
.vault-pal .pal-scrim { position: absolute; inset: 0; background: ${role("scrim")}; }
.vault-pal .pal {
  position: absolute; left: 50%; top: 9%; width: min(620px, calc(100% - 24px)); transform: translateX(-50%);
  border-radius: 12px; border: 1px solid var(--bai-border); background: var(--bai-overlay); box-shadow: ${role("shadow")}; overflow: hidden;
}
.vault-pal .pal-in { display: flex; align-items: center; gap: 10px; height: 52px; padding: 0 14px; border-bottom: 1px solid var(--bai-border); color: var(--bai-text-tertiary); }
.vault-pal .pal-in input { flex: 1; min-width: 0; border: 0; outline: 0; background: none; font: inherit; font-size: 16px; color: var(--bai-text); }
.vault-pal .pal-in input::placeholder { color: var(--bai-text-tertiary); }
.vault-pal kbd {
  font-family: inherit; font-size: 11px; font-weight: 500; line-height: 1; padding: 3px 5px 2px; border: 1px solid var(--bai-border); border-bottom-width: 2px;
  border-radius: 5px; color: var(--bai-text-tertiary); background: var(--bai-surface); white-space: nowrap;
}
.vault-pal .pal-res { max-height: min(420px, 60vh); overflow: auto; padding: 6px; }
.vault-pal h3 { margin: 6px 10px 4px; font-size: 12px; font-weight: 550; color: var(--bai-text-tertiary); }
.vault-pal .mi {
  display: flex; align-items: center; gap: 10px; width: 100%; min-height: 40px; padding: 6px 10px; border-radius: 8px;
  color: var(--bai-text-secondary); font-size: 13.5px; text-align: left; cursor: pointer;
}
.vault-pal .mi[aria-selected="true"] { background: var(--bai-hover); color: var(--bai-text); }
.vault-pal .mi .vault-i { color: var(--bai-text-tertiary); }
.vault-pal .mi .lbl { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vault-pal .mi .two { display: grid; gap: 1px; flex: 1; min-width: 0; }
.vault-pal .mi .two .tt { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.vault-pal .mi .two small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--bai-text-tertiary); }
.vault-pal .mi .r { margin-left: auto; padding-left: 12px; font-size: 12px; color: var(--bai-text-tertiary); white-space: nowrap; }
.vault-pal .mi b { font-weight: 600; color: var(--bai-text); }
.vault-pal .mi kbd.enter { margin-left: 8px; background: transparent; }
.vault-pal .pal-empty { margin: 0; padding: 40px 16px; text-align: center; font-size: 14px; color: var(--bai-text-tertiary); }
.vault-pal .pal-foot { padding: 9px 14px; border-top: 1px solid var(--bai-border); font-size: 12px; color: var(--bai-text-tertiary); }
@media (prefers-reduced-motion: reduce) { .vault-pal * { transition: none !important; } }
`;
