import type { PHAppConfig } from "@powerhousedao/reactor-browser";

/** App config for the KnowledgeVault drive (allowed types, drag-and-drop, etc.) */
export const appConfig: PHAppConfig = {
  isDragAndDropEnabled: true,
  allowedDocumentTypes: [
    "bai/knowledge-note",
    "bai/knowledge-graph",
    "bai/moc",
    "bai/source",
    "bai/pipeline-queue",
    "bai/observation",
    "bai/tension",
    "bai/vault-config",
    "bai/derivation",
    "bai/health-report",
    "bai/research-claim",
  ],
};
