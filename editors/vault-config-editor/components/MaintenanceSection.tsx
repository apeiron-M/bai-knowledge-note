/**
 * Maintenance thresholds — UPDATE_MAINTENANCE_THRESHOLD.
 *
 * Previously read-only text. Each threshold is the point at which a health
 * check stops passing, so the labels name the thing being counted rather than
 * the state key: `mocOversize` is "Notes in one map", not "Moc oversize".
 *
 * Rendered from `Object.entries` so a threshold added to MaintenanceConfig
 * appears here without a code change (falling back to a prettified key until
 * someone gives it a real name), and the operation is keyed by condition name,
 * which matches that shape exactly.
 */
import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import { actions } from "document-models/vault-config";
import type {
  MaintenanceConfig,
  VaultConfigAction,
} from "document-models/vault-config";
import { UNSAVED_HINT } from "./defaults.js";
import {
  Card,
  Row,
  controlClass,
  controlStyle,
  humanizeKey,
  ts,
} from "./ui.js";

type Dispatch = DocumentDispatch<VaultConfigAction>;

/**
 * Reader-facing name, unit, and what crossing the number is meant to mean.
 * The `why` text is what a health check would report on, per the plugin's
 * health skill — see the note at the top of the panel about wiring.
 */
const LABELS: Record<string, { label: string; unit: string; why: string }> = {
  orphanThreshold: {
    label: "Notes with no links",
    unit: "notes",
    why: "A note nothing points at is hard to rediscover. Past this count, orphans get flagged for connecting.",
  },
  danglingThreshold: {
    label: "Links pointing nowhere",
    unit: "links",
    why: "A link to a deleted or never-created note. Past this count, the graph needs repair.",
  },
  inboxPressure: {
    label: "Sources waiting to be read",
    unit: "sources",
    why: "Sources sitting unextracted. Past this count, the vault is taking in more than it processes.",
  },
  observationAccumulation: {
    label: "Observations left unreviewed",
    unit: "observations",
    why: "Operational signals nobody has acted on. Past this count, lessons are piling up unlearned.",
  },
  tensionAccumulation: {
    label: "Contradictions left open",
    unit: "tensions",
    why: "Claims that disagree and have not been resolved or dissolved. Past this count, the vault contradicts itself faster than it settles.",
  },
  mocOversize: {
    label: "Notes in one map",
    unit: "notes",
    why: "A map holding this many notes has stopped being navigable and wants splitting into child maps.",
  },
  staleNoteDays: {
    label: "A draft goes stale after",
    unit: "days",
    why: "A draft older than this has probably been abandoned rather than forgotten — it needs finishing or archiving.",
  },
};

export function MaintenanceSection({
  maintenance,
  unsaved,
  dispatch,
}: {
  maintenance: MaintenanceConfig;
  /** True while this branch is still null in state. */
  unsaved?: boolean;
  dispatch: Dispatch;
}) {
  // Every MaintenanceConfig field is `Int!`, so these entries are already
  // [string, number] — no narrowing needed.
  const entries = Object.entries(maintenance);

  return (
    <Card
      title="Maintenance limits"
      hint={`Health checks warn once the vault goes past these numbers.${unsaved ? " " + UNSAVED_HINT : ""}`}
    >
      <div className="space-y-2">
        {entries.map(([key, value]) => {
          const meta = LABELS[key] ?? {
            label: humanizeKey(key),
            unit: "",
            why: "",
          };
          return (
            <Row key={key} label={meta.label} unit={meta.unit} why={meta.why}>
              <input
                type="number"
                min="0"
                step="1"
                defaultValue={value}
                onBlur={(e) => {
                  const next = Number.parseInt(e.target.value, 10);
                  // A threshold drives health checks; NaN or a negative would
                  // mis-report silently, so refuse it and restore the field.
                  if (!Number.isFinite(next) || next < 0) {
                    e.currentTarget.value = String(value);
                    return;
                  }
                  if (next !== value) {
                    dispatch(
                      actions.updateMaintenanceThreshold({
                        condition: key,
                        threshold: next,
                        updatedAt: ts(),
                      }),
                    );
                  }
                }}
                className={`${controlClass} w-16 text-right`}
                style={controlStyle}
              />
            </Row>
          );
        })}
      </div>
    </Card>
  );
}
