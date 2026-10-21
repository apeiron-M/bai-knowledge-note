import { useEffect, useRef } from "react";
import { VaultIcon, type VaultIconName } from "./vault-icons.js";

export type VaultMenuItem = {
  key: string;
  label: string;
  /** Right-aligned, quieter: what the entry holds. */
  hint?: string;
  icon: VaultIconName;
  /** The `data-tour` anchor the Try on web tour finds this entry by. */
  tour?: string;
};

/**
 * A menu opened from the sidebar: the vault menu (under the vault's name and
 * behind Vault settings) and the ways to add something. Anchored to its
 * trigger's wrapper, which must be `position: relative` (`.vs-anchor`).
 * Escape or a click elsewhere closes it; the arrow keys move between entries.
 */
export function VaultMenu({
  label,
  heading,
  items,
  placement,
  onSelect,
  onClose,
}: {
  label: string;
  heading?: string;
  items: VaultMenuItem[];
  /** `below` from the top of the sidebar, `above` from its foot. */
  placement: "below" | "above";
  onSelect: (key: string) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close.current();
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const entries = [
        ...(panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
      ];
      if (entries.length === 0) return;
      const at = entries.findIndex((el) => el === document.activeElement);
      const step = e.key === "ArrowDown" ? 1 : -1;
      e.preventDefault();
      entries[(at + step + entries.length) % entries.length]?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <div className="vs-catch" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className="vs-pop shadow-xl"
        data-placement={placement}
        role="menu"
        aria-label={label}
      >
        {heading && <h3>{heading}</h3>}
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            data-menu-key={item.key}
            data-tour={item.tour}
            className="vs-mi"
            onClick={() => {
              onSelect(item.key);
              onClose();
            }}
          >
            <VaultIcon name={item.icon} />
            <span className="vs-mi-label">{item.label}</span>
            {item.hint && <span className="vs-mi-hint">{item.hint}</span>}
          </button>
        ))}
      </div>
    </>
  );
}
