import { createAction } from "@powerhousedao/pieces-framework";
import { llmFor, stageRunner } from "../agent/runner.js";
import { checkNote, duplicateCandidates, judgeStage, planRetirements, readVerifyNotes, retireStage } from "../agent/verify.js";
import { knowledgeVaultAuth } from "../auth.js";
import { clientForContext } from "../common/context.js";
import { driveProp, modelProp, resolveSource, sourceIdProp, sourceProp } from "../common/props.js";
import { modeProp } from "./modes.js";

/** The verify phase: check a source's notes before a person approves them, and retire duplicates. */
export const verifyNotesAction = createAction({
  auth: knowledgeVaultAuth,
  name: "verify-notes",
  displayName: "Verify notes",
  description:
    "Checks the notes a source produced before you approve them: the note rules, links, provenance and MoC membership, a recite test by the model, and a duplicate check against the whole vault. Write mode retires confirmed duplicates (the surviving note SUPERSEDES the duplicate, which is rejected back to DRAFT with a comment). Nothing is approved; the task waits at verify for your review. Set the step's timeout to 300 s.",
  audience: "both",
  props: { drive: driveProp, source: sourceProp, source_id: sourceIdProp, model: modelProp, mode: modeProp("Write: retire duplicates") },
  outputSchema: {
    fields: [
      { key: "summary", label: "What happened" },
      { key: "stages", label: "Stages" },
      { key: "notes", label: "Each note: pass, flag or duplicate, with the reasons" },
      { key: "retired", label: "Duplicates retired" },
      { key: "flagged_count", label: "Notes to look at in review" },
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
      const r = await readVerifyNotes(client, drive, sourceId);
      return { ...r, summary: `"${r.sourceTitle}" has ${r.notes.length} note${r.notes.length === 1 ? "" : "s"} to verify.` };
    });
    if (read.notes.length === 0) {
      const { stages, seconds } = await finish();
      return { summary: `"${read.sourceTitle}" has no notes to verify. ${seconds} s.`, stages, dry_run: !write, model, notes: [], retired: [], flagged_count: 0, cost_usd: 0, seconds };
    }
    const checks = await stage("checks", () => {
      const byNote = new Map(read.notes.map((n) => [n.id, checkNote(n, sourceId)]));
      const failing = [...byNote.values()].filter((i) => i.length).length;
      return { byNote, summary: `${read.notes.length - failing} of ${read.notes.length} notes pass the rules, links and provenance checks.` };
    });
    const candidates = await stage("duplicates", async () => {
      const c = await duplicateCandidates(client, drive, read.notes);
      const withAny = Object.values(c).filter((l) => l.length).length;
      return { candidates: c, summary: `${withAny} note${withAny === 1 ? " has" : "s have"} a near neighbour in the vault worth comparing.` };
    });
    const judged = await stage("review", async () => {
      const j = await judgeStage(llm, model, read.notes, candidates.candidates);
      const flagged = [...j.verdicts.values()].filter((v) => v.verdict === "flag").length;
      const dups = [...j.verdicts.values()].filter((v) => v.duplicate_of).length;
      return { ...j, summary: `Recite test: ${read.notes.length - flagged} pass, ${flagged} flagged; ${dups} duplicate${dups === 1 ? "" : "s"} confirmed.` };
    });
    const retirements = planRetirements(read.notes, judged.verdicts, candidates.candidates);
    const titles = new Map(read.notes.map((n) => [n.id, n.title]));
    const retired = write && retirements.length ? await stage("retire", () => retireStage(client, { retirements, titles, actor: `verify-notes · ${model}` })) : null;
    const { stages, seconds } = await finish();

    const retiredIds = new Set((retired?.retired ?? (write ? [] : retirements)).map((r) => r.duplicate));
    const notes = read.notes.map((n) => {
      const v = judged.verdicts.get(n.id);
      const issues = [...(checks.byNote.get(n.id) ?? []), ...(v?.verdict === "flag" ? v.problems : [])];
      const dup = retirements.find((r) => r.duplicate === n.id);
      return {
        title: n.title,
        id: n.id,
        result: dup ? (retiredIds.has(n.id) ? (write ? "retired as duplicate" : "duplicate (would retire)") : "duplicate (not retired)") : issues.length ? "check" : "pass",
        issues,
        ...(dup ? { duplicate_of: dup.survivor_title, why: dup.reason } : {}),
      };
    });
    const flagged = notes.filter((n) => n.result === "check").length;
    const passed = notes.filter((n) => n.result === "pass").length;
    const dupWord = write ? `${retired?.retired.length ?? 0} duplicate${(retired?.retired.length ?? 0) === 1 ? "" : "s"} retired` : `${retirements.length} duplicate${retirements.length === 1 ? "" : "s"} would be retired`;
    return {
      summary: `${write ? "" : "Dry run: "}${passed} note${passed === 1 ? "" : "s"} ready to approve, ${flagged} to check, ${dupWord}. The task waits at verify for your review. ${seconds} s, $${judged.cost.toFixed(4)}.`,
      stages,
      dry_run: !write,
      model,
      notes,
      retired: retired?.retired ?? [],
      problems: retired?.problems ?? [],
      flagged_count: flagged,
      cost_usd: Math.round(judged.cost * 10_000) / 10_000,
      seconds,
    };
  },
});
