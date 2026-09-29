import { Property } from "@powerhousedao/pieces-framework";
import { LlmClient, MODEL_CRITERIA, vaultModelLabel, vaultModels } from "../agent/llm.js";
import { knowledgeVaultAuth } from "../auth.js";
import { readAuth } from "./auth-value.js";
import { clientFor } from "./context.js";
import { errorMessage, KnowledgeVaultApiError } from "./errors.js";

/**
 * The vault drive a step acts on. Chosen per step, not per connection, so one
 * identity can serve several vaults. Filled from `GET drives`, which lists only
 * the vault drives the bearer may read.
 */
export const driveProp = Property.Dropdown({
  auth: knowledgeVaultAuth,
  displayName: "Vault",
  description: "The vault drive to act on",
  required: true,
  refreshers: [],
  options: async ({ auth }) => {
    if (!auth) {
      return { disabled: true, placeholder: "Connect a Knowledge Vault first", options: [] };
    }
    try {
      const { drives } = await clientFor(auth).drives();
      return {
        disabled: false,
        placeholder: drives.length ? "Choose a vault" : "This identity can read no vault",
        options: drives.map((drive) => ({ label: drive.name, value: drive.id })),
      };
    } catch (error) {
      return {
        disabled: true,
        placeholder: `Could not list vaults: ${errorMessage(error)}`,
        options: [],
      };
    }
  },
});

/**
 * The model an agent step runs on. Filled live from the provider with the
 * connection's key, tool-capable models only (an agent cannot work without
 * tools), each labelled with its price and context so cost is visible at the
 * moment of choosing. Typing narrows the list by name or id.
 */
export const modelProp = Property.Dropdown({
  auth: knowledgeVaultAuth,
  displayName: "Model",
  description: `Cheap models that reason and answer in JSON (intelligence index ${MODEL_CRITERIA.minIntelligence}+, at most $${MODEL_CRITERIA.maxOutputPerM} per M output tokens; free ones when they qualify). Tested ones first. Type a name to find any other model, e.g. sonnet. Empty: the connection's default model`,
  required: false,
  refreshers: [],
  refreshOnSearch: true,
  options: async ({ auth }, ctx) => {
    if (!auth) return { disabled: true, placeholder: "Connect a Knowledge Vault first", options: [] };
    let llm;
    try {
      llm = readAuth(auth).llm;
    } catch (error) {
      return { disabled: true, placeholder: errorMessage(error), options: [] };
    }
    if (!llm) return { disabled: true, placeholder: "Add an LLM API key to the connection first", options: [] };
    try {
      const search = (ctx as { searchValue?: string } | undefined)?.searchValue?.trim().toLowerCase() ?? "";
      const models = await vaultModels(new LlmClient(llm), search);
      return {
        disabled: false,
        placeholder: llm.defaultModel ? `Default: ${llm.defaultModel}` : "Choose a model",
        options: models.map((m) => ({ label: vaultModelLabel(m), value: m.id })),
      };
    } catch (error) {
      return { disabled: true, placeholder: `Could not list models: ${errorMessage(error)}`, options: [] };
    }
  },
});

type DriveNode = { id: string; name: string; documentType?: string | null; parentFolder?: string | null };

/**
 * The vault's sources, labelled with the folder they sit in, for the chosen
 * vault. Optional where a trigger can supply the source instead: Studio has
 * no expression picker on a dropdown, so the trigger's id goes in sourceIdProp.
 */
export const sourceProp = Property.Dropdown({
  auth: knowledgeVaultAuth,
  displayName: "Source",
  description: "A source in the vault's /sources. Leave empty when a trigger supplies it in Source id",
  required: false,
  refreshers: ["drive"],
  refreshOnSearch: true,
  options: async ({ auth, drive }, ctx) => {
    if (!auth) return { disabled: true, placeholder: "Connect a Knowledge Vault first", options: [] };
    if (typeof drive !== "string" || !drive) return { disabled: true, placeholder: "Choose a vault first", options: [] };
    try {
      const doc = await clientFor(auth).request<{ state?: { global?: { nodes?: DriveNode[] } } }>({ path: `notes/${encodeURIComponent(drive)}`, query: { drive } });
      const nodes = doc.state?.global?.nodes ?? [];
      const folders = new Map(nodes.filter((n) => !n.documentType).map((n) => [n.id, n.name]));
      const search = (ctx as { searchValue?: string } | undefined)?.searchValue?.trim().toLowerCase() ?? "";
      const sources = nodes
        .filter((n) => n.documentType === "bai/source")
        .map((n) => {
          const folder = n.parentFolder ? folders.get(n.parentFolder) : undefined;
          return { label: folder && folder !== "sources" ? `${folder} / ${n.name}` : n.name, value: n.id };
        })
        .filter((o) => !search || o.label.toLowerCase().includes(search))
        .sort((a, b) => a.label.localeCompare(b.label));
      return { disabled: false, placeholder: sources.length ? "Choose a source" : "This vault has no sources", options: sources };
    } catch (error) {
      return { disabled: true, placeholder: `Could not list sources: ${errorMessage(error)}`, options: [] };
    }
  },
});

/** Where a trigger's source goes: {{trigger.payload.source_id}}. Wins over the dropdown. */
export const sourceIdProp = Property.ShortText({
  displayName: "Source id (from a trigger)",
  description: "Map {{trigger.payload.source_id}} here to run on the source the trigger found. Overrides Source",
  required: false,
});

/** The source a step works on: the mapped id first, else the dropdown. */
export function resolveSource(props: { source?: unknown; source_id?: unknown }): string {
  const mapped = typeof props.source_id === "string" ? props.source_id.trim() : "";
  const picked = typeof props.source === "string" ? props.source.trim() : "";
  const id = mapped || picked;
  if (!id) throw new KnowledgeVaultApiError("Choose a Source, or map one into Source id (e.g. {{trigger.payload.source_id}})", { category: "validation" });
  return id;
}
