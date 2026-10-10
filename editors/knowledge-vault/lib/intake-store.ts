import { getHostConfig } from "../../shared/host-config.js";
import {
  addFiles,
  discardUnpublished,
  extensionOf,
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
  DEFAULT_MAX_UPLOAD_BYTES,
} from "./intake-model.js";
import {
  attachOriginal,
  cancelConversion,
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
 * How many files convert at once is the service's to say. Its health reports
 * two lanes (`slots`): conversions that need the AI models (PDFs, images) and
 * everything else, each with its own number of slots, and which extensions go
 * to the models lane (`modelExtensions`). The batch fills each lane up to its
 * slots — so a twelve-second Word file is not stuck behind a five-minute book
 * — taking files in drop order within a lane, never by size. Sending more than
 * a lane holds would only reorder work inside the engine while making the
 * per-file progress a lie; the service answers the extra caller `CONVERT_BUSY`.
 * A service that reports no lanes runs ONE conversion in total, and so does
 * the batch until `configure` tells it otherwise. Adding files never waits: a
 * file joins the queue the moment it is chosen or dropped, and its bytes are
 * read in the background.
 *
 * Removing a file, Cancel and Finish stop its conversion for real: the request
 * is aborted and the service is asked to stop the job (`DELETE convert/:job`),
 * which frees its slot for the next file.
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

/** Which of the service's lanes a file converts in. */
export type ConversionLane = "models" | "other";

/** The service's lanes, as its `convert/health` reports them. */
export type LaneConfig = {
  /** Conversions that use the AI models (PDFs, images) that may run at once. */
  models: number;
  /** Conversions of everything else that may run at once, beside the models lane. */
  other: number;
  /** Lower-case extensions, no dot, that go to the models lane; everything else is "other". */
  modelExtensions: readonly string[];
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
    /** Aborted when the batch no longer wants the file; the call then fails with `ABORTED`. */
    signal: AbortSignal,
  ) => Promise<ConvertedFile>;
  progress: (job: string, api: VaultApi) => Promise<ConversionProgress | null>;
  /** Ask the service to stop `job` (`DELETE convert/:job`); the answer is not waited on by the file. */
  cancel: (job: string, api: VaultApi) => Promise<unknown>;
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

/** How long to leave a busy lane alone before asking again. */
export const BUSY_RETRY_MS = 8_000;
/** The service reports its phase and pages; asked once a second while a file converts. */
export const PROGRESS_POLL_MS = 1_000;
/**
 * The longest a stopped conversion keeps its slot while the service hears the
 * cancel. Usually the answer comes first; this only bounds a cancel that hangs.
 */
export const CANCEL_GRACE_MS = 5_000;

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
  maxBytes: number = DEFAULT_MAX_UPLOAD_BYTES,
): { accepted: IncomingFile[]; refused: string[] } {
  const accepted: IncomingFile[] = [];
  const refused: string[] = [];
  const seen = new Set(batch.map((f) => `${f.name}\u0000${f.size}`));
  for (const file of files) {
    const verdict = validateFile({ name: file.name, size: file.size }, formats, maxBytes);
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
  /**
   * Conversions sent and not yet seen to end, by file — the scheduler counts
   * these, never a render. A stopped one stays until the service has heard its
   * cancel (`stop`), so its slot is not handed on while the service still
   * counts it busy.
   */
  const inFlight = new Map<
    string,
    {
      job: string;
      controller: AbortController;
      lane: ConversionLane;
      /** The api it was sent with: its cancel must reach the same vault. */
      api: VaultApi;
    }
  >();
  /** The service's lanes; null until told (`configure`) — then ONE conversion in total. */
  let lanes: {
    models: number;
    other: number;
    modelExtensions: ReadonlySet<string>;
  } | null = null;
  /** A lane's converter said it is busy; nothing is sent to that lane before this time. */
  const busyUntil: Record<ConversionLane, number> = { models: 0, other: 0 };
  const busyTimers: Record<
    ConversionLane,
    ReturnType<typeof setTimeout> | null
  > = { models: null, other: null };
  let release: (() => void) | null = null;

  const has = (id: string) => state.files.some((f) => f.id === id);

  /** Unconfigured, every file is "other": one lane, one slot — the old service's rule. */
  const laneOf = (name: string): ConversionLane =>
    lanes?.modelExtensions.has(extensionOf(name)) ? "models" : "other";

  /** Whether a file of this lane may be sent now. */
  function hasRoom(lane: ConversionLane): boolean {
    if (deps.now() < busyUntil[lane]) return false;
    if (!lanes) return inFlight.size === 0;
    let used = 0;
    for (const flight of inFlight.values()) if (flight.lane === lane) used += 1;
    return used < lanes[lane];
  }

  /** The lane is full on the service's side (another tab, an agent): leave it alone, then ask again. */
  function waitOutBusy(lane: ConversionLane) {
    busyUntil[lane] = deps.now() + BUSY_RETRY_MS;
    const timer = busyTimers[lane];
    if (timer) clearTimeout(timer);
    busyTimers[lane] = setTimeout(() => {
      busyTimers[lane] = null;
      pump();
    }, BUSY_RETRY_MS);
  }

  /** When nothing is open for review, the first file that becomes ready opens itself. */
  function settleOpen(next: IntakeSnapshot): IntakeSnapshot {
    if (next.openId && next.files.some((f) => f.id === next.openId))
      return next;
    const ready = next.files.find(isReviewReady);
    const openId = ready ? ready.id : null;
    return openId === next.openId ? next : { ...next, openId };
  }

  /** Hold the page awake while anything is queued, reading, in flight or publishing. */
  function syncKeepAlive() {
    const working =
      inFlight.size > 0 ||
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

  /**
   * Start every queued file whose bytes are here, as far as its lane has room,
   * in drop order; start reading the bytes of the ones that could go next.
   * One file per pass, each pass re-reading the batch and the lanes, so a
   * listener that adds or removes a file mid-pump cannot start one twice.
   */
  function pump() {
    const lost: string[] = [];
    for (;;) {
      let next: {
        file: IntakeFile;
        data: Uint8Array;
        lane: ConversionLane;
      } | null = null;
      for (const file of state.files) {
        if (file.state !== "queued" || inFlight.has(file.id)) continue;
        const data = bytes.get(file.id);
        if (!data && !blobs.has(file.id)) {
          if (!lost.includes(file.id)) lost.push(file.id);
          continue;
        }
        const lane = laneOf(file.name);
        if (!hasRoom(lane)) continue;
        if (data) {
          next = { file, data, lane };
          break;
        }
        read(file.id);
      }
      if (!next) break;
      start(next.file, next.data, next.lane);
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
  }

  function start(file: IntakeFile, data: Uint8Array, lane: ConversionLane) {
    const id = file.id;
    const callApi = api;
    const job = deps.jobId();
    const controller = new AbortController();
    const flight = { job, controller, lane, api: callApi };
    inFlight.set(id, flight);
    updateFiles((files) =>
      setState(files, id, {
        state: "converting",
        startedAt: deps.now(),
        progress: undefined,
        error: undefined,
      }),
    );

    /** This conversion is still the one its row waits on: not stopped, not replaced. */
    const current = () =>
      inFlight.get(id) === flight && !controller.signal.aborted;

    // Watch the conversion: the service reports its phase and the document's
    // pages — pages finished, when it counts them — so the row shows what is
    // happening, never an estimate.
    const poll = setInterval(() => {
      if (deps.isHidden()) return;
      deps
        .progress(job, callApi)
        .then((progress) => {
          if (!progress || !current()) return;
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
        controller.signal,
      )
      .then(
        (converted) => {
          // Removed, or the batch cancelled, while it converted: nobody waits for it.
          if (!current()) return;
          updateFiles((files) =>
            setState(files, id, {
              state: "converted",
              converted,
              finishedAt: deps.now(),
            }),
          );
        },
        (error: unknown) => {
          // Stopped on purpose — the file was removed, or the batch cancelled
          // or finished. Its `ABORTED`, or the service's `CONVERT_CANCELLED`,
          // is the stop we asked for: nothing failed, and there is no row left
          // to say so on.
          if (!current() || !has(id)) return;
          // The file's lane is full on the service's side: not a failure of
          // this file. Another tab or an agent is using it; wait, then ask again.
          if (
            error instanceof VaultApiFailure &&
            error.code === "CONVERT_BUSY"
          ) {
            waitOutBusy(lane);
            updateFiles((files) =>
              setState(files, id, {
                state: "queued",
                error: BUSY_MESSAGE,
                startedAt: undefined,
              }),
            );
            return;
          }
          // Anything else fails the file — including a `CONVERT_CANCELLED` this
          // batch did not ask for (the file is still here): Retry sends it again.
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
        // A stopped conversion keeps its slot until the service has heard the
        // cancel; `stop` frees it.
        if (inFlight.get(id) === flight && !controller.signal.aborted)
          inFlight.delete(id);
        syncKeepAlive();
        pump();
      });
  }

  /**
   * Withdraw a file's conversion, if it has one in flight: abort the request,
   * and ask the service to stop the job — fire-and-forget, errors swallowed,
   * since the file is leaving the batch either way. The slot stays booked
   * until the service has answered (at most `CANCEL_GRACE_MS`): handing it to
   * the next file sooner would send that file into a lane the service still
   * counts as busy, and it would wait out `BUSY_RETRY_MS` for nothing.
   */
  function stop(id: string) {
    const flight = inFlight.get(id);
    if (!flight || flight.controller.signal.aborted) return;
    flight.controller.abort();
    const free = () => {
      clearTimeout(grace);
      if (inFlight.get(id) !== flight) return;
      inFlight.delete(id);
      syncKeepAlive();
      pump();
    };
    const grace = setTimeout(free, CANCEL_GRACE_MS);
    void deps.cancel(flight.job, flight.api).then(free, free);
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

    /**
     * The service's lanes, from its `convert/health` (`slots`, `modelExtensions`).
     * Until this is called the batch sends ONE file at a time — right for a
     * service that reports no lanes. A lane is never closed from here: a count
     * below one is read as one, since a file queued for a lane with no slots
     * would wait without a word, while sent it gets the service's own answer.
     */
    configure: (next: LaneConfig) => {
      const slotsOf = (n: number) =>
        Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
      lanes = {
        models: slotsOf(next.models),
        other: slotsOf(next.other),
        modelExtensions: new Set(
          next.modelExtensions.map((ext) => ext.toLowerCase().replace(/^\./, "")),
        ),
      };
      // A conversion that started before the lanes were known was booked as
      // "other"; book it to its real lane, or the models lane would look free.
      for (const [id, flight] of inFlight) {
        const file = state.files.find((f) => f.id === id);
        if (file) flight.lane = laneOf(file.name);
      }
      pump();
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
    /** Drop a file; a conversion in flight is stopped, on the service too. */
    remove: (id: string) => {
      stop(id);
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
     * panel shows the summary with Finish. A conversion in flight is stopped,
     * on the service too; should its result still arrive, it lands on an id
     * that no longer exists and is ignored.
     */
    cancel: () => {
      for (const f of state.files) {
        if (f.publishedIds !== undefined) continue;
        stop(f.id);
        forget(f.id);
      }
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
      for (const id of [...inFlight.keys()]) stop(id);
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
  convert: (input, api, signal) => convertFile(input, { api, signal }),
  progress: (job, api) => conversionProgress(job, { api }),
  cancel: (job, api) => cancelConversion(api, job),
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
