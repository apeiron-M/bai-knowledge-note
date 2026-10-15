import { VaultIcon, type VaultIconName } from "./vault-icons.js";

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
  /** `warn`: the count is a call to act (files waiting for review, open contradictions). */
  tone?: "warn";
  /** What the count means, when the number alone does not say. */
  countTitle?: string;
  /** Something is under way here (files converting): a small ring before the count. */
  busy?: boolean;
};

export type VaultPlacesProps = {
  places: VaultPlace[];
  /** The current place; none while a view that belongs to no place shows. */
  active?: VaultPlaceId;
  onSelect: (id: VaultPlaceId) => void;
  /**
   * `list`: the labelled places. `icons`: one compact row, kept above a
   * context's list so every place stays one click away while the list
   * takes the height (design: "The sidebar follows what you're in").
   */
  variant?: "list" | "icons";
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

export const PLACE_ICON: Record<VaultPlaceId, VaultIconName> = {
  ask: "ask",
  notes: "notes",
  topics: "topics",
  sources: "sources",
  work: "work",
  graph: "graph",
  contradictions: "contradictions",
};

export function VaultPlaces({
  places,
  active,
  onSelect,
  variant = "list",
}: VaultPlacesProps) {
  if (variant === "icons") {
    return (
      <nav className="vault-place-icons" aria-label="Places in this vault">
        {places.map((place) => (
          <button
            key={place.id}
            type="button"
            data-place-icon={place.id}
            data-tone={place.tone}
            title={place.label}
            aria-label={place.label}
            aria-current={place.id === active ? "page" : undefined}
            onClick={() => onSelect(place.id)}
          >
            <VaultIcon name={PLACE_ICON[place.id]} />
          </button>
        ))}
      </nav>
    );
  }
  return (
    <nav className="vault-places" aria-label="Places in this vault">
      {places.map((place) => {
        const current = place.id === active;
        const counted = place.count !== undefined && place.count > 0;
        return (
          <button
            key={place.id}
            type="button"
            data-place={place.id}
            title={place.label}
            aria-current={current ? "page" : undefined}
            onClick={() => onSelect(place.id)}
            className="vault-place"
          >
            <VaultIcon name={PLACE_ICON[place.id]} />
            <span className="vault-place-label">{place.label}</span>
            {place.busy && (
              <span className="vault-place-busy" title="Working on it">
                <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden="true">
                  <circle className="track" cx="8" cy="8" r="6" />
                  <circle className="arc" cx="8" cy="8" r="6" pathLength="100" strokeDasharray="44 100" />
                </svg>
              </span>
            )}
            {counted && (
              <span
                className="vault-place-count"
                data-tone={place.tone}
                title={place.countTitle}
              >
                {place.count}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
