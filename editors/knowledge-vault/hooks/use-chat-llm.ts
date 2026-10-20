import { useCallback, useState } from "react";
import { generateId } from "document-model/core";
import type { Action } from "document-model";
import {
  loadLlm,
  type CatalogEntry,
  type LlmClient,
  type LlmInfo,
} from "../chat/core/index.js";
import type { ScoreCache } from "../chat/core/op-scorer.js";
import {
  loadV1Runtime,
  runV1,
  v1Action,
  type RefCandidates,
  type V1Result,
  type V1Runtime,
} from "../chat/core/v1-pipeline.js";
import type { KnowledgeNoteInfo } from "./use-knowledge-notes.js";

export type ChatLlmStatus = "idle" | "loading" | "ready" | "error";

export interface ProposedAction {
  result: Extract<V1Result, { kind: "action" }>;
  /** Present when the args built a zod-valid action. */
  action?: Action;
  error?: string;
}

export type ChatReply =
  | { kind: "answer"; text: string; result: V1Result }
  | { kind: "proposal"; proposal: ProposedAction };

export interface ChatLoadInfo {
  llm: LlmInfo;
  /** gte-small import + model load (first load in this page), ms. */
  embedderLoadMs: number;
  /** Wall time of this `ensureLoaded` call, ms. */
  wallMs: number;
}

export const NOTE_DOC_TYPE = "bai/knowledge-note";

// One model per page: switching tabs must not reload 229 MB.
let clientPromise: Promise<LlmClient> | null = null;
// Content-free ref-scoring requests, reused for the whole page.
const scoreCache: ScoreCache = new Map();

function hasWebGpu(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

/** The note's referenceable items for an op, labeled for step 2. */
export function noteRefCandidates(
  entry: CatalogEntry,
  note: KnowledgeNoteInfo,
): RefCandidates {
  if (entry.opName === "REMOVE_TOPIC")
    return { id: note.topics.map((t) => ({ id: t.id, label: t.name })) };
  if (entry.opName === "REMOVE_LINK" || entry.opName === "UPDATE_LINK_TYPE")
    return {
      id: note.links.map((l) => ({
        id: l.id,
        label: l.targetTitle ?? l.targetDocumentId,
      })),
    };
  return {};
}

export function useChatLlm() {
  const [status, setStatus] = useState<ChatLlmStatus>(
    clientPromise ? "ready" : "idle",
  );
  const [progress, setProgress] = useState(0);
  const [load, setLoad] = useState<ChatLoadInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** wllama + LFM2.5 and the v1 runtime (gte-small, op index), in parallel. */
  const ensureLoaded = useCallback(async (): Promise<{
    client: LlmClient;
    runtime: V1Runtime;
  }> => {
    const t0 = performance.now();
    if (!clientPromise) {
      setStatus("loading");
      clientPromise = loadLlm({
        backend: hasWebGpu() ? "webgpu" : "cpu",
        onProgress: (loaded, total) => setProgress(total ? loaded / total : 0),
      });
    }
    try {
      const [client, runtime] = await Promise.all([
        clientPromise,
        loadV1Runtime(),
      ]);
      setLoad({
        llm: client.info,
        embedderLoadMs: runtime.embedderLoadMs,
        wallMs: performance.now() - t0,
      });
      setStatus("ready");
      return { client, runtime };
    } catch (err) {
      clientPromise = null;
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStatus("error");
      throw err;
    }
  }, []);

  /** Plain answer for a request that changes nothing (Q&A stub). */
  const answer = useCallback(async (client: LlmClient, question: string) => {
    // TODO(spike): ground answers in `useGraphSearch` results (Scope A).
    const r = await client.chatStream(
      [
        {
          role: "system",
          content:
            "You are a concise assistant inside a personal knowledge vault.",
        },
        { role: "user", content: question },
      ],
      { maxTokens: 256, temperature: 0.3 },
    );
    return r.text;
  }, []);

  /**
   * The v1 pipeline on the selected note: a no-action request is answered,
   * anything else becomes one proposed action (confirm before dispatch).
   */
  const send = useCallback(
    async (utterance: string, note: KnowledgeNoteInfo): Promise<ChatReply> => {
      const { client, runtime } = await ensureLoaded();
      const result = await runV1(
        utterance,
        NOTE_DOC_TYPE,
        (entry) => noteRefCandidates(entry, note),
        {
          runtime,
          completeJson: client.completeJson,
          scoreText: client.scoreText,
          cache: scoreCache,
        },
      );
      if (result.kind === "no-action")
        return {
          kind: "answer",
          text: await answer(client, utterance),
          result,
        };
      const built = v1Action(result, {
        generateId,
        now: () => new Date().toISOString(),
        // TODO(spike): use the signed-in user's identity.
        actor: "chat",
      });
      return {
        kind: "proposal",
        proposal: built.ok
          ? { result, action: built.action }
          : { result, error: built.error },
      };
    },
    [answer, ensureLoaded],
  );

  return { status, progress, load, error, ensureLoaded, send };
}
