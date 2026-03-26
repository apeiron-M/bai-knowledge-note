import type { PHDriveEditorConfig } from "@powerhousedao/reactor-browser";

/** Editor config for the KnowledgeVault drive app */
export const editorConfig: PHDriveEditorConfig = {
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
