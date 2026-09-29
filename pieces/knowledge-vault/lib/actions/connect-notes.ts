import { createAction } from "@powerhousedao/pieces-framework";
import { gatherCandidates, proposeLinksStage, sourceNotes, writeLinksStage } from "../agent/connect.js";
import { advancePipeline, claimPhase } from "../agent/pipeline.js";
import { llmFor, stageRunner } from "../agent/runner.js";
import { knowledgeVaultAuth } from "../auth.js";
import { clientForContext } from "../common/context.js";
import { driveProp, modelProp, resolveSource, sourceIdProp, sourceProp } from "../common/props.js";
import { modeProp } from "./modes.js";

/** The reflect phase: typed links, each with its reason, for a source's notes. */
export const connectNotesAction = createAction({
  auth: knowledgeVaultAuth,
  name: "connect-notes",
  displayName: "Connect notes",
  description:
    "Links the notes a source produced to each other and to the vault: candidates from semantic neighbours, one model call to judge them, a specific reason on every link. Write mode creates the links and advances the source's pipeline task past reflect. Set the step's timeout to 300 s.",
  audience: "both",
  props: { drive: driveProp, source: sourceProp, source_id: sourceIdProp, model: modelProp, mode: modeProp("Write: create the links") },
  outputSchema: {
    fields: [
      { key: "summary", label: "What happened" },
      { key: "stages", label: "Stages" },
      { key: "links", label: "Links (from, to, type, reason, confidence)" },
      { key: "dropped", label: "Links the articulation check dropped" },
      { key: "thin", label: "Notes with fewer than 2 links" },
    ],
  },
  async run(context) {
    const p = context.propsValue;
    const { llm, model } = llmFor(context, p.model);
    const client = clientForContext(context);
    const drive = String(p.drive);
    const sourceId = resolveSource(p);
    const write = p.mode === "write";
    const { stage, finish } = stageRunner(context);

    const read = await stage("read", async () => {
      const r = await sourceNotes(client, drive, sourceId);
      return { ...r, summary: `"${r.sourceTitle}" has ${r.notes.length} note${r.notes.length === 1 ? "" : "s"} to connect.` };
    });
    if (write) await stage("claim", () => claimPhase(client, { drive, sourceId, phase: "reflect" }));
    if (read.notes.length === 0) {
      // Nothing extracted, nothing to connect: close the phase so the task still reaches verify.
      const pipeline = write
        ? await stage("pipeline", () => advancePipeline(client, { drive, sourceId, phase: "reflect", workDone: "The source yielded no notes, so there was nothing to connect.", filesModified: [], completedBy: `connect-notes · ${model}` }))
        : null;
      const { stages, seconds } = await finish();
      return { summary: `${write ? "" : "Dry run: "}"${read.sourceTitle}" yielded no notes; nothing to connect.${pipeline ? ` ${pipeline.summary}` : ""} ${seconds} s.`, stages, dry_run: !write, model, links: [], dropped: [], thin: [], failed: [], pipeline, cost_usd: 0, seconds };
    }
    const candidates = await stage("candidates", async () => {
      const c = await gatherCandidates(client, drive, read.notes);
      const total = Object.values(c).reduce((n, list) => n + list.length, 0);
      return { candidates: c, summary: `${total} candidate pairs from the vault's semantic neighbours and the source's own notes.` };
    });
    const proposed = await stage("propose", () => proposeLinksStage(llm, model, read.notes, candidates.candidates));
    const written = write ? await stage("write", () => writeLinksStage(client, proposed.links)) : null;
    const pipeline = written
      ? await stage("pipeline", () =>
          advancePipeline(client, {
            drive,
            sourceId,
            phase: "reflect",
            workDone: `Connected ${read.notes.length} notes with ${written.written.length} typed links, each with its reason${proposed.thin.length ? `; ${proposed.thin.length} still have fewer than 2` : ""}.`,
            filesModified: read.notes.map((n) => n.id),
            completedBy: `connect-notes · ${model}`,
            incomplete: written.failed.length ? `${written.failed.length} link${written.failed.length === 1 ? " was" : "s were"} refused by the vault` : null,
          }),
        )
      : null;
    const { stages, seconds } = await finish();
    const titles = new Map([...read.notes.map((n) => [n.id, n.title] as const), ...Object.values(candidates.candidates).flat().map((c) => [c.id, c.title] as const)]);
    return {
      summary: `${write ? "" : "Dry run: "}${(written ?? proposed).summary}${pipeline ? ` ${pipeline.summary}` : ""} ${seconds} s, $${proposed.cost_usd.toFixed(4)}.`,
      stages,
      dry_run: !write,
      model,
      links: proposed.links.map((l) => ({ ...l, from_title: titles.get(l.from) ?? l.from, to_title: titles.get(l.to) ?? l.to })),
      dropped: proposed.dropped,
      thin: proposed.thin,
      failed: written?.failed ?? [],
      pipeline,
      cost_usd: proposed.cost_usd,
      seconds,
    };
  },
});
