/**
 * Re-export shim. The endpoint resolver moved to
 * `editors/shared/subgraph-endpoint.ts` so cross-editor consumers
 * (project-editor's remote WBS create, `shared/remote-reactor.ts`) can
 * reach it without importing out of the knowledge-vault editor.
 *
 * Kept so the knowledge-vault's own `./subgraph-endpoint.js` imports
 * keep resolving; new code should import from `editors/shared` directly.
 */
export {
  resolveKnowledgeGraphEndpoint,
  resolveReactorEndpoint,
  resolveSwitchboardOrigin,
} from "../../shared/subgraph-endpoint.js";
