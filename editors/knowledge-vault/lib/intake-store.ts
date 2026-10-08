import { getHostConfig } from "../../shared/host-config.js";
import {
  addFiles,
  discardUnpublished,
  isReviewReady,
  markPublished,
  removeFile,
  setAllSections,
  setState,
  toggleSection,
  validateFile,
  type ConversionProgress,
  type ConvertedFile,
  type IntakeFile,
} from "./intake-model.js";
import {
  attachOriginal,
  conversionProgress,
  convertFile,
  publishFile,
  PublishPartialFailure,
  type AttachmentPort,
  type PublishResult,
} from "./intake-service.js";
import { createVaultApi, VaultApiFailure, type VaultApi } from "./vault-api.js";

/**
 * The intake batch as a page-lifetime store, one per drive.
 *
 * The batch used to be React state, hoisted to `DriveExplorer` so a tab switch
 * kept it. Anything that unmounted the explorer still dropped it: switching
 * drives in Connect, or the desktop app's Settings, Vaults and Workflows
 * screens. The queue went with it, and the conversion in flight finished on
 * the server for nobody — so the next file met `CONVERT_BUSY`. Here the batch
 * and its scheduler live outside React: conversion carries on while no view
 * shows it, and the next mount reads it back.
 *
 * Still one file at a time, on purpose. The service's warm pipeline is
 * single-threaded and answers a second caller `CONVERT_BUSY`, so converting in
 * parallel would only reorder work inside the engine while making the per-file
 * progress a lie. Adding files never waits for it: a file joins the queue the
 * moment it is chosen or dropped, and its bytes are read in the background.
 *
 * What it cannot outlive is the page: a reload or a closed tab loses the files
 * that are not in the vault yet.
 */

/** A file the user chose or dropped: its bytes, or the `File` to read them from. */
export type IncomingFile = {
  name: string;
  size: number;
  mimeType: string;
  data: Uint8Array | Blob;
};

export type IntakeNotice = { kind: "ok" | "error"; text: string };

export type IntakeSnapshot = {
  files: readonly IntakeFile[];
  /** The user asked for the panel ("Add sources"); it also shows while the batch is non-empty. */
  requested: boolean;
  openId: string | null;
  publishing: boolean;
  /** One line of feedback under the goal header: what landed, or what failed. */
  notice: IntakeNotice | null;
  /** Files the last pick or drop could not take, each with the reason. */
  refused: readonly string[];
};

export type IntakeDeps = {
  convert: (
    input: {
      name: string;
      bytes: Uint8Array;
      ocr: boolean;
      job: string;
      figures: boolean;
    },
    api: VaultApi,
  ) => Promise<ConvertedFile>;
  progress: (job: string, api: VaultApi) => Promise<ConversionProgress | null>;
  publish: (
    file: IntakeFile,
    bytes: Uint8Array,
    deps: { api: VaultApi; attachments?: AttachmentPort; driveId: string },
  ) => Promise<PublishResult>;
  attach: (
    file: IntakeFile,
    bytes: Uint8Array,
    sourceIds: readonly string[],
    deps: { api: VaultApi; attachments: AttachmentPort; driveId: string },
  ) => Promise<{ attached: boolean; attachError?: string }>;
  now: () => number;
  jobId: () => string;
  /** True while the page is in the background: progress is not polled for nobody. */
  isHidden: () => boolean;
  /** Ask the browser not to freeze the page while work is in flight; returns the release. */
  keepAlive: () => () => void;
};

export type IntakeStore = ReturnType<typeof createIntakeStore>;

/** How long to leave a busy converter alone before asking again. */
export const BUSY_RETRY_MS = 8_000;
/** The service counts pages as they finish; asked once a second while a file converts. */
export const PROGRESS_POLL_MS = 1_000;

const BUSY_MESSAGE =
  "the converter is busy with another file — trying again shortly";

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * Sort a pick or a drop into what can be converted and what cannot, with the
 * reason. The size and format check runs here so a file the service would
 * refuse never costs an upload. A file already in the batch (same name and
 * size) is refused too: a second copy would publish its sources twice.
 */
export function sortOffered(
  files: readonly File[],
  formats: readonly string[],
  batch: readonly IntakeFile[] = [],
): { accepted: IncomingFile[]; refused: string[] } {
  const accepted: IncomingFile[] = [];
  const refused: string[] = [];
  const seen = new Set(batch.map((f) => `${f.name}\u0000${f.size}`));
  for (const file of files) {
    const verdict = validateFile({ name: file.name, size: file.size }, formats);
    if (!verdict.ok) {
      refused.push(`${file.name}: ${verdict.reason}`);
      continue;
    }
    const key = `${file.name}\u0000${file.size}`;
    if (seen.has(key)) {
      refused.push(`${file.name}: already in this batch.`);
      continue;
    }
    seen.add(key);
    accepted.push({
      name: file.name,
      size: file.size,
      mimeType: file.type || "application/octet-stream",
      data: file,
    });
  }
  return { accepted, refused };
}

