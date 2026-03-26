import type { EditorModule } from "document-model";
import { KnowledgeGraphEditor } from "./knowledge-graph-editor/module.js";
import { KnowledgeNoteEditor } from "./knowledge-note-editor/module.js";
import { KnowledgeVault } from "./knowledge-vault/module.js";
import { MocEditor } from "./moc-editor/module.js";
import { ObservationEditor } from "./observation-editor/module.js";
import { PipelineQueueEditor } from "./pipeline-queue-editor/module.js";
import { SourceEditor } from "./source-editor/module.js";
import { VaultConfigEditor } from "./vault-config-editor/module.js";

export const editors: EditorModule[] = [
  KnowledgeGraphEditor,
  KnowledgeNoteEditor,
  KnowledgeVault,
  MocEditor,
  ObservationEditor,
  PipelineQueueEditor,
  SourceEditor,
  VaultConfigEditor,
];
