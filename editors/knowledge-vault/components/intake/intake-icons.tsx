/**
 * The intake's few glyphs, drawn once. Stroke icons take `currentColor`, so a
 * button's colour is the icon's colour.
 */
const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export const XIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" {...stroke} strokeWidth={2}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const PlusIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" {...stroke} strokeWidth={2.4}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const MoreIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
    <circle cx="5" cy="12" r="1.7" />
    <circle cx="12" cy="12" r="1.7" />
    <circle cx="19" cy="12" r="1.7" />
  </svg>
);

export const WarnIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" {...stroke} strokeWidth={1.8}>
    <path d="M12 3.5l9.5 16.5h-19z" />
    <path d="M12 10v4.5M12 17.3v.2" strokeWidth={1.9} />
  </svg>
);

export const InfoIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" {...stroke} strokeWidth={1.8}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5M12 7.8v.2" strokeWidth={2} />
  </svg>
);

export const CheckIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" {...stroke} strokeWidth={2.6}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

export const ChevronIcon = ({ dir }: { dir: "left" | "right" }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" {...stroke} strokeWidth={2.2}>
    <path d={dir === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
  </svg>
);

/** A page with a folded corner and the format on it: what people recognise as "a file". */
export function FileIcon({
  label,
  size = "row",
}: {
  label: string;
  size?: "row" | "hero";
}) {
  return (
    <svg
      className={size === "hero" ? "ik-ficon ik-ficon-hero" : "ik-ficon"}
      viewBox="0 0 26 32"
      aria-hidden="true"
    >
      <path
        className="ik-ficon-page"
        d="M3 0h14l9 9v20a3 3 0 0 1-3 3H3a3 3 0 0 1-3-3V3a3 3 0 0 1 3-3z"
      />
      <path className="ik-ficon-fold" d="M17 0v6a3 3 0 0 0 3 3h6z" />
      <text x="13" y="25.5" textAnchor="middle">
        {label}
      </text>
    </svg>
  );
}

/** The vault's mark at rest size: a hub and three notes lighting in turn while the batch works. */
export function BatchMark({ working }: { working: boolean }) {
  return (
    <svg
      className={working ? "ik-mark ik-mark-working" : "ik-mark"}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <line x1="12" y1="12" x2="4" y2="6" />
      <line x1="12" y1="12" x2="20" y2="7" />
      <line x1="12" y1="12" x2="12" y2="21" />
      <circle className="ik-mark-n1" cx="4" cy="6" r="2.4" />
      <circle className="ik-mark-n2" cx="20" cy="7" r="2.4" />
      <circle className="ik-mark-n3" cx="12" cy="21" r="2.4" />
      <circle className="ik-mark-hub" cx="12" cy="12" r="3.4" />
    </svg>
  );
}
