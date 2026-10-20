/** The vault's counts the chat's landing shows under "Ask <vault> anything". */
export interface OrientationStats {
  nodeCount: number;
  noteCount?: number;
  mocCount?: number;
  openTensionCount?: number;
  edgeCount: number;
}

const count = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

/**
 * The counts from a `vault_stats` answer, or null when it does not carry them.
 * A server without the knowledge graph still answers `vault_stats` — with
 * `{ graphError, sources }` and no counts — and the chat must still open.
 */
export function orientationStats(data: unknown): OrientationStats | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const nodeCount = count(d.nodeCount) ?? count(d.noteCount);
  const edgeCount = count(d.edgeCount);
  if (nodeCount === undefined || edgeCount === undefined) return null;
  return {
    nodeCount,
    noteCount: count(d.noteCount),
    mocCount: count(d.mocCount),
    openTensionCount: count(d.openTensionCount),
    edgeCount,
  };
}