export function createIntakeStore({
  driveId,
  api: initialApi,
  deps,
}: {
  driveId: string;
  api: VaultApi;
  deps: IntakeDeps;
}) {
  let api = initialApi;
  let state: IntakeSnapshot = {
    files: [],
    requested: false,
    openId: null,
    publishing: false,
    notice: null,
    refused: [],
  };
  const listeners = new Set<() => void>();
  /** Bytes ready to convert and to attach as the original. */
  const bytes = new Map<string, Uint8Array>();
  /** Files whose bytes have not been read yet (or failed to read, for a retry). */
  const blobs = new Map<string, Blob>();
  const reading = new Set<string>();
  /** The file being converted; single-flight by this, never by a render. */
  let converting: string | null = null;
  /** The converter said it is busy; nothing is sent before this time. */
  let busyUntil = 0;
  let busyTimer: ReturnType<typeof setTimeout> | null = null;
  let release: (() => void) | null = null;

  const has = (id: string) => state.files.some((f) => f.id === id);

  /** When nothing is open for review, the first file that becomes ready opens itself. */
  function settleOpen(next: IntakeSnapshot): IntakeSnapshot {
    if (next.openId && next.files.some((f) => f.id === next.openId))
      return next;
    const ready = next.files.find(isReviewReady);
    const openId = ready ? ready.id : null;
    return openId === next.openId ? next : { ...next, openId };
  }

  /** Hold the page awake while anything is queued, reading, converting or publishing. */
  function syncKeepAlive() {
    const working =
      converting !== null ||
      reading.size > 0 ||
      state.publishing ||
      state.files.some((f) => f.state === "queued");
    if (working && !release) release = deps.keepAlive();
    else if (!working && release) {
      release();
      release = null;
    }
  }

  function commit(patch: Partial<IntakeSnapshot>) {
    state = settleOpen({ ...state, ...patch });
    syncKeepAlive();
    for (const listener of [...listeners]) listener();
  }

  const updateFiles = (fn: (files: readonly IntakeFile[]) => IntakeFile[]) =>
    commit({ files: fn(state.files) });

  function read(id: string) {
    const blob = blobs.get(id);
    if (!blob || reading.has(id)) return;
    reading.add(id);
    blob.arrayBuffer().then(
      (buffer) => {
        reading.delete(id);
        blobs.delete(id);
        if (has(id)) bytes.set(id, new Uint8Array(buffer));
        syncKeepAlive();
        pump();
      },
      (error: unknown) => {
        reading.delete(id);
        // The blob is kept: Retry reads it again.
        if (!has(id)) return;
        updateFiles((files) =>
          setState(files, id, {
            state: "failed",
            error: `Could not read the file: ${message(error)}`,
            finishedAt: deps.now(),
          }),
        );
      },
    );
  }

  /** Take the next queued file whose bytes are here; start reading the ones that are not. */
  function pump() {
    if (converting !== null) return;
    if (deps.now() < busyUntil) return;
    const lost: string[] = [];
    let next: { file: IntakeFile; data: Uint8Array } | null = null;
    for (const file of state.files) {
      if (file.state !== "queued") continue;
      const data = bytes.get(file.id);
      if (data) {
        next = { file, data };
        break;
      }
      if (blobs.has(file.id)) read(file.id);
      else lost.push(file.id);
    }
    if (lost.length > 0) {
      updateFiles((files) =>
        lost.reduce<IntakeFile[]>(
          (acc, id) =>
            setState(acc, id, {
              state: "failed",
              error:
                "The file's contents are no longer here — remove it and add it again.",
            }),
          [...files],
        ),
      );
    }
    if (next) start(next.file, next.data);
  }

  function start(file: IntakeFile, data: Uint8Array) {
    const id = file.id;
    const callApi = api;
    const job = deps.jobId();
    converting = id;
    updateFiles((files) =>
      setState(files, id, {
        state: "converting",
        startedAt: deps.now(),
        progress: undefined,
        error: undefined,
      }),
    );

    // Watch the conversion: the service counts pages as they finish, so the
    // row can show "page 12 of 23" — measured, never estimated.
    const poll = setInterval(() => {
      if (deps.isHidden()) return;
      deps
        .progress(job, callApi)
        .then((progress) => {
          if (!progress) return;
          if (!state.files.some((f) => f.id === id && f.state === "converting"))
            return;
          updateFiles((files) => setState(files, id, { progress }));
        })
        .catch(() => {});
    }, PROGRESS_POLL_MS);

    // Figures: pictures and display formulas as images, to become inline attachments of the sources.
    deps
      .convert(
        {
          name: file.name,
          bytes: data,
          ocr: file.forceOcr === true,
          job,
          figures: true,
        },
        callApi,
      )
      .then(
        (converted) =>
          updateFiles((files) =>
            setState(files, id, {
              state: "converted",
              converted,
              finishedAt: deps.now(),
            }),
          ),
        (error: unknown) => {
          // The service converts one file at a time and says so: not a failure
          // of this file. Another tab or an agent is using it; wait, then ask again.
          if (
            error instanceof VaultApiFailure &&
            error.code === "CONVERT_BUSY"
          ) {
            busyUntil = deps.now() + BUSY_RETRY_MS;
            if (busyTimer) clearTimeout(busyTimer);
            busyTimer = setTimeout(() => {
              busyTimer = null;
              pump();
            }, BUSY_RETRY_MS);
            updateFiles((files) =>
              setState(files, id, {
                state: "queued",
                error: BUSY_MESSAGE,
                startedAt: undefined,
              }),
            );
            return;
          }
          updateFiles((files) =>
            setState(files, id, {
              state: "failed",
              error: message(error),
              finishedAt: deps.now(),
            }),
          );
        },
      )
      .finally(() => {
        clearInterval(poll);
        converting = null;
        syncKeepAlive();
        pump();
      });
  }

  function forget(id: string) {
    bytes.delete(id);
    blobs.delete(id);
  }

  return {
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: (): IntakeSnapshot => state,
    /** The api every later call uses; re-bound on mount, so a fresh sign-in reaches a running batch. */
    bindApi: (next: VaultApi) => {
      api = next;
    },

    /** Files join the batch at once; their bytes are read in the background. */
    add: (
      incoming: readonly IncomingFile[],
      refused: readonly string[] = [],
    ) => {
      const before = state.files.length;
      const files = addFiles(
        state.files,
        incoming.map(({ name, size, mimeType }) => ({ name, size, mimeType })),
      );
      // `addFiles` mints the ids; pair each new id with its bytes, in order.
      files.slice(before).forEach((file, index) => {
        const data = incoming[index].data;
        if (data instanceof Uint8Array) bytes.set(file.id, data);
        else blobs.set(file.id, data);
      });
      commit({ files, requested: true, notice: null, refused: [...refused] });
      pump();
    },
    open: () => commit({ requested: true }),
    close: () => commit({ requested: false }),
    setOpenId: (openId: string | null) => commit({ openId }),

    /** The user accepts the OCR cost the service would not spend unasked. */
    runOcr: (id: string) => {
      updateFiles((files) =>
        setState(files, id, {
          state: "queued",
          forceOcr: true,
          converted: undefined,
          error: undefined,
        }),
      );
      pump();
    },
    retry: (id: string) => {
      updateFiles((files) =>
        setState(files, id, { state: "queued", error: undefined }),
      );
      pump();
    },
    remove: (id: string) => {
      forget(id);
      updateFiles((files) => removeFile(files, id));
    },
    toggle: (id: string, index: number) =>
      updateFiles((files) => toggleSection(files, id, index)),
    all: (id: string, on: boolean) =>
      updateFiles((files) => setAllSections(files, id, on)),
    type: (id: string, sourceType: string) =>
      updateFiles((files) => setState(files, id, { sourceType })),
    folderName: (id: string, folderName: string) =>
      updateFiles((files) => setState(files, id, { folderName })),

    publish: async (
      id: string,
      attachments?: AttachmentPort,
    ): Promise<void> => {
      const file = state.files.find((f) => f.id === id);
      const data = bytes.get(id);
      // A published row stays visible for its message but never publishes twice:
      // `POST sources` is not idempotent on content.
      if (!file || !data || !driveId || file.publishedIds || state.publishing)
        return;

      commit({ publishing: true });
      try {
        const result = await deps.publish(file, data, {
          api,
          attachments,
          driveId,
        });
        updateFiles((files) =>
          setState(markPublished(files, id, result.sourceIds), id, {
            attachError: result.attached ? undefined : result.attachError,
          }),
        );
        if (!result.attached && result.attachError) {
          // Loud on purpose: a source without its original is a degraded state,
          // and the notice below disappears with the batch.
          console.error("[intake] original not attached:", result.attachError, {
            file: file.name,
            sourceIds: result.sourceIds,
          });
        }
        const n = result.sourceIds.length;
        commit({
          notice: {
            kind: result.attachError ? "error" : "ok",
            text:
              `${n} source${n === 1 ? "" : "s"} added to /sources/${file.folderName}/, queued for extraction` +
              (result.skipped > 0
                ? ` · ${result.skipped} empty part${result.skipped === 1 ? "" : "s"} skipped`
                : "") +
              (result.attached
                ? " · original attached"
                : result.attachError
                  ? ` · the original could not be attached: ${result.attachError}`
                  : ""),
          },
        });
      } catch (error) {
        if (error instanceof PublishPartialFailure) {
          // What landed is recorded on the row so a retry cannot duplicate it.
          updateFiles((files) =>
            markPublished(files, id, error.partial.sourceIds),
          );
          commit({
            notice: {
              kind: "error",
              text: `${error.partial.sourceIds.length} of ${file.selected.filter(Boolean).length} sources were created before it failed — ${error.message}`,
            },
          });
        } else {
          commit({
            notice: {
              kind: "error",
              text: `Could not add the sources: ${message(error)}`,
            },
          });
        }
      } finally {
        commit({ publishing: false });
      }
    },

    /** Retry only the attach step for a published row whose original did not land. */
    retryAttach: async (
      id: string,
      attachments?: AttachmentPort,
    ): Promise<void> => {
      const file = state.files.find((f) => f.id === id);
      const data = bytes.get(id);
      if (
        !file ||
        !data ||
        !driveId ||
        !attachments ||
        !file.publishedIds?.length
      )
        return;
      updateFiles((files) =>
        setState(files, id, { attachError: "attaching…" }),
      );
      const result = await deps.attach(file, data, file.publishedIds, {
        api,
        attachments,
        driveId,
      });
      updateFiles((files) =>
        setState(files, id, {
          attachError: result.attached ? undefined : result.attachError,
        }),
      );
      if (!result.attached)
        console.error(
          "[intake] original still not attached:",
          result.attachError,
        );
    },

    /**
     * "Cancel": drop every file that is not in the vault. With nothing published
     * the panel closes; with some published, what remains is complete and the
     * panel shows the summary with Finish. A conversion in flight is abandoned —
     * its result lands on an id that no longer exists and is ignored.
     */
    cancel: () => {
      for (const f of state.files)
        if (f.publishedIds === undefined) forget(f.id);
      const kept = discardUnpublished(state.files);
      commit({
        files: kept,
        requested: kept.length === 0 ? false : state.requested,
        openId: null,
        notice: null,
        refused: [],
      });
    },

    /** "Finish": the batch is over, the panel closes, the sources are already in the vault. */
    reset: () => {
      bytes.clear();
      blobs.clear();
      commit({
        files: [],
        requested: false,
        openId: null,
        notice: null,
        refused: [],
      });
    },
  };
}

