/**
 * The eight methodology dimensions — UPDATE_DIMENSION.
 *
 * Each dimension is a position between two opposing practices, plus how sure
 * the vault is of that position and why. The slider was already here; the
 * operation also carries `confidence` and `rationale`, which the UI only ever
 * passed through unchanged — so both were effectively read-only and are now
 * editable. Rationale matters most: a position with no stated reason is a
 * number nobody can argue with later.
 */
import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import { actions } from "document-models/vault-config";
import type {
  DimensionConfig,
  VaultConfigAction,
} from "document-models/vault-config";
import { UNSAVED_HINT } from "./defaults.js";
import { Card, controlClass, controlStyle, ts } from "./ui.js";

type Dispatch = DocumentDispatch<VaultConfigAction>;

const DIMENSIONS = [
  "granularity",
  "organization",
  "linking",
  "processing",
  "navigation",
  "maintenance",
  "schema",
  "automation",
] as const;

/**
 * The poles each dimension runs between, and what moving it is meant to
 * change. Both columns come from the Ars Contexta spec's own 8-dimension
 * table (§2.2 The Derivation Engine) — this is the vault's stated
 * methodology, not a gloss invented for the UI.
 */
const DIMENSION_META: Record<
  (typeof DIMENSIONS)[number],
  { poles: [string, string]; controls: string }
> = {
  granularity: {
    poles: ["Atomic", "Coarse"],
    controls: "Note size, extraction depth, reweaving scope.",
  },
  organization: {
    poles: ["Flat", "Hierarchical"],
    controls: "Folder structure, map tier count, navigation paths.",
  },
  linking: {
    poles: ["Implicit", "Explicit"],
    controls: "How connections get found — semantic search or by hand.",
  },
  processing: {
    poles: ["Minimal", "Intense"],
    controls:
      "Extraction selectivity, connection density, reweaving frequency.",
  },
  navigation: {
    poles: ["Linear", "3-Tier"],
    controls: "Map structure: one hub, then domains, then topics.",
  },
  maintenance: {
    poles: ["Manual", "Condition-based"],
    controls: "When health checks trigger and when reweaving happens.",
  },
  schema: {
    poles: ["Convention", "Dense"],
    controls: "Required fields, enum validation, template rigour.",
  },
  automation: {
    poles: ["Manual", "Full"],
    controls: "Which hooks are active and how much the pipeline does alone.",
  },
};

type Position = {
  value?: number;
  confidence?: number;
  rationale?: string | null;
};

export function DimensionsSection({
  dimensions,
  unsaved,
  dispatch,
}: {
  dimensions: DimensionConfig;
  /** True while this branch is still null in state. */
  unsaved?: boolean;
  dispatch: Dispatch;
}) {
  const byKey = dimensions as unknown as Record<string, Position | undefined>;

  return (
    <Card
      title="Methodology dimensions"
      hint={`Where this vault sits between eight pairs of opposing practices, how sure it is, and why.${unsaved ? " " + UNSAVED_HINT : ""}`}
    >
      <div className="space-y-4">
        {DIMENSIONS.map((dim) => {
          const d = byKey[dim];
          if (!d) return null;
          // Exhaustive over DIMENSIONS by type, so this is always defined.
          const meta = DIMENSION_META[dim];
          const [left, right] = meta.poles;
          const value = d.value ?? 3;
          const confidence = d.confidence ?? 0.5;

          /** Every write carries the whole position; only one field varies. */
          const update = (patch: Partial<Position>) =>
            dispatch(
              actions.updateDimension({
                dimension: dim,
                value: patch.value ?? value,
                confidence: patch.confidence ?? confidence,
                rationale:
                  patch.rationale !== undefined
                    ? patch.rationale || undefined
                    : (d.rationale ?? undefined),
                updatedAt: ts(),
              }),
            );

          return (
            <div key={dim} className="space-y-1">
              <div className="flex items-center justify-between">
                <span
                  className="text-xs font-medium capitalize"
                  style={{ color: "var(--bai-text-secondary)" }}
                  title={meta.controls}
                >
                  {dim}
                </span>
                <label
                  className="flex items-center gap-1 text-[10px]"
                  style={{ color: "var(--bai-text-faint)" }}
                >
                  sure
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.05"
                    defaultValue={confidence}
                    onBlur={(e) => {
                      const next = Number.parseFloat(e.target.value);
                      if (!Number.isFinite(next) || next < 0 || next > 1) {
                        e.currentTarget.value = String(confidence);
                        return;
                      }
                      if (next !== confidence) update({ confidence: next });
                    }}
                    className={`${controlClass} w-14 text-right`}
                    style={controlStyle}
                    aria-label={`How sure about ${dim}`}
                  />
                </label>
              </div>

              <div className="flex items-center gap-2">
                <span
                  className="w-20 text-right text-[10px]"
                  style={{ color: "var(--bai-text-faint)" }}
                >
                  {left}
                </span>
                <input
                  type="range"
                  min="1"
                  max="5"
                  value={value}
                  onChange={(e) =>
                    update({ value: Number.parseInt(e.target.value, 10) })
                  }
                  className="flex-1 accent-[#cba6f7]"
                  aria-label={`${dim}: ${left} to ${right}`}
                />
                <span
                  className="w-20 text-[10px]"
                  style={{ color: "var(--bai-text-faint)" }}
                >
                  {right}
                </span>
                <span
                  className="w-4 text-center text-xs font-bold"
                  style={{ color: "var(--bai-accent)" }}
                >
                  {value}
                </span>
              </div>

              <p
                className="text-[10px] leading-relaxed"
                style={{ color: "var(--bai-text-faint)" }}
              >
                {meta.controls}
              </p>

              <input
                type="text"
                defaultValue={d.rationale ?? ""}
                placeholder="Why this position?"
                aria-label={`Why ${dim} sits here`}
                onBlur={(e) => {
                  const next = e.target.value.trim();
                  if (next !== (d.rationale ?? "")) update({ rationale: next });
                }}
                className={`${controlClass} w-full italic`}
                style={controlStyle}
              />
            </div>
          );
        })}
      </div>
    </Card>
  );
}
