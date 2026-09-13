import { knowledgeNoteRules } from "./rules/knowledge-note.js";
import { mocRules } from "./rules/moc.js";
import { pipelineQueueRules } from "./rules/pipeline-queue.js";
import { scopeOfWorkRules } from "./rules/scope-of-work.js";
import { wbsRules } from "./rules/wbs.js";
import type { ModelRule } from "./types.js";

export const RULES: Record<string, ModelRule[]> = {
  "bai/knowledge-note": knowledgeNoteRules,
  "bai/moc": mocRules,
  "bai/pipeline-queue": pipelineQueueRules,
  "powerhouse/scopeofwork": scopeOfWorkRules,
  "bai/wbs": wbsRules,
};