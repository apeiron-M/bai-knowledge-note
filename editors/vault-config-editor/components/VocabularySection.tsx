/**
 * Vocabulary — UPDATE_VOCABULARY.
 *
 * Renames the pipeline's concepts for this vault's domain, so a vault about
 * cooking can call its notes "recipes". Rendered from `Object.entries` so a
 * term added to VocabularyMap appears without a code change; the operation is
 * keyed by term name, matching that shape.
 */
import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import { actions } from "document-models/vault-config";
import type {
  VaultConfigAction,
  VocabularyMap,
} from "document-models/vault-config";
import { UNSAVED_HINT } from "./defaults.js";
import { Card, controlClass, controlStyle, ts } from "./ui.js";

type Dispatch = DocumentDispatch<VaultConfigAction>;

export function VocabularySection({
  vocabulary,
  unsaved,
  dispatch,
}: {
  vocabulary: VocabularyMap;
  /** True while this branch is still null in state. */
  unsaved?: boolean;
  dispatch: Dispatch;
}) {
  // Every VocabularyMap term is `String!`, so these entries are already
  // [string, string] — no narrowing needed.
  const entries = Object.entries(vocabulary);

  return (
    <Card
      title="Vocabulary"
      hint={`What this vault calls each part of the pipeline.${unsaved ? " " + UNSAVED_HINT : ""}`}
    >
      <div className="space-y-2">
        {entries.map(([key, value]) => (
          <label key={key} className="block text-xs">
            <span
              className="capitalize"
              style={{ color: "var(--bai-text-faint)" }}
            >
              {key}
            </span>
            <input
              type="text"
              defaultValue={value}
              placeholder={key}
              onBlur={(e) => {
                const next = e.target.value.trim();
                // An empty term would leave the UI with nothing to print, so
                // restore rather than store a blank.
                if (!next) {
                  e.currentTarget.value = value;
                  return;
                }
                if (next !== value) {
                  dispatch(
                    actions.updateVocabulary({
                      key,
                      value: next,
                      updatedAt: ts(),
                    }),
                  );
                }
              }}
              className={`${controlClass} mt-0.5 w-full`}
              style={controlStyle}
            />
          </label>
        ))}
      </div>
    </Card>
  );
}
