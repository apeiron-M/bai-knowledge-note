/**
 * Vault configuration — layout only.
 *
 * Each section owns one operation of the model and lives in `components/`;
 * this file decides what is shown and in what order. Order follows how much a
 * setting shapes the vault: what it is, how it speaks, how it processes, then
 * the numbers that police it.
 *
 * Every section always renders. `dimensions`, `vocabulary`, `pipeline` and
 * `maintenance` are null until their first write (each reducer creates its own
 * branch), so those sections fall back to the defaults the reducer would
 * write and say so. Hiding them instead — as this file first did — left four
 * of the model's eight operations reachable only by an agent, which is the
 * problem this editor exists to fix.
 */
import { DocumentToolbar } from "@powerhousedao/design-system/connect";
import { useSelectedVaultConfigDocument } from "document-models/vault-config";
import { TOOLBAR_CLASS } from "../shared/theme-context.js";
import {
  DEFAULT_DIMENSIONS,
  DEFAULT_MAINTENANCE,
  DEFAULT_PIPELINE,
  DEFAULT_VOCABULARY,
} from "./components/defaults.js";
import { DimensionsSection } from "./components/DimensionsSection.js";
import { ExtractionCategoriesSection } from "./components/ExtractionCategoriesSection.js";
import { FeaturesSection } from "./components/FeaturesSection.js";
import { HeaderSection } from "./components/HeaderSection.js";
import { InitForm } from "./components/InitForm.js";
import { MaintenanceSection } from "./components/MaintenanceSection.js";
import { PipelineSection } from "./components/PipelineSection.js";
import { VocabularySection } from "./components/VocabularySection.js";

export default function Editor() {
  const [document, dispatch] = useSelectedVaultConfigDocument();
  const state = document.state.global;

  if (!state.name) return <InitForm dispatch={dispatch} />;

  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: "var(--bai-bg)", color: "var(--bai-text)" }}
    >
      <div className="mx-auto max-w-5xl">
        <DocumentToolbar toolbarClassName={TOOLBAR_CLASS} />
        <div className="space-y-6 p-6">
          <HeaderSection
            name={state.name}
            domain={state.domain ?? ""}
            updatedAt={state.updatedAt ?? null}
            dispatch={dispatch}
          />

          <DimensionsSection
            dimensions={state.dimensions ?? DEFAULT_DIMENSIONS}
            unsaved={!state.dimensions}
            dispatch={dispatch}
          />

          <div className="grid gap-6 md:grid-cols-2">
            <VocabularySection
              vocabulary={state.vocabulary ?? DEFAULT_VOCABULARY}
              unsaved={!state.vocabulary}
              dispatch={dispatch}
            />

            <div className="space-y-6">
              <PipelineSection
                pipeline={state.pipeline ?? DEFAULT_PIPELINE}
                unsaved={!state.pipeline}
                dispatch={dispatch}
              />
              <MaintenanceSection
                maintenance={state.maintenance ?? DEFAULT_MAINTENANCE}
                unsaved={!state.maintenance}
                dispatch={dispatch}
              />
              <FeaturesSection features={state.features} dispatch={dispatch} />
            </div>
          </div>

          <ExtractionCategoriesSection
            categories={state.extractionCategories}
            dispatch={dispatch}
          />
        </div>
      </div>
    </div>
  );
}
