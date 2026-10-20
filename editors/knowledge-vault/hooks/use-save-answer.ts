/**
 * Saving a chat answer as a knowledge note — the writing half.
 *
 * Runs only when the person confirms the draft (`lib/chat/save-answer.ts`),
 * and writes the way the vault itself does, so a saved answer is the same
 * thing as a note written by hand:
 *
 *   1. create the document in /knowledge/notes — `createDocumentRemote`, the
 *      call behind the vault's own "Write a note";
 *   2. its title, description, kind, body, topics and provenance — one
 *      `dispatchActions` batch, signed as the session, the note editor's path;
 *   3. a link to each cited document, with its reason — `ADD_RELATIONSHIP`,
 *      exactly as the note editor's Links tab adds one;
 *   4. if a map was chosen, the map's CORE_IDEA link to the new note — as the
 *      map editor adds one.
 *
 * Each step waits for the vault's answer. A step that fails stops the save
 * and says which, plainly; the note made so far is kept and can be opened —
 * deleting it would lose the person's edits, and an incomplete note is what
 * the health check exists to point at.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { dispatchActions } from "@powerhousedao/reactor-browser";
import { generateId } from "document-model/core";
import { actions } from "document-models/knowledge-note";
import { createDocumentRemote } from "../lib/remote-reactor.js";
import { triggerVaultPull } from "./use-remote-first.js";
import { NO_ANSWER, WRITE_TIMEOUT_MS, writeErrorText } from "../../shared/use-doc-write.js";
import { noteSlug, type AnswerDraft } from "../lib/chat/save-answer.js";
import { executeTool, noteTopics } from "../lib/chat/vault-tools.js";
import type { TopicMapRow } from "../lib/chat/vault-structure.js";

/** Where the note goes and who it records as its author. */
export interface SaveTarget {
  driveId: string;
  /** The provenance author: the person's ENS name or address. */
  author: string;
  /** The conversation it came from, recorded as the provenance session. */
  sessionId: string | null;
  /** A map of content to file the note in; null to leave it unplaced. */
  mapId: string | null;
}

export type SaveStep = "create" | "content" | "links" | "map";

export type SaveOutcome =
  | { ok: true; noteId: string; linked: number; placed: boolean }
  | { ok: false; step: SaveStep; noteId: string | null; error: string };

/** The calls a save makes — injectable, so the order and the failures are tested. */
export interface SaveDeps {
  createNote: (o: { name: string; driveId: string }) => Promise<string>;
  /** Apply actions to one document; resolves with the errors, empty when it all landed. */
  apply: (actions: unknown[], documentId: string) => Promise<string[]>;
  /** Tell the vault's views a document appeared. */
  refresh: () => void;
}

/** `dispatchActions`, waited for: its errors, or a timeout, as plain sentences. */
export async function applyAndWait(acts: unknown[], documentId: string): Promise<string[]> {
  const errors: unknown[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), WRITE_TIMEOUT_MS);
  });
  try {
    const result = await Promise.race([
      dispatchActions(acts as never, documentId, (errs) => errors.push(...errs)),
      timeout,
    ]);
    if (result === "timeout") return [NO_ANSWER];
    if (errors.length > 0) return [writeErrorText(errors)];
    if (!result) return ["The vault could not find the document to change."];
    return [];
  } catch (err) {
    return [writeErrorText([err])];
  } finally {
    clearTimeout(timer);
  }
}

export const REAL_SAVE_DEPS: SaveDeps = {
  createNote: ({ name, driveId }) =>
    createDocumentRemote({
      documentType: "bai/knowledge-note",
      name,
      driveId,
      targetFolderPath: "knowledge/notes",
    }),
  apply: applyAndWait,
  refresh: triggerVaultPull,
};

/** A reactor relationship action, as the note and map editors write one. */
function relationship(
  sourceId: string,
  targetId: string,
  relationshipType: string,
  metadata?: { reason: string; confidence: string },
) {
  return {
    id: generateId(),
    type: "ADD_RELATIONSHIP",
    scope: "document",
    timestampUtcMs: new Date().toISOString(),
    input: { sourceId, targetId, relationshipType, ...(metadata ? { metadata } : {}) },
  };
}

/** What each step was doing, for the sentence that says which one failed. */
const STEP_FAILED: Record<SaveStep, string> = {
  create: "The note could not be created.",
  content: "The note was created, but its title, description and body did not save.",
  links: "The note was saved, but its links to the cited documents did not.",
  map: "The note and its links were saved, but it could not be filed in the map.",
};

