import { readAuth } from "./auth-value.js";
import { KnowledgeVaultClient } from "./client.js";

// The subset of the framework's Store this piece uses, declared structurally
// so actions and triggers stay testable without building a whole context.
export interface StoreLike {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<unknown>;
}

// Only what the client needs, so every context the host hands a hook fits.
export interface KnowledgeVaultRunContext {
  auth?: unknown;
}

export function clientFor(auth: unknown): KnowledgeVaultClient {
  return new KnowledgeVaultClient(readAuth(auth));
}

export function clientForContext(
  context: KnowledgeVaultRunContext,
): KnowledgeVaultClient {
  return clientFor(context.auth);
}
