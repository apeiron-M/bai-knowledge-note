import type { ReactNode } from "react";

/**
 * The timeline's own glyphs, drawn like the vault's (vault-icons.tsx: 24px
 * grid, 1.75 stroke, round caps): a book, a feed, an agent, an import, play and pause.
 */
const PATHS = {
  book: (
    <>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
      <path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5M8 7h8" />
    </>
  ),
  feed: (
    <>
      <path d="M5 11a8 8 0 0 1 8 8M5 5a14 14 0 0 1 14 14" />
      <circle cx="6" cy="18" r="1.4" />
    </>
  ),
  agent: (
    <>
      <rect x="5" y="8" width="14" height="11" rx="3" />
      <path d="M12 4v4M9 13h.01M15 13h.01M2.5 13v2M21.5 13v2" />
    </>
  ),
  import: (
    <>
      <path d="M12 3v11M7.5 9.5 12 14l4.5-4.5" />
      <path d="M4 15v3.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V15" />
    </>
  ),
  play: <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />,
  pause: <path d="M8 5v14M16 5v14" />,
} satisfies Record<string, ReactNode>;

export type TimelineIconName = keyof typeof PATHS;

export function TimelineIcon({ name, size = 16 }: { name: TimelineIconName; size?: number }) {
  return (
    <svg className="vault-i" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
