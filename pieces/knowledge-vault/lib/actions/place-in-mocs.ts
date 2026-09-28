import { createAction } from "@powerhousedao/pieces-framework";
import { sourceNotes } from "../agent/connect.js";
import { advancePipeline } from "../agent/pipeline.js";
import { llmFor, stageRunner } from "../agent/runner.js";
import { planStage, readMocs, writePlacementsStage } from "../agent/synthesize.js";
import { knowledgeVaultAuth } from "../auth.js";
import { clientForContext } from "../common/context.js";
import { driveProp, modelProp, sourceProp } from "../common/props.js";
import { modeProp } from "./modes.js";

/** The reweave phase: each of a source's notes becomes a core idea of a MoC. */
export const placeInMocsAction = createAction({
  auth: knowledgeVaultAuth,
  name: "place-in-mocs",
  displayName: "Place notes in MoCs",
  description:
    "Makes each note a source produced a core idea of a Map of Content, creating a TOPIC MoC under a domain only when three or more notes share a theme no MoC covers. Write mode links them and advances the pipeline task to verify, where it waits for your review. Set the step's timeout to 300 s.",
  audience: "both",
  props: { drive: driveProp, source: sourceProp, model: modelProp, mode: modeProp("Write: add the notes to MoCs") },
  outputSchema: {
    fields: [
      { key: "summary", label: "What happened" },
      { key: "stages", label: "Stages" },
      { key: "placements", label: "Note → MoC" },
      { key: "new_mocs", label: "New TOPIC MoCs" },
      { key: "unplaced", label: "Notes left without a MoC" },
    ],
  },
  async run(context) {
    const p = context.propsValue;
    const { llm, model } = llmFor(context, p.model);
    const client = clientForContext(context);
    const drive = String(p.drive);
    const sourceId = String(p.source);
    const write = p.mode === "write";
    const { stage, finish } = stageRunner(context);

    const read = await stage("read", async () => {
      const [notes, tree] = await Promise.all([sourceNotes(client, drive, sourceId), readMocs(client, drive)]);
      const hub = tree.mocs.filter((m) => m.tier === "HUB").length;
      return { ...notes, ...tree, summary: `${notes.notes.length} notes from "${notes.sourceTitle}"; the vault has ${tree.mocs.length} MoCs (${hub} HUB).` };
    });
    const plan = await stage("plan", () => planStage(llm, model, read.notes, read.mocs));
    const written = write ? await stage("write", () => writePlacementsStage(client, { drive, placements: plan.placements, newMocs: plan.new_mocs, coreIdeas: read.coreIdeas })) : null;
    const pipeline = written
      ? await stage("pipeline", () =>
          advancePipeline(client, {
            drive,
            sourceId,
            phase: "reweave",
            workDone: `Placed ${plan.placements.length} of ${read.notes.length} notes in MoCs${plan.new_mocs.length ? ` (${plan.new_mocs.length} new TOPIC MoC)` : ""}. Ready for review.`,
            filesModified: [...read.notes.map((n) => n.id), ...written.created_mocs],
            completedBy: `place-in-mocs · ${model}`,
          }),
        )
      : null;
    const { stages, seconds } = await finish();
    const mocTitle = new Map(read.mocs.map((m) => [m.id, m.title]));
    const noteTitle = new Map(read.notes.map((n) => [n.id, n.title]));
    return {
      summary: `${write ? "" : "Dry run: "}${(written ?? plan).summary}${pipeline ? ` ${pipeline.summary}` : ""} ${seconds} s, $${plan.cost_usd.toFixed(4)}.`,
      stages,
      dry_run: !write,
      model,
      placements: plan.placements.map((pl) => ({ note: noteTitle.get(pl.note) ?? pl.note, moc: pl.moc.startsWith("new:") ? `new: ${plan.new_mocs.find((m) => m.key === pl.moc)?.title}` : (mocTitle.get(pl.moc) ?? pl.moc), note_id: pl.note, moc_id: pl.moc })),
      new_mocs: plan.new_mocs.map((m) => ({ ...m, parent_title: mocTitle.get(m.parent) ?? m.parent })),
      unplaced: plan.unplaced.map((id) => noteTitle.get(id) ?? id),
      created_mocs: written?.created_mocs ?? [],
      problems: [...plan.problems, ...(written?.problems ?? [])],
      pipeline,
      cost_usd: plan.cost_usd,
      seconds,
    };
  },
});
