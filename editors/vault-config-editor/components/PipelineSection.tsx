/**
 * Pipeline settings — UPDATE_PIPELINE_CONFIG.
 *
 * Previously read-only text. The input type takes all three fields as
 * optional, so each control dispatches only its own field and leaves the rest
 * untouched.
 */
import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import { actions } from "document-models/vault-config";
import type {
  PipelineConfig,
  PipelineDepth,
  VaultConfigAction,
} from "document-models/vault-config";
import { Card, Row, controlClass, controlStyle, ts } from "./ui.js";

type Dispatch = DocumentDispatch<VaultConfigAction>;

/**
 * Depth values come from the Ars Contexta spec, which documented them on the
 * field itself: """Processing depth: quick, standard, deep""". They are a
 * `PipelineDepth` enum in the model, so this list is exhaustive by type — the
 * compiler will flag it if a value is ever added.
 */
const DEPTHS: { value: PipelineDepth; label: string }[] = [
  { value: "QUICK", label: "Quick" },
  { value: "STANDARD", label: "Standard" },
  { value: "DEEP", label: "Deep" },
];

export function PipelineSection({
  pipeline,
  dispatch,
}: {
  pipeline: PipelineConfig;
  dispatch: Dispatch;
}) {
  return (
    <Card
      title="Processing"
      hint="How thoroughly the pipeline works through a source."
    >
      <div className="space-y-2">
        <Row label="Depth">
          <select
            value={pipeline.depth}
            onChange={(e) =>
              dispatch(
                actions.updatePipelineConfig({
                  depth: e.target.value as PipelineDepth,
                  updatedAt: ts(),
                }),
              )
            }
            className={`${controlClass} w-24`}
            style={controlStyle}
          >
            {DEPTHS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </Row>

        <Row label="Run the next phase automatically">
          <input
            type="checkbox"
            checked={pipeline.autoChain}
            onChange={(e) =>
              dispatch(
                actions.updatePipelineConfig({
                  autoChain: e.target.checked,
                  updatedAt: ts(),
                }),
              )
            }
          />
        </Row>

        <Row label="Claims worth skipping" unit="of 1.0">
          <input
            type="number"
            min="0"
            max="1"
            step="0.05"
            defaultValue={pipeline.extractionSelectivity}
            onBlur={(e) => {
              const value = Number.parseFloat(e.target.value);
              // Out of range would set an unreachable extraction target, so
              // refuse it and snap the field back to what is stored.
              if (!Number.isFinite(value) || value < 0 || value > 1) {
                e.currentTarget.value = String(pipeline.extractionSelectivity);
                return;
              }
              if (value !== pipeline.extractionSelectivity) {
                dispatch(
                  actions.updatePipelineConfig({
                    extractionSelectivity: value,
                    updatedAt: ts(),
                  }),
                );
              }
            }}
            className={`${controlClass} w-16 text-right`}
            style={controlStyle}
          />
        </Row>
      </div>
    </Card>
  );
}
