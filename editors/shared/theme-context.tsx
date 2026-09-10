/**
 * Mirrors Connect's theme into the vault's `data-bai-theme` attribute.
 *
 * The vault used to own its own theme state (a `useState` + localStorage
 * pair, flipped by a sun/moon button in the drive-app nav bar). Connect
 * now ships its own theme switcher, so two independent switchers meant
 * the app could disagree with the shell around it. Theme selection is
 * therefore centralised in Connect: this provider is a read-only
 * projection of `useTheme()` from reactor-browser onto the attribute our
 * CSS already keys off, so every `var(--bai-*)` rule in style.css keeps
 * working unchanged.
 *
 * Connect resolves `system` to a concrete light/dark value before we see
 * it, so following the OS preference comes for free and needs no extra
 * handling here.
 */
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useTheme as useConnectTheme } from "@powerhousedao/reactor-browser";
import { acquireToastTheme } from "./toast-theme.js";

export type BaiTheme = "dark" | "light";

type ThemeContextValue = {
  theme: BaiTheme;
};

// null = "no provider above me". Document editors mount their own
// ThemeProvider so they work standalone; when rendered inside the vault
// drive app they detect the parent and skip emitting a second (redundant)
// wrapper div. Both derive from the same Connect state either way, so
// nesting can no longer produce a stale copy the way it used to.
const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const parent = useContext(ThemeContext);
  const { theme } = useConnectTheme();
  const outermost = parent === null;

  // Connect's toasts render outside this subtree; the outermost provider
  // mirrors the theme onto <html> so style.css can reach them (toast-theme.ts).
  useEffect(() => {
    if (!outermost) return;
    return acquireToastTheme(theme);
  }, [outermost, theme]);

  if (parent) return <>{children}</>;

  return (
    <ThemeContext.Provider value={{ theme }}>
      <div data-bai-theme={theme} className="bai-theme">
        {children}
      </div>
    </ThemeContext.Provider>
  );
}

/**
 * The active theme, as chosen in Connect. Kept as a named export with the
 * same shape so the editors importing it need no changes; there is no
 * `toggle` any more — switching happens in Connect's own control.
 */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext) ?? { theme: "dark" };
}

/** Toolbar classes for dark and light themes */
const TB_DARK = [
  "!bg-[var(--bai-surface)] !border-[var(--bai-border)]",
  "[&_button]:!bg-[var(--bai-bg)] [&_button]:!border-[var(--bai-border)]",
  "[&_button:hover]:!bg-[var(--bai-hover)]",
  "[&_button_svg]:!text-[var(--bai-text-tertiary)] [&_button:hover_svg]:!text-[var(--bai-text-secondary)]",
  "[&_span]:!text-[var(--bai-text-tertiary)] [&_button:hover_span]:!text-[var(--bai-text-secondary)]",
  "[&_h1]:!text-[var(--bai-text-tertiary)]",
].join(" ");

/** Same classes — CSS vars resolve differently under each theme */
export const TOOLBAR_CLASS = TB_DARK;
