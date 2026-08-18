/**
 * Re-export shim. The remote reactor client moved to
 * `editors/shared/remote-reactor.ts` so editors outside knowledge-vault
 * (project-editor, which must create WBS documents server-side under
 * remote-first mode) can use the one create/mutate/delete path instead
 * of growing a second GraphQL client.
 *
 * `editors/shared` deliberately imports nothing from `editors/*` editor
 * folders, so this direction (knowledge-vault → shared) is the only
 * edge and cannot cycle.
 */
export {
  announceDocumentMutation,
  createDocumentRemote,
  createFolderRemote,
  deleteDocumentRemote,
  mutateDocumentRemote,
  resolveReactorReadEndpoint,
} from "../../shared/remote-reactor.js";
export type { VaultAction } from "../../shared/remote-reactor.js";
