import { createAction, Property } from "@powerhousedao/pieces-framework";
import { parseNoteIds, reweave } from "../agent/reweave.js";
import { llmFor, stageRunner } from "../agent/runner.js";
import { knowledgeVaultAuth } from "../auth.js";
import { clientForContext } from "../common/context.js";
import { KnowledgeVaultApiError } from "../common/errors.js";
import { driveProp, modelProp } from "../common/props.js";
import { modeProp } from "./modes.js";

/** Where the Unwoven notes trigger's notes go: {{trigger.payload.note_ids}}. */
const noteIdsProp = Property.LongText({
  displayName: "Note ids",
  description: "Map {{trigger.payload.note_ids}} here from the Unwoven notes trigger, or list note ids separated by commas or spaces",
  required: true,
});

/** The pipeline's reflect and reweave phases again, for notes it left unwoven: links and a MoC, against the vault as it is now. */
export const reweaveNotesAction = createAction({
  auth: knowledgeVaultAuth,
  name: "reweave-notes",
  displayName: "Reweave notes",
  description:
    "A second pass for notes the pipeline left unwoven, against the vault as it is now: links for a note with fewer than 2 (from its semantic neighbours today), a Map of Content for a note no MoC holds (a new TOPIC MoC only when three or more share a theme no MoC covers). Write mode creates them and catches up any pipeline task the notes' source left open. Set the step's timeout to 300 s.",
  audience: "both",
  props: { drive: driveProp, note_ids: noteIdsProp, model: modelProp, mode: modeProp("Write: link and place the notes") },
  outputSchema: {
    fields: [
      { key: "summary", label: "What happened" },
      { key: "stages", label: "Stages" },
      { key: "links", label: "Links (from, to, type, reason, confidence)" },
      { key: "placements", label: "Note → MoC" },
      { key: "unplaced", label: "Notes still in no MoC" },
    ],
  },
  async run(context) {
    const p = context.propsValue;
    const noteIds = parseNoteIds(p.note_ids);
    if (noteIds.length === 0) throw new KnowledgeVaultApiError("No notes to reweave: map {{trigger.payload.note_ids}} into Note ids, or list note ids", { category: "validation" });
    const { llm, model } = llmFor(context, p.model);
    const { stage, finish } = stageRunner(context);
    const out = await reweave(clientForContext(context), llm, model, { drive: String(p.drive), noteIds, write: p.mode === "write" }, stage);
    const { stages, seconds } = await finish();
    return { ...out, summary: `${out.summary} ${seconds} s, $${out.cost_usd.toFixed(4)}.`, stages, seconds };
  },
});
