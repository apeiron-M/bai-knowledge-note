import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";

export type BaiTheme = "dark" | "light";

type ThemeContextValue = {
  theme: BaiTheme;
  toggle: () => void;
};

const STORAGE_KEY = "bai-theme";

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  toggle: () => {},
});

function getStoredTheme(): BaiTheme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // localStorage unavailable
  }
  return "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<BaiTheme>(getStoredTheme);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // localStorage unavailable
    }
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      <div data-bai-theme={theme} className="bai-theme">
        {children}
      </div>
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
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

/** Small sun/moon toggle button */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      className="flex h-7 w-7 items-center justify-center rounded-md transition-colors"
      style={{
        background: "var(--bai-hover)",
        color: "var(--bai-text-tertiary)",
      }}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
    >
      {theme === "dark" ? (
        <svg
          className="h-3.5 w-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="5" />
          <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
        </svg>
      ) : (
        <svg
          className="h-3.5 w-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
        </svg>
      )}
    </button>
  );
}
