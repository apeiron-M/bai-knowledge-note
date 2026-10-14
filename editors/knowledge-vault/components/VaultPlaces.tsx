import { role } from "../lib/theme.js";

export type VaultPlaceId =
  | "ask"
  | "notes"
  | "topics"
  | "sources"
  | "work"
  | "graph"
  | "contradictions";

export type VaultPlace = {
  id: VaultPlaceId;
  label: string;
  /** Rendered right-aligned. Omit rather than passing 0. */
  count?: number;
  tone?: "warn";
};

export type VaultPlacesProps = {
  places: VaultPlace[];
  active: VaultPlaceId;
  onSelect: (id: VaultPlaceId) => void;
  onOpenSettings: () => void;
};

/** place id → the sidebar body that shows when no context overrides it. */
export const PLACE_SECTION: Record<
  VaultPlaceId,
  "none" | "notes" | "topics" | "sources" | "work" | "graph" | "contradictions"
> = {
  ask: "none",
  notes: "notes",
  topics: "topics",
  sources: "sources",
  work: "work",
  graph: "graph",
  contradictions: "contradictions",
};

const ROW_STYLE = {
  height: 34,
  borderRadius: 8,
} as const;

export function VaultPlaces({
  places,
  active,
  onSelect,
  onOpenSettings,
}: VaultPlacesProps) {
  return (
    <nav
      className="vault-places flex flex-col px-2 pb-1"
      aria-label="Places in this vault"
    >
      {places.map((place) => {
        const current = place.id === active;
        return (
          <button
            key={place.id}
            type="button"
            data-place={place.id}
            aria-current={current ? "page" : undefined}
            onClick={() => onSelect(place.id)}
            className="vault-place flex w-full items-center gap-2 px-2.5 text-left text-xs font-medium transition-colors"
            style={{
              ...ROW_STYLE,
              color: "var(--bai-text-secondary)",
            }}
          >
            <span className="min-w-0 flex-1 truncate">{place.label}</span>
            {place.count !== undefined && place.count > 0 && (
              <span
                className="shrink-0 text-[11px]"
                style={{
                  color:
                    place.tone === "warn"
                      ? "var(--bai-warn)"
                      : "var(--bai-text-muted)",
                }}
              >
                {place.count}
              </span>
            )}
          </button>
        );
      })}
      <button
        type="button"
        onClick={onOpenSettings}
        className="vault-place mt-1 flex w-full items-center gap-2 border-t px-2.5 pt-1 text-left text-xs font-medium transition-colors"
        style={{
          ...ROW_STYLE,
          borderColor: "var(--bai-border)",
          color: "var(--bai-text-secondary)",
        }}
      >
        <svg
          className="h-4 w-4 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        Vault settings
      </button>
      <style aria-hidden="true">{`
        .vault-place:hover {
          background-color: ${role("railHover")};
        }
        .vault-place[aria-current="page"] {
          background-color: ${role("railCurrent")};
          color: var(--bai-text);
          box-shadow: ${role("railCurrentShadow")};
        }
      `}</style>
    </nav>
  );
}
