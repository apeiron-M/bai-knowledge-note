import { useEffect, useMemo, useState } from "react";
import { useSelectedDriveId } from "@powerhousedao/reactor-browser";
import { paletteSemanticFrom, type PaletteSemantic } from "../lib/palette-search.js";
import { fetchSemanticSearch } from "./use-graph-search.js";
import { resolveKnowledgeGraphEndpoint } from "./subgraph-endpoint.js";

/** A pause in the typing before the server is asked; each keystroke cancels the last question. */
const PAUSE_MS = 250;
/** Shorter than this, a query means too little to rank by meaning. */
const MIN_CHARS = 3;
/** Enough for the palette's 4 notes and 2 topics, with room for what it leaves out. */
const LIMIT = 10;

/**
 * The server's semantic answer for what is typed in the palette, or null
 * until there is one (and wherever the server ranks by words alone). The
 * palette shows its own word matches meanwhile.
 */
export function usePaletteSemantic(query: string, enabled: boolean): PaletteSemantic | null {
  const driveId = useSelectedDriveId();
  const endpoint = useMemo(() => resolveKnowledgeGraphEndpoint(), []);
  const [answer, setAnswer] = useState<PaletteSemantic | null>(null);
  const q = query.trim();

  useEffect(() => {
    if (!enabled || !driveId || q.length < MIN_CHARS) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void fetchSemanticSearch(endpoint, driveId, q, LIMIT, controller.signal).then((results) => {
        if (!controller.signal.aborted) setAnswer(paletteSemanticFrom(q, results));
      });
    }, PAUSE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, driveId, endpoint, q]);

  return enabled && answer?.query === q ? answer : null;
}
