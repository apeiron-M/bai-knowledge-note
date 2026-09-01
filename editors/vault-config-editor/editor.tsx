/**
 * Vault configuration — layout only.
 *
 * Each section owns one operation of the model and lives in `components/`;
 * this file decides what is shown and in what order. Order follows how much a
 * setting shapes the vault: what it is, how it speaks, how it processes, then
 * the numbers that police it.
 *
 * Sections render only when their state branch exists. The reducers create
 * each branch lazily on first write, so a config initialized but never tuned
 * has null dimensions/vocabulary/pipeline/maintenance — showing a card of
 * empty controls for a branch that does not exist yet would invite writes
 * against defaults nobody chose.
 */
import { DocumentToolbar } from "@powerhousedao/design-system/connect";
import { useSelectedVaultConfigDocument } from "document-models/vault-config";
import { TOOLBAR_CLASS } from "../shared/theme-context.js";
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

          {state.dimensions && (
            <DimensionsSection
              dimensions={state.dimensions}
              dispatch={dispatch}
            />
          )}

          <div className="grid gap-6 md:grid-cols-2">
            {state.vocabulary && (
              <VocabularySection
                vocabulary={state.vocabulary}
                dispatch={dispatch}
              />
            )}

            <div className="space-y-6">
              {state.pipeline && (
                <PipelineSection pipeline={state.pipeline} dispatch={dispatch} />
              )}
              {state.maintenance && (
                <MaintenanceSection
                  maintenance={state.maintenance}
                  dispatch={dispatch}
                />
              )}
              <FeaturesSection
                features={state.features}
                dispatch={dispatch}
              />
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
