import { createPiece, PieceCategory } from "@powerhousedao/pieces-framework";
import { connectNotesAction } from "./lib/actions/connect-notes.js";
import { extractClaimsAction } from "./lib/actions/extract-claims.js";
import { ingestSourceAction } from "./lib/actions/ingest-source.js";
import { placeInMocsAction } from "./lib/actions/place-in-mocs.js";
import { verifyNotesAction } from "./lib/actions/verify-notes.js";
import { searchAction } from "./lib/actions/search.js";
import { knowledgeVaultAuth } from "./lib/auth.js";
import { newPipelineTaskTrigger } from "./lib/triggers/new-pipeline-task.js";
import { KNOWLEDGE_VAULT_LOGO } from "./lib/logo.js";

/**
 * The knowledge vault as a workflow piece: an HTTP client of the vault's REST
 * surface, authenticated with a Renown bearer. See
 * docs/plans/workflow-piece.md for the full action and trigger catalogue.
 * Block types are `@powerhousedao/piece-knowledge-vault#<name>`; names are
 * permanent.
 */
export const knowledgeVault = createPiece({
  displayName: "Knowledge Vault",
  description:
    "Search, read and write a Powerhouse knowledge vault: ingest sources, create and link notes, and follow the pipeline.",
  logoUrl: KNOWLEDGE_VAULT_LOGO,
  authors: ["powerhouse"],
  categories: [PieceCategory.PRODUCTIVITY],
  minimumSupportedRelease: "0.30.0",
  auth: knowledgeVaultAuth,
  actions: [searchAction, ingestSourceAction, extractClaimsAction, connectNotesAction, placeInMocsAction, verifyNotesAction],
  triggers: [newPipelineTaskTrigger],
});

// The runtime's loader identifies a piece by `constructor.name === "Piece"`
// (Activepieces' own check) before falling back to its shape. Minified (since
// 6.2.3-dev.40), the inlined framework's Piece class is renamed; pin it.
Object.defineProperty(knowledgeVault.constructor, "name", { value: "Piece" });

export { knowledgeVaultAuth };

export default knowledgeVault;