export async function saveAnswerAsNote(
  draft: AnswerDraft,
  target: SaveTarget,
  deps: SaveDeps = REAL_SAVE_DEPS,
  onStep?: (step: SaveStep) => void,
): Promise<SaveOutcome> {
  const now = new Date().toISOString();
  const failed = (step: SaveStep, noteId: string | null, why: string): SaveOutcome => ({
    ok: false,
    step,
    noteId,
    error: `${STEP_FAILED[step]} ${why}`.trim(),
  });

  onStep?.("create");
  let noteId: string;
  try {
    noteId = await deps.createNote({ name: noteSlug(draft.title), driveId: target.driveId });
  } catch (err) {
    return failed("create", null, writeErrorText([err]));
  }

  onStep?.("content");
  const title = draft.title.trim();
  const description = draft.description.trim();
  const content = [
    actions.setTitle({ title, updatedAt: now }),
    actions.setDescription({ description, updatedAt: now }),
    actions.setNoteType({ noteType: draft.kind, updatedAt: now }),
    actions.setContent({ content: draft.content, updatedAt: now }),
    ...draft.topics.map((name) => actions.addTopic({ id: generateId(), name })),
    actions.setProvenance({
      author: target.author,
      sourceOrigin: "SESSION_MINE",
      ...(target.sessionId ? { sessionId: target.sessionId } : {}),
      createdAt: now,
    }),
  ];
  const contentErrors = await deps.apply(content, noteId);
  if (contentErrors.length) return failed("content", noteId, contentErrors[0]);

  const links = draft.links.filter((l) => l.include);
  if (links.length > 0) {
    onStep?.("links");
    const linkErrors = await deps.apply(
      links.map((l) =>
        relationship(noteId, l.documentId, l.linkType, { reason: l.reason, confidence: l.confidence }),
      ),
      noteId,
    );
    if (linkErrors.length) return failed("links", noteId, linkErrors[0]);
  }

  if (target.mapId) {
    onStep?.("map");
    const mapErrors = await deps.apply([relationship(target.mapId, noteId, "CORE_IDEA")], target.mapId);
    if (mapErrors.length) return failed("map", noteId, mapErrors[0]);
  }

  deps.refresh();
  return { ok: true, noteId, linked: links.length, placed: target.mapId !== null };
}

export type SaveState =
  | { status: "idle" }
  | { status: "saving"; step: SaveStep }
  | { status: "done"; outcome: SaveOutcome };

/** The save, with its progress and result as state. */
export function useSaveAnswer(deps: SaveDeps = REAL_SAVE_DEPS) {
  const [state, setState] = useState<SaveState>({ status: "idle" });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const save = useCallback(
    async (draft: AnswerDraft, target: SaveTarget) => {
      setState({ status: "saving", step: "create" });
      const outcome = await saveAnswerAsNote(draft, target, deps, (step) => {
        if (alive.current) setState({ status: "saving", step });
      });
      if (alive.current) setState({ status: "done", outcome });
      return outcome;
    },
    [deps],
  );
  const reset = useCallback(() => setState({ status: "idle" }), []);
  return { state, save, reset };
}

/** What the form offers: the vault's maps to file in, and topics the cited notes share. */
export interface SaveOptions {
  maps: TopicMapRow[];
  suggestedTopics: string[];
  loading: boolean;
}

/** How many suggested topics the form offers. */
const SUGGESTED_TOPICS = 3;

/** Loaded when the form opens; nothing here writes. */
export function useSaveOptions(
  driveId: string | undefined,
  citedIds: readonly string[],
  enabled: boolean,
): SaveOptions {
  const [options, setOptions] = useState<SaveOptions>({ maps: [], suggestedTopics: [], loading: false });
  const key = citedIds.join(",");
  useEffect(() => {
    if (!driveId || !enabled) return;
    let cancelled = false;
    setOptions((o) => ({ ...o, loading: true }));
    void Promise.all([
      executeTool("topic_maps", {}, { driveId }),
      noteTopics(driveId, key ? key.split(",") : []),
    ]).then(([mapsResult, topics]) => {
      if (cancelled) return;
      // Most-shared first; a tie keeps the order the answer cited them in.
      const counts = new Map<string, number>();
      for (const list of topics.values()) for (const t of list) counts.set(t, (counts.get(t) ?? 0) + 1);
      const suggested = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, SUGGESTED_TOPICS)
        .map(([t]) => t);
      setOptions({
        maps: mapsResult.ok ? ((mapsResult.data as { maps?: TopicMapRow[] }).maps ?? []) : [],
        suggestedTopics: suggested,
        loading: false,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [driveId, key, enabled]);
  return options;
}
