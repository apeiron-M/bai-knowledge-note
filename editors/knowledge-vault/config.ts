import type { PHAppConfig } from "@powerhousedao/reactor-browser";

export const editorConfig: PHAppConfig = {
  isDragAndDropEnabled: true,
  allowedDocumentTypes: [
    "bai/knowledge-note",
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
