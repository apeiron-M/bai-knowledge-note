import type { CSSProperties } from "react";

/**
 * The shell's icons, drawn from the design's symbol set
 * (docs/design/vault-view/final.html): 24px grid, 1.75 stroke, round caps.
 * One component so every row in the sidebar draws its icon the same way.
 */
const PATHS = {
  ask: <path d="M20.5 11.5a8 8 0 0 1-11.7 7.1L4 20l1.4-4.4a8 8 0 1 1 15.1-4.1z" />,
  notes: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </>
  ),
  topics: (
    <>
      <path d="m9 4-5 2v14l5-2 6 2 5-2V4l-5 2z" />
      <path d="M9 4v14M15 6v14" />
    </>
  ),
  sources: (
    <>
      <rect x="4" y="3" width="12" height="16" rx="2" />
      <path d="M8 7h4M8 11h4M20 7v12a2 2 0 0 1-2 2H8" />
    </>
  ),
  work: (
    <>
      <rect x="2.5" y="7" width="19" height="13.5" rx="2" />
      <path d="M8.5 7V5.5A2 2 0 0 1 10.5 3.5h3a2 2 0 0 1 2 2V7M2.5 12.5h19M11 12v2h2v-2" />
    </>
  ),
  graph: (
    <>
      <circle cx="6" cy="7" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="13" cy="18" r="2.5" />
      <path d="m7.4 9.2 4.4 6.6M8.5 6.8l7-.6M17.2 8.4l-3.2 7.3" />
    </>
  ),
  contradictions: (
    <>
      <path d="M10.3 4.2 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z" />
      <path d="M12 9.5v4M12 17h.01" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  down: <path d="m6 9 6 6 6-6" />,
  back: <path d="m15 18-6-6 6-6" />,
  up: <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />,
  arrowDown: <path d="M12 5v14M5.5 12.5 12 19l6.5-6.5" />,
  gear: (
    <>
      <path d="M12.2 2h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.2a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.2.1a2 2 0 0 1 1 1.7v.5a2 2 0 0 1-1 1.8l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.3a2 2 0 0 1 1 1.7v.2a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.3a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.8v-.5a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.2a2 2 0 0 1-1-1.7V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20a6 6 0 0 1 12 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a5 5 0 0 1 3 5.8" />
    </>
  ),
  queue: (
    <>
      <path d="M4 6h12M4 12h12M4 18h7" />
      <path d="m16 15 3 3-3 3" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  pulse: <path d="M3 12h4l3-7 4 14 3-7h4" />,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.2a2.5 2.5 0 0 1 4.8 1c0 1.7-2.4 2.2-2.4 3.6M12 17h.01" />
    </>
  ),
  pencil: (
    <>
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="m13.5 6.5 4 4" />
    </>
  ),
  newTopic: (
    <>
      <path d="m9 4-5 2v14l5-2 3 1" />
      <path d="M9 4v14M15 6l5-2v9M18 16v6M15 19h6" />
    </>
  ),
  collapse: <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" />,
  expand: <path d="M13 17l5-5-5-5M6 17l5-5-5-5" />,
} as const;

export type VaultIconName = keyof typeof PATHS;

export function VaultIcon({
  name,
  size = 16,
  style,
}: {
  name: VaultIconName;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      className="vault-i"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flex: "none", ...style }}
    >
      {PATHS[name]}
    </svg>
  );
}
