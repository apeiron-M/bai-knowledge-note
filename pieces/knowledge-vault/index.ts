import { createPiece, PieceCategory } from "@powerhousedao/pieces-framework";
import { agentExtractAction } from "./lib/actions/agent-extract.js";
import { extractClaimsAction } from "./lib/actions/extract-claims.js";
import { searchAction } from "./lib/actions/search.js";
import { knowledgeVaultAuth } from "./lib/auth.js";
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
  actions: [searchAction, extractClaimsAction, agentExtractAction],
  triggers: [],
});

export { knowledgeVaultAuth };

export default knowledgeVault;
