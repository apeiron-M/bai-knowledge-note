import { useEffect, useRef, useState } from "react";
import { VaultIcon } from "../vault-icons.js";

/** The list's width (notes-css.ts `.vn-menu`). */
const MENU_WIDTH = 340;

export type NotesMenuItem = {
  key: string;
  label: string;
  count?: number;
  /** A quieter second line: what the entry is. */
  hint?: string;
  /** Drawn under the entry before it (a topic under its area). */
  indent?: boolean;
};

/**
 * A button that opens a list to pick from: the kind filter (one is checked)
 * and Jump to (nothing is). Escape or a click elsewhere closes it; the arrow
 * keys move between entries.
 */
export function NotesMenu({
  label,
  items,
  checked,
  pressed = false,
  onPick,
}: {
  /** The button's text, and the list's name. */
  label: string;
  items: readonly NotesMenuItem[];
  /** The entry shown as chosen; leave out for a list that only navigates. */
  checked?: string;
  /** The button reads as on (a filter is set). */
  pressed?: boolean;
  onPick: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  /** Which edge of the button the list hangs from: the right, unless that would run it past the page's left edge. */
  const [align, setAlign] = useState<"right" | "left">("right");
  const panel = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const radio = checked !== undefined;

  useEffect(() => {
    if (!open) return;
    const first = panel.current?.querySelector<HTMLElement>('[aria-checked="true"]') ?? panel.current?.querySelector<HTMLElement>("button");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const entries = [...(panel.current?.querySelectorAll<HTMLElement>("button") ?? [])];
      if (!entries.length) return;
      const at = entries.findIndex((el) => el === document.activeElement);
      e.preventDefault();
      entries[(at + (e.key === "ArrowDown" ? 1 : -1) + entries.length) % entries.length]?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <span className="vn-menuwrap">
      <button
        ref={button}
        type="button"
        className="vault-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-pressed={pressed}
        onClick={() => {
          // The page scrolls inside the vault's content column, which clips what hangs past its left edge.
          const at = button.current?.getBoundingClientRect();
          const column = button.current?.closest(".vault-lib")?.getBoundingClientRect();
          setAlign(at && at.right - (column?.left ?? 0) < MENU_WIDTH + 8 ? "left" : "right");
          setOpen((o) => !o);
        }}
      >
        {label}
        <VaultIcon name="down" size={15} />
      </button>
      {open && (
        <>
          <div className="vn-catch" onClick={() => setOpen(false)} aria-hidden="true" />
          <div ref={panel} className="vn-menu" data-align={align} role="menu" aria-label={label}>
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                role={radio ? "menuitemradio" : "menuitem"}
                aria-checked={radio ? item.key === checked : undefined}
                data-indent={item.indent ? "" : undefined}
                onClick={() => {
                  setOpen(false);
                  onPick(item.key);
                }}
              >
                <span>{item.label}</span>
                {item.count !== undefined && <span className="vn-n">{item.count}</span>}
                {item.hint && <small>{item.hint}</small>}
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  );
}
