export type TemplateOp = { type: string; input: unknown };
export type HistoryOp = { type: string; input: unknown; error?: string | null };
export type TemplateIds = {
  driveId?: string;
  connectionId?: string;
  switchboardOrigin?: string;
  secretRefs: Record<string, string>;
  model?: string;
  pieceVersion?: string;
};
export type PipelineTemplate = {
  version: 1;
  exportedAt: string;
  placeholders: string[];
  connection: { documentType: "powerhouse/connection"; operations: TemplateOp[] };
  workflow: { documentType: "powerhouse/workflow"; operations: TemplateOp[] };
  source?: { switchboard: string; workflowId: string; connectionId: string };
};
export function deriveIds(docs: { workflow: HistoryOp[]; connection: HistoryOp[] }): TemplateIds;
export function templatize(docs: { workflow: HistoryOp[]; connection: HistoryOp[] }, ids?: TemplateIds): PipelineTemplate;
