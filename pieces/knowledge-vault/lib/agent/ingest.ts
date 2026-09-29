import type { KnowledgeVaultClient } from "../common/client.js";
import type { StoreLike } from "../common/context.js";
import { KnowledgeVaultApiError } from "../common/errors.js";

/**
 * Ingest one source: create it in the vault's /sources (optionally in a
 * named subfolder), queue it for extraction, and never twice for one dedupe
 * key. POST sources has no idempotency of its own, and a webhook sender
 * (an Apps Script backfill run twice, a provider retry) repeats deliveries,
 * so the key is remembered per workflow in ctx.store.
 */

export const SOURCE_TYPES = ["ARTICLE", "PAPER", "BOOK_CHAPTER", "TRANSCRIPT", "DOCUMENTATION", "CONVERSATION", "WEB_PAGE", "MANUAL_ENTRY"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export type IngestInput = {
  drive: string;
  title: string;
  content: string;
  sourceType: SourceType;
  description?: string;
  author?: string;
  url?: string;
  publishedAt?: string;
  folder?: string;
  queue: boolean;
  dedupeKey?: string;
  tool?: string;
};

export type IngestResult = {
  summary: string;
  skipped: boolean;
  source_id: string | null;
  status: string | null;
  folder_id: string | null;
  published_at: string | null;
  queued: boolean;
};

const DEDUPE_PREFIX = "knowledge-vault:ingest:";

/** A date the vault accepts: an ISO instant in UTC. Anything unparsable is dropped, not guessed. */
export function toUtcInstant(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  const ms = Date.parse(value.trim());
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** The vault's content check refuses a literal backslash-n; text that means a line break gets a real one. */
export function realLineBreaks(text: string): string {
  return /\\[nrt]/.test(text) && !/[\n\r]/.test(text) ? text.replace(/\\r\\n|\\n/g, "\n").replace(/\\r/g, "\n").replace(/\\t/g, "\t") : text;
}

export async function ingestSource(client: KnowledgeVaultClient, store: StoreLike | undefined, input: IngestInput): Promise<IngestResult> {
  const title = input.title.trim();
  const content = realLineBreaks(input.content).trim();
  if (!title) throw new KnowledgeVaultApiError("A source needs a title", { category: "validation" });
  if (!content) throw new KnowledgeVaultApiError(`"${title}" has no content to ingest`, { category: "validation" });
  const publishedAt = toUtcInstant(input.publishedAt);
  const key = input.dedupeKey?.trim() ? `${DEDUPE_PREFIX}${input.drive}:${input.dedupeKey.trim()}` : null;
  if (key && store) {
    const seen = (await store.get(key)) as { source_id?: string } | null | undefined;
    if (seen?.source_id) {
      return { summary: `Already ingested "${title}" (source ${seen.source_id}); skipped.`, skipped: true, source_id: seen.source_id, status: null, folder_id: null, published_at: publishedAt, queued: false };
    }
  }
  let folderId: string | null = null;
  if (input.folder?.trim()) {
    const folder = await client.request<{ id: string }>({ method: "POST", path: "sources/folders", json: { drive: input.drive, name: input.folder.trim() } });
    folderId = folder.id;
  }
  const created = await client.request<{ id: string; status?: string; task?: { id: string; created: boolean } }>({
    method: "POST",
    path: "sources",
    timeoutMs: 120_000,
    json: {
      drive: input.drive,
      title,
      content,
      sourceType: input.sourceType,
      ...(input.description?.trim() ? { description: input.description.trim() } : {}),
      ...(input.author?.trim() ? { author: input.author.trim() } : {}),
      ...(input.url?.trim() ? { url: input.url.trim() } : {}),
      ...(publishedAt ? { publishedAt } : {}),
      method: "workflow",
      tool: input.tool?.trim() || "knowledge-vault piece",
      queue: input.queue,
      ...(folderId ? { parentFolder: folderId } : {}),
    },
  });
  if (key && store) await store.put(key, { source_id: created.id });
  const queued = input.queue && Boolean(created.task);
  return {
    summary: `Ingested "${title}" as a ${input.sourceType.toLowerCase().replace("_", " ")} source${input.folder?.trim() ? ` in /sources/${input.folder.trim()}` : ""}${queued ? ", queued for extraction" : input.queue ? " (the vault has no pipeline queue, so it is not queued)" : ", not queued"}.`,
    skipped: false,
    source_id: created.id,
    status: created.status ?? null,
    folder_id: folderId,
    published_at: publishedAt,
    queued,
  };
}
