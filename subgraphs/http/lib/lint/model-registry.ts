import * as knowledgeNote from "../../../../document-models/knowledge-note/v1/gen/schema/zod.js";
import * as moc from "../../../../document-models/moc/v1/gen/schema/zod.js";
import * as source from "../../../../document-models/source/v1/gen/schema/zod.js";
import * as pipelineQueue from "../../../../document-models/pipeline-queue/v1/gen/schema/zod.js";
import * as healthReport from "../../../../document-models/health-report/v1/gen/schema/zod.js";
import * as vaultConfig from "../../../../document-models/vault-config/v1/gen/schema/zod.js";
import * as observation from "../../../../document-models/observation/v1/gen/schema/zod.js";
import * as tension from "../../../../document-models/tension/v1/gen/schema/zod.js";
import * as researchClaim from "../../../../document-models/research-claim/v1/gen/schema/zod.js";
import * as derivation from "../../../../document-models/derivation/v1/gen/schema/zod.js";
import * as scopeOfWork from "../../../../document-models/scope-of-work/v1/gen/schema/zod.js";
import * as wbs from "../../../../document-models/work-breakdown-structure/v1/gen/schema/zod.js";

type SchemaFactory = () => {
  safeParse: (input: unknown) => {
    success: boolean;
    error?: {
      issues: { path: (string | number)[]; message: string }[];
    };
  };
};

const MODULES: Record<string, Record<string, unknown>> = {
  "bai/knowledge-note": knowledgeNote as unknown as Record<string, unknown>,
  "bai/moc": moc as unknown as Record<string, unknown>,
  "bai/source": source as unknown as Record<string, unknown>,
  "bai/pipeline-queue": pipelineQueue as unknown as Record<string, unknown>,
  "bai/health-report": healthReport as unknown as Record<string, unknown>,
  "bai/vault-config": vaultConfig as unknown as Record<string, unknown>,
  "bai/observation": observation as unknown as Record<string, unknown>,
  "bai/tension": tension as unknown as Record<string, unknown>,
  "bai/research-claim": researchClaim as unknown as Record<string, unknown>,
  "bai/derivation": derivation as unknown as Record<string, unknown>,
  "powerhouse/scopeofwork": scopeOfWork as unknown as Record<string, unknown>,
  "bai/wbs": wbs as unknown as Record<string, unknown>,
};

export function pascalToScreamingSnake(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
}

export function schemaFor(
  documentType: string,
  actionType: string,
): SchemaFactory | undefined {
  const module = MODULES[documentType];
  if (!module) return undefined;
  for (const [key, value] of Object.entries(module)) {
    if (typeof value !== "function" || !key.endsWith("InputSchema")) continue;
    const action = pascalToScreamingSnake(
      key.slice(0, -"InputSchema".length),
    );
    if (action === actionType) return value as unknown as SchemaFactory;
  }
  return undefined;
}

export function operationsFor(documentType: string): Set<string> | undefined {
  const module = MODULES[documentType];
  if (!module) return undefined;
  const out = new Set<string>();
  for (const key of Object.keys(module)) {
    if (key.endsWith("InputSchema")) {
      out.add(pascalToScreamingSnake(key.slice(0, -"InputSchema".length)));
    }
  }
  return out;
}

export function hasDocumentType(documentType: string): boolean {
  return documentType in MODULES;
}
