import { useCallback, useMemo, useState } from "react";
import { generateId } from "document-model/core";
import type { Action } from "document-model";
import { buildVaultCatalog } from "../chat/core/catalog-models.js";
import {
  buildAction,
  createOpRetriever,
  fillArgs,
  generateAction,
  loadLlm,
  type CatalogEntry,
  type GenerateResult,
  type LlmClient,
  type LlmInfo,
} from "../chat/core/index.js";

export type ChatLlmStatus = "idle" | "loading" | "ready" | "error";

export interface ProposedAction {
  entry: CatalogEntry;
  generation: GenerateResult;
  /** Present when the args built a zod-valid action. */
  action?: Action;
  error?: string;
}

/** Ids a ref-id field may take, derived from the selected note's state. */
export interface NoteRefs {
  topicIds: string[];
  linkIds: string[];
}

// One model per page: switching tabs must not reload 229 MB.
let clientPromise: Promise<LlmClient> | null = null;

function hasWebGpu(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

function refCandidatesFor(
  entry: CatalogEntry,
  refs: NoteRefs | undefined,
): Record<string, string[]> | undefined {
  if (!refs) return undefined;
  if (entry.opName === "REMOVE_TOPIC") return { id: refs.topicIds };
  if (entry.opName === "REMOVE_LINK" || entry.opName === "UPDATE_LINK_TYPE") {
    return { id: refs.linkIds };
  }
  return undefined;
}

export function useChatLlm() {
  const [status, setStatus] = useState<ChatLlmStatus>(
    clientPromise ? "ready" : "idle",
  );
  const [progress, setProgress] = useState(0);
  const [info, setInfo] = useState<LlmInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const catalog = useMemo(() => buildVaultCatalog(), []);
  const retriever = useMemo(() => createOpRetriever(catalog), [catalog]);

  const ensureLoaded = useCallback(async (): Promise<LlmClient> => {
    if (!clientPromise) {
      setStatus("loading");
      clientPromise = loadLlm({
        backend: hasWebGpu() ? "webgpu" : "cpu",
        onProgress: (loaded, total) => setProgress(total ? loaded / total : 0),
      });
    }
    try {
      const client = await clientPromise;
      setInfo(client.info);
      setStatus("ready");
      return client;
    } catch (err) {
      clientPromise = null;
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStatus("error");
      throw err;
    }
  }, []);

  /** Utterance -> retrieved candidates -> two-step generation -> action. */
  const propose = useCallback(
    async (
      utterance: string,
      docType: string,
      refs?: NoteRefs,
    ): Promise<ProposedAction | null> => {
      const client = await ensureLoaded();
      const candidates = retriever
        .retrieve(utterance, { k: 5, docType })
        .map((h) => h.entry);
      const first = await generateAction(utterance, candidates, {
        completeJson: client.completeJson,
      });
      const entry = candidates.find((c) => c.key === first.key);
      if (!entry) return null;
      // Re-fill args with ref-id enums when the chosen op needs them.
      const refCandidates = refCandidatesFor(entry, refs);
      let generation = first;
      if (refCandidates) {
        const filled = await fillArgs(utterance, entry, {
          completeJson: client.completeJson,
          refCandidates,
        });
        generation = {
          ...first,
          args: filled.args,
          raw: { ...first.raw, step2: filled.result?.text ?? null },
        };
      }
      if (!generation.args) {
        return { entry, generation, error: generation.error };
      }
      const built = buildAction(entry, generation.args, {
        generateId,
        now: () => new Date().toISOString(),
        // TODO(spike): use the signed-in user's identity.
        actor: "chat",
      });
      return built.ok
        ? { entry, generation, action: built.action }
        : { entry, generation, error: built.error };
    },
    [ensureLoaded, retriever],
  );

  /**
   * Q&A stub: plain unconstrained chat.
   * TODO(spike): ground answers in `useGraphSearch` results (Scope A).
   */
  const ask = useCallback(
    async (question: string, onDelta?: (d: string) => void) => {
      const client = await ensureLoaded();
      const r = await client.chatStream(
        [
          {
            role: "system",
            content:
              "You are a concise assistant inside a personal knowledge vault.",
          },
          { role: "user", content: question },
        ],
        { maxTokens: 256, temperature: 0.3, onDelta },
      );
      return r.text;
    },
    [ensureLoaded],
  );

  return { status, progress, info, error, ensureLoaded, propose, ask };
}
