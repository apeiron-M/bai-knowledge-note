import { createAction, Property } from "@powerhousedao/pieces-framework";
import { LlmClient } from "../agent/llm.js";
import { asObject, candidatesStage, checkVaultStage, draftStage, readSourceStage, reportStage } from "../agent/staged.js";
import { knowledgeVaultAuth } from "../auth.js";
import { readAuth } from "../common/auth-value.js";
import { clientForContext } from "../common/context.js";
import { KnowledgeVaultApiError } from "../common/errors.js";
import { driveProp, modelProp, sourceProp } from "../common/props.js";

/**
 * The extract job split into five workflow steps, wired in order with
 * whole-object expressions: {{steps.read.output}}, {{steps.candidates.output}}…
 * Each step lights up in Studio as it finishes. Dry run: nothing is written.
 */

const fromStep = (displayName: string, example: string) =>
  Property.Json({ displayName, description: `The output of the ${example} step, e.g. {{steps.${example}.output}}`, required: true });

function llmFor(context: { auth?: unknown }, model: unknown): { llm: LlmClient; model: string } {
  const credentials = readAuth(context.auth);
  if (!credentials.llm) {
    throw new KnowledgeVaultApiError("This connection has no LLM API key. Add one to the Knowledge Vault connection to use the agent steps.", { category: "credential" });
  }
  const chosen = (typeof model === "string" && model.trim()) || credentials.llm.defaultModel;
  if (!chosen) throw new KnowledgeVaultApiError("Choose a model, or set a default model on the connection.", { category: "validation" });
  return { llm: new LlmClient(credentials.llm), model: chosen };
}

const summaryField = { key: "summary", label: "What happened" };

export const extractReadAction = createAction({
  auth: knowledgeVaultAuth,
  name: "extract-read-source",
  displayName: "Extract 1/5: read the source",
  description: "Loads a source's text, its figure count and the vault's topic vocabulary for the steps after it. No model call.",
  audience: "both",
  aiMetadata: { idempotent: true },
  props: { drive: driveProp, source: sourceProp },
  outputSchema: { fields: [summaryField, { key: "title", label: "Source title" }, { key: "chars", label: "Characters" }, { key: "figures", label: "Figures" }] },
  async run(context) {
    return readSourceStage(clientForContext(context), String(context.propsValue.drive), String(context.propsValue.source));
  },
});

export const extractCandidatesAction = createAction({
  auth: knowledgeVaultAuth,
  name: "extract-find-candidates",
  displayName: "Extract 2/5: find candidate claims",
  description: "One model call: lists the source's candidate claims and runs the six gates. Struck candidates come back with the gate and the reason.",
  audience: "both",
  props: { model: modelProp, source: fromStep("Source", "read") },
  outputSchema: { fields: [summaryField, { key: "kept_count", label: "Passed the gates" }, { key: "skipped_count", label: "Struck" }, { key: "kept", label: "Candidates" }, { key: "skipped", label: "Struck, with gate and reason" }, { key: "cost_usd", label: "Cost (USD)" }] },
  async run(context) {
    const { llm, model } = llmFor(context, context.propsValue.model);
    return { ...(await candidatesStage(llm, model, asObject(context.propsValue.source, "Source"))), model };
  },
});

export const extractCheckAction = createAction({
  auth: knowledgeVaultAuth,
  name: "extract-check-vault",
  displayName: "Extract 3/5: check the vault",
  description: "Searches the vault once per candidate and flags the ones a note already covers. No model call.",
  audience: "both",
  aiMetadata: { idempotent: true },
  props: {
    drive: driveProp,
    candidates: fromStep("Candidates", "candidates"),
    threshold: Property.Number({ displayName: "Duplicate threshold", description: "Similarity at or above which a candidate is likely already in the vault, 0–1 (default 0.9)", required: false, defaultValue: 0.9 }),
  },
  outputSchema: { fields: [summaryField, { key: "duplicate_count", label: "Likely already in the vault" }, { key: "candidates", label: "Candidates with their best vault matches" }] },
  async run(context) {
    const p = context.propsValue;
    const t = Number(p.threshold);
    return checkVaultStage(clientForContext(context), String(p.drive), asObject(p.candidates, "Candidates"), Number.isFinite(t) && t > 0 && t <= 1 ? t : 0.9);
  },
});

export const extractDraftAction = createAction({
  auth: knowledgeVaultAuth,
  name: "extract-draft-notes",
  displayName: "Extract 4/5: draft the notes",
  description: "One model call writes a note per candidate (or points at the vault note that already holds it). Drafts that break the vault's rules go back once with the exact issues.",
  audience: "both",
  props: { model: modelProp, source: fromStep("Source", "read"), checked: fromStep("Checked candidates", "check") },
  outputSchema: { fields: [summaryField, { key: "proposed_count", label: "Notes drafted" }, { key: "existing_count", label: "Already in the vault" }, { key: "rejected_count", label: "Still failing the rules" }, { key: "new_topics", label: "Topics new to the vault" }, { key: "proposed", label: "Drafted notes" }, { key: "cost_usd", label: "Cost (USD)" }] },
  async run(context) {
    const p = context.propsValue;
    const { llm, model } = llmFor(context, p.model);
    return { ...(await draftStage(llm, model, asObject(p.source, "Source"), asObject(p.checked, "Checked candidates"))), model };
  },
});

export const extractReportAction = createAction({
  auth: knowledgeVaultAuth,
  name: "extract-report",
  displayName: "Extract 5/5: report",
  description: "Puts the four steps together: a markdown report, the skip rate, the total cost and the notes that would be written. No model call.",
  audience: "both",
  aiMetadata: { idempotent: true },
  props: { source: fromStep("Source", "read"), candidates: fromStep("Candidates", "candidates"), checked: fromStep("Checked candidates", "check"), draft: fromStep("Drafts", "draft") },
  outputSchema: { fields: [summaryField, { key: "report", label: "Report (markdown)" }, { key: "proposed_count", label: "Notes proposed" }, { key: "skip_rate", label: "Skip rate (0–1)" }, { key: "cost_usd", label: "Total cost (USD)" }, { key: "new_topics", label: "Topics new to the vault" }] },
  async run(context) {
    const p = context.propsValue;
    const draft = asObject(p.draft, "Drafts");
    return reportStage(typeof draft.model === "string" ? draft.model : "", asObject(p.source, "Source"), asObject(p.candidates, "Candidates"), asObject(p.checked, "Checked candidates"), draft);
  },
});

export const extractStepActions = [extractReadAction, extractCandidatesAction, extractCheckAction, extractDraftAction, extractReportAction];
