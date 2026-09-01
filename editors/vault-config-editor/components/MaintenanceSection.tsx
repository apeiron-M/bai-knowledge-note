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

/** Reader-facing name and unit for each threshold. */
const LABELS: Record<string, { label: string; unit: string }> = {
  orphanThreshold: { label: "Notes with no links", unit: "notes" },
  danglingThreshold: { label: "Links pointing nowhere", unit: "links" },
  inboxPressure: { label: "Sources waiting to be read", unit: "sources" },
  observationAccumulation: { label: "Observations left unreviewed", unit: "observations" },
  tensionAccumulation: { label: "Contradictions left open", unit: "tensions" },
  mocOversize: { label: "Notes in one map", unit: "notes" },
  staleNoteDays: { label: "A draft goes stale after", unit: "days" },
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
          const meta = LABELS[key] ?? { label: humanizeKey(key), unit: "" };
          return (
            <Row key={key} label={meta.label} unit={meta.unit}>
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
