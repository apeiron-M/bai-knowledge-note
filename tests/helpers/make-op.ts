import type { OperationWithContext } from "@powerhousedao/shared/document-model";

export function makeOp(overrides?: {
  documentId?: string;
  documentType?: string;
  actionType?: string;
  actionInput?: Record<string, unknown>;
  resultingState?: Record<string, unknown>;
  index?: number;
}): OperationWithContext {
  const ts = String(Date.now());
  return {
    operation: {
      id: `op-${ts}`,
      index: overrides?.index ?? 0,
      skip: 0,
      timestampUtcMs: ts,
      hash: "test-hash",
      action: {
        id: `act-${ts}`,
        type: overrides?.actionType ?? "SET_TITLE",
        timestampUtcMs: ts,
        input: overrides?.actionInput ?? {},
        scope: "global",
      },
    },
    context: {
      documentId: overrides?.documentId ?? "test-doc-1",
      documentType: overrides?.documentType ?? "bai/knowledge-note",
      scope: "global",
      branch: "main",
      ordinal: 0,
      resultingState: overrides?.resultingState
        ? JSON.stringify({ global: overrides.resultingState })
        : undefined,
    },
  };
}