// --- the page's stores ---------------------------------------------------------

/**
 * The api a batch keeps using after its view is gone. A desktop host declares
 * one origin at a time — leaving a remote vault re-declares the local engine —
 * so the origin and the bearer are pinned to the host that was declared when
 * the batch's view last mounted, rather than read at call time.
 */
export function pinnedVaultApi(): VaultApi {
  const host = getHostConfig();
  if (host?.kind !== "desktop") return createVaultApi();
  const bearer = host.bearer;
  return createVaultApi({
    origin: host.switchboardOrigin,
    tokenProvider: async () => {
      if (!bearer) return undefined;
      try {
        return await bearer();
      } catch {
        return undefined;
      }
    },
  });
}

let lockCount = 0;

/**
 * A held Web Lock keeps Chromium (Chrome, Edge, WebView2) from freezing or
 * discarding a background tab — the workaround Tauri names for Linux and
 * Windows, where its own background-throttling switch does nothing. Released
 * the moment the batch has nothing left to do. Absent API: a no-op.
 */
export function holdWebLock(): () => void {
  const locks: LockManager | undefined =
    typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks) return () => {};
  let releaseLock: (() => void) | null = null;
  let done = false;
  const name = `knowledge-vault-intake-${Date.now().toString(36)}-${++lockCount}`;
  locks
    .request(
      name,
      () =>
        new Promise<void>((resolve) => {
          if (done) resolve();
          else releaseLock = resolve;
        }),
    )
    .catch(() => {});
  return () => {
    done = true;
    releaseLock?.();
  };
}

const browserDeps: IntakeDeps = {
  convert: (input, api) => convertFile(input, { api }),
  progress: (job, api) => conversionProgress(job, { api }),
  publish: (file, data, deps) => publishFile(file, data, deps),
  attach: (file, data, sourceIds, deps) =>
    attachOriginal(file, data, sourceIds, deps),
  now: () => Date.now(),
  jobId: () => crypto.randomUUID(),
  isHidden: () =>
    typeof document !== "undefined" && document.visibilityState === "hidden",
  keepAlive: holdWebLock,
};

const stores = new Map<string, IntakeStore>();

/** The batch for a drive, created on first use and kept for the life of the page. */
export function intakeStoreFor(driveId: string): IntakeStore {
  let store = stores.get(driveId);
  if (!store) {
    store = createIntakeStore({
      driveId,
      api: pinnedVaultApi(),
      deps: browserDeps,
    });
    stores.set(driveId, store);
  }
  return store;
}
