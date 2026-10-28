/**
 * Op descriptions keyed by catalog key (`<model>:<OP>`): Kev's option text,
 * BM25 retrieval and both prompts. M2: the text lives in `chat.overrides.ts`
 * (`descriptions`) at the vault root, and this is the generated manifest's
 * table (`chat-manifest/`, `npx nl-generate`). The durable fix is
 * `SET_OPERATION_DESCRIPTION` via reactor-mcp (with the vault LoRA retrain,
 * M2b-data); `<m>.json`, `schema.graphql` and `gen/` are derived and must not
 * be hand-edited.
 */
import { chatManifest } from "../../../../chat-manifest/index.js";

export const OP_DESCRIPTIONS = chatManifest.opDescriptions;
