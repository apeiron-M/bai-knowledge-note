import { getHostConfig } from "../../shared/host-config.js";
import {
  addFiles,
  discardUnpublished,
  extensionOf,
  freeFolderName,
  isReviewReady,
  markPublished,
  selectedCount,
  removeFile,
  setAllSections,
  setState,
  toggleSection,
  validateFile,
  type ConversionProgress,
  type ConvertedFile,
  type IntakeFile,
  type KnownOriginal,
  type VaultIndex,
  DEFAULT_MAX_UPLOAD_BYTES,
} from "./intake-model.js";
import {
  attachOriginal,
  cancelConversion,
  continuePublish,
  collectConversion,
  conversionProgress,
  convertFile,
  publishFile,
  PublishPartialFailure,
  type AttachmentPort,
  type PublishResult,
} from "./intake-service.js";
import {
  pageJournal,
  readFolderTitles,
  type JournalEntry,
  type PublishJournal,
} from "./publish-journal.js";
import { originalRefOf } from "./original-ref.js";
import {
  pageBatchJournal,
  type BatchJournal,
  type SavedRow,
} from "./intake-batch-journal.js";
import { continuation } from "./intake-publish.js";
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

export type IntakeSnapshot = {
  files: readonly IntakeFile[];
  /** The user asked for the panel ("Add sources"); it also shows while the batch is non-empty. */
  requested: boolean;
  /** Hidden by the person: the panel folds to one line while the batch carries on. */
  collapsed: boolean;
  /** The file open for review — only ever because the person opened it. */
  openId: string | null;
  publishing: boolean;
  /** The file being added right now; one at a time. */
  publishingId: string | null;
  /** Files the last pick or drop could not take, each with the reason. */
  refused: readonly string[];
  /** Files are checked against what the vault already holds before they are read. */
  checking: boolean;
  /** How far the file being added is: sources in the vault, of how many. */
  progress: { done: number; total: number } | null;
  /** Adds from an earlier visit that the page did not live to finish, carried on here. */
  carrying: readonly CarryOn[];
};

/**
 * An add the page did not live to finish — a reload, the app quitting —
 * carried on the next time the vault opens (publish-journal.ts).
 */
export type CarryOn = {
  id: string;
  fileName: string;
  folderName: string;
  total: number;
  done: number;
  /**
   * `waiting` for its turn, `adding`, `stopped` because the vault refused a
   * source (it waits for the person), or `done`.
   */
  status: "waiting" | "adding" | "stopped" | "done";
  error?: string;
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
    deps: {
      api: VaultApi;
      attachments?: AttachmentPort;
      driveId: string;
      journal?: PublishJournal;
      onProgress?: (done: number, total: number) => void;
      onJournaled?: () => void;
    },
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
  /** The ref a source records as its original (`attachment://v1:<sha-256>`), for these bytes. */
  originalRef: (bytes: Uint8Array) => Promise<string>;
  /** Where an add is written down as it goes, so one cut off carries on (publish-journal.ts). */
  journal?: PublishJournal;
  /** The titles of the sources in a folder, read from the vault: what carrying on checks first. */
  folderTitles?: (driveId: string, folderId: string) => Promise<string[]>;
  /** Where the batch is written down as it changes, so a reloaded page brings it back (intake-batch-journal.ts). */
  batch?: BatchJournal;
  /** The answer to a conversion an earlier load of the page started — the vault keeps it a while (`collectConversion`). */
  collect?: (
    job: string,
    name: string,
    api: VaultApi,
  ) => ReturnType<typeof collectConversion>;
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
/**
 * The longest a dropped file waits for the vault to say what it already holds
 * (the Sources view loads that). Past it, the file is read unchecked rather
 * than held without end.
 */
export const CHECK_WAIT_MS = 15_000;

const BUSY_MESSAGE =
  "The reader is busy with another file, so it will try again shortly.";
/** A file brought back after a reload whose conversion the vault no longer has. */
const AGAIN_MESSAGE =
  "The earlier reading was not kept, so it starts again.";

/** How often a conversion an earlier load started is asked after. */
export const RESUME_POLL_MS = 2_000;
/** The batch is written down this long after it changes: progress ticks and quick toggles land in one write. */
const SAVE_DELAY_MS = 400;

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
      refused.push(`${file.name}: it's already in this batch.`);
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
    collapsed: false,
    openId: null,
    publishing: false,
    publishingId: null,
    refused: [],
    checking: false,
    progress: null,
    carrying: [],
  };
  const listeners = new Set<() => void>();
  /**
   * What the vault already holds, as the Sources view reported it. `none`: no
   * view will say — files are read at once, unchecked, as before. `waiting`:
   * a view will say; files wait for it, at most `CHECK_WAIT_MS` from `since`.
   */
  let vault:
    | { status: "none" }
    | { status: "waiting"; since: number }
    | { status: "ready"; index: VaultIndex } = { status: "none" };
  /** Files whose bytes are being hashed; one at a time. */
  const hashing = new Set<string>();
  let checkTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * What this page has added, by content ref. Outlives Done: the vault's own
   * list catches up a little later, and a file dropped again in that gap is
   * still recognised.
   */
  const addedThisSession = new Map<string, KnownOriginal>();
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
  /**
   * The rows this page has written down (intake-batch-journal.ts), as last
   * written, with the job each was converting under: only these are mirrored —
   * a row is written down with its bytes when it joins, or when it comes back.
   */
  const written = new Map<string, { file: IntakeFile; job?: string }>();
  /** Rows the add has taken over (publish-journal.ts carries them on): no longer brought back. */
  const handedOver = new Set<string>();
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

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

  /**
   * The review stays open only while its file is still waiting for a decision:
   * once the file is added, removed or sent back to be read again, the review
   * closes and the row says what happened. Nothing opens it but the person —
   * it covers the screen, so it never appears unasked.
   */
  function settleOpen(next: IntakeSnapshot): IntakeSnapshot {
    if (!next.openId) return next;
    const open = next.files.find((f) => f.id === next.openId);
    return open && isReviewReady(open) ? next : { ...next, openId: null };
  }

  /** Hold the page awake while anything is queued, reading, in flight or publishing. */
  function syncKeepAlive() {
    const working =
      inFlight.size > 0 ||
      reading.size > 0 ||
      hashing.size > 0 ||
      state.publishing ||
      state.carrying.some((c) => c.status === "waiting" || c.status === "adding") ||
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
    scheduleSave();
  }

  function scheduleSave() {
    if (!deps.batch || saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void saveBatch();
    }, SAVE_DELAY_MS);
  }

  /** The same row as far as the journal is concerned: everything but live progress. */
  function sameRow(a: IntakeFile, b: IntakeFile): boolean {
    for (const key of Object.keys({ ...a, ...b }) as (keyof IntakeFile)[]) {
      if (key !== "progress" && a[key] !== b[key]) return false;
    }
    return true;
  }

  /**
   * Mirror the batch to its journal: each row this page wrote down is written
   * again when it changed (its conversion only when that is new), and a row
   * that left — removed, cancelled, added, handed to the add — is struck out.
   */
  async function saveBatch() {
    const batch = deps.batch;
    if (!batch || !driveId) return;
    const live = new Set<string>();
    for (const file of state.files) {
      if (file.publishedIds !== undefined || handedOver.has(file.id)) continue;
      const before = written.get(file.id);
      if (!before) continue;
      live.add(file.id);
      const job =
        file.state === "converting" ? inFlight.get(file.id)?.job : undefined;
      if (before.job === job && sameRow(before.file, file)) continue;
      written.set(file.id, { file, job });
      const withConversion =
        file.converted !== undefined && file.converted !== before.file.converted;
      await batch.save(driveId, file, job, withConversion).catch(() => {});
    }
    for (const id of [...written.keys()]) {
      if (live.has(id)) continue;
      written.delete(id);
      await batch.remove(id).catch(() => {});
      batch.release(id);
    }
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

  /** Wake the check when the wait for the vault's answer runs out. */
  function scheduleCheckTimeout() {
    if (checkTimer) clearTimeout(checkTimer);
    checkTimer = null;
    if (vault.status !== "waiting") return;
    const wait = Math.max(0, vault.since + CHECK_WAIT_MS - deps.now());
    checkTimer = setTimeout(() => {
      checkTimer = null;
      pump();
    }, wait);
  }

  /**
   * Whether the vault (or this batch) already holds the file — by its content,
   * whatever it is called now. A match is held as `duplicate`, unread, until
   * the person removes it or adds it again; anything else is `clear`, in a
   * folder whose name nothing else in /sources or in this batch is using.
   */
  function decide(
    file: IntakeFile,
    files: readonly IntakeFile[],
    index: VaultIndex | null,
  ): Partial<IntakeFile> {
    const ref = file.originalRef;
    if (ref && !file.addAgain) {
      const inVault = index?.originals.get(ref) ?? addedThisSession.get(ref);
      if (inVault) return { state: "duplicate", known: inVault };
      const position = files.findIndex((f) => f.id === file.id);
      const twin = files.slice(0, position).find((f) => f.originalRef === ref);
      if (twin)
        return {
          state: "duplicate",
          known: {
            folderName: twin.publishedIds ? twin.folderName : null,
            sources: twin.publishedIds?.length ?? 0,
            addedAt: null,
            inBatch: twin.name,
          },
        };
    }
    // Folders are matched by name (`POST sources/folders`): a name already in
    // use would put these sources beside another file's.
    const taken = new Set<string>(index?.folders ?? []);
    for (const f of files) {
      if (f.id === file.id || f.state === "duplicate") continue;
      if (f.check || f.state !== "queued") taken.add(f.folderName);
    }
    const check = index ? "clear" : "skipped";
    if (!taken.has(file.folderName)) return { check };
    return {
      check,
      folderName: freeFolderName(file.folderName, taken),
      renamedFrom: file.folderName,
    };
  }

  /** Hash one file's bytes for the check. The bytes are not kept: they are read again when the file's turn comes. */
  function hash(id: string) {
    const data = bytes.get(id);
    const blob = blobs.get(id);
    const source = data
      ? Promise.resolve(data)
      : blob
        ? blob.arrayBuffer().then((buffer) => new Uint8Array(buffer))
        : null;
    if (!source) return;
    hashing.add(id);
    syncKeepAlive();
    source
      .then((buffer) => deps.originalRef(buffer))
      .then(
        (ref) => {
          if (has(id))
            updateFiles((files) => setState(files, id, { originalRef: ref }));
        },
        () => {
          // A file that cannot be hashed cannot be recognised either; it is
          // read as usual rather than held for that.
          if (has(id))
            updateFiles((files) => setState(files, id, { check: "skipped" }));
        },
      )
      .finally(() => {
        hashing.delete(id);
        syncKeepAlive();
        pump();
      });
  }

  /** Decide every hashed file the vault's answer allows, then hash the next one. */
  function checkFiles() {
    if (vault.status === "none") return;
    const index = vault.status === "ready" ? vault.index : null;
    const timedOut =
      vault.status === "waiting" && deps.now() - vault.since >= CHECK_WAIT_MS;
    if (index || timedOut) {
      let files = state.files;
      for (const file of state.files) {
        if (file.state !== "queued" || file.check || !file.originalRef) continue;
        // Decided in order, each seeing the folders the ones before it took.
        files = setState(files, file.id, decide(file, files, index));
      }
      if (files !== state.files) commit({ files });
    }
    if (hashing.size > 0) return;
    const next = state.files.find(
      (f) => f.state === "queued" && !f.check && !f.originalRef,
    );
    if (next) hash(next.id);
  }

  /**
   * Start every queued file whose bytes are here, as far as its lane has room,
   * in drop order; start reading the bytes of the ones that could go next.
   * One file per pass, each pass re-reading the batch and the lanes, so a
   * listener that adds or removes a file mid-pump cannot start one twice.
   */
  function pump() {
    checkFiles();
    const lost: string[] = [];
    for (;;) {
      let next: {
        file: IntakeFile;
        data: Uint8Array;
        lane: ConversionLane;
      } | null = null;
      for (const file of state.files) {
        if (file.state !== "queued" || inFlight.has(file.id)) continue;
        // Not read before the vault has said whether it already holds it.
        if (vault.status !== "none" && !file.check) continue;
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
          onConverted(id, converted);
        },
        (error: unknown) => {
          // Stopped on purpose — the file was removed, or the batch cancelled
          // or finished. Its `ABORTED`, or the service's `CONVERT_CANCELLED`,
          // is the stop we asked for: nothing failed, and there is no row left
          // to say so on.
          if (!current() || !has(id)) return;
          onConvertFailed(id, lane, error);
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

  /** A conversion's answer reached its row. */
  function onConverted(id: string, converted: ConvertedFile) {
    updateFiles((files) => {
      const next = setState(files, id, {
        state: "converted",
        converted,
        finishedAt: deps.now(),
      });
      // Its folder may already hold some of these sections — an earlier
      // add cut short: those start left out and the rest goes beside them.
      const read = next.find((f) => f.id === id);
      const index = vault.status === "ready" ? vault.index : null;
      const going = read ? continuation(read, index?.titles) : null;
      return going ? setState(next, id, going) : next;
    });
  }

  function onConvertFailed(id: string, lane: ConversionLane, error: unknown) {
    // The file's lane is full on the service's side: not a failure of this
    // file. Another tab or an agent is using it; wait, then ask again.
    if (error instanceof VaultApiFailure && error.code === "CONVERT_BUSY") {
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
  }

  /**
   * A file an earlier load of this page was converting when it went away: the
   * service carried on, and the vault keeps its answer a while. Its row shows
   * the service's progress until the answer is in, then goes on as if this
   * page had sent it. With no answer kept (the engine restarted, or too long
   * ago), it is read again from the bytes kept with the row. Its slot stays
   * booked meanwhile — the service is still busy with it — and removing it
   * stops the job on the service too (`stop`).
   */
  function resume(file: IntakeFile, job: string) {
    const id = file.id;
    const callApi = api;
    const controller = new AbortController();
    const flight = { job, controller, lane: laneOf(file.name), api: callApi };
    inFlight.set(id, flight);
    const current = () =>
      inFlight.get(id) === flight && !controller.signal.aborted;
    const settle = () => {
      if (current()) inFlight.delete(id);
      syncKeepAlive();
      pump();
    };
    let timer: ReturnType<typeof setTimeout> | null = null;
    const again = () => {
      if (current()) timer = setTimeout(() => void tick(), RESUME_POLL_MS);
    };
    const tick = async () => {
      if (!current()) return;
      let answer: Awaited<ReturnType<NonNullable<IntakeDeps["collect"]>>>;
      try {
        answer = deps.collect ? await deps.collect(job, file.name, callApi) : null;
      } catch {
        // The vault did not answer this time: ask again shortly.
        again();
        return;
      }
      if (!current()) return;
      if (answer?.kind === "running") {
        if (!deps.isHidden()) {
          const progress = await deps.progress(job, callApi).catch(() => null);
          if (progress && current())
            updateFiles((files) => setState(files, id, { progress }));
        }
        again();
        return;
      }
      if (answer === null) {
        updateFiles((files) =>
          setState(files, id, {
            state: "queued",
            error: AGAIN_MESSAGE,
            startedAt: undefined,
            progress: undefined,
          }),
        );
      } else if (answer.kind === "done") {
        onConverted(id, answer.converted);
      } else {
        onConvertFailed(id, flight.lane, answer.error);
      }
      settle();
    };
    controller.signal.addEventListener("abort", () => {
      if (timer) clearTimeout(timer);
    });
    timer = setTimeout(() => void tick(), 0);
    syncKeepAlive();
  }

  /**
   * The batch an earlier load of this page left (intake-batch-journal.ts):
   * read once, when the page first reaches the vault. Each file comes back as
   * it was — still converting (its answer is collected, `resume`), converted
   * and waiting for review with its selection, queued, failed — with the bytes
   * it needs to be read again or added. A file another page of this vault
   * holds stays with that page; one whose bytes are gone cannot come back.
   */
  let batchRead = false;
  async function restoreBatch() {
    const batch = deps.batch;
    if (batchRead || !batch || !driveId) return;
    batchRead = true;
    let rows: SavedRow[];
    try {
      rows = await batch.rows(driveId);
    } catch {
      return;
    }
    const back: { file: IntakeFile; job?: string }[] = [];
    for (const row of rows) {
      if (has(row.id) || written.has(row.id)) continue;
      if (!(await batch.claim(row.id))) continue;
      const blob = await batch.bytes(row.id).catch(() => null);
      if (!blob) {
        await batch.remove(row.id).catch(() => {});
        batch.release(row.id);
        continue;
      }
      let file: IntakeFile = { ...row.file };
      let job: string | undefined;
      if (file.state === "converted") {
        const converted = await batch.conversion(row.id).catch(() => null);
        file = converted
          ? { ...file, converted }
          : { ...file, state: "queued", error: AGAIN_MESSAGE };
      } else if (file.state === "converting") {
        if (row.job) job = row.job;
        else file = { ...file, state: "queued", startedAt: undefined, error: AGAIN_MESSAGE };
      }
      blobs.set(file.id, blob);
      back.push({ file, job });
    }
    if (back.length === 0) return;
    for (const { file, job } of back) written.set(file.id, { file, job });
    commit({
      files: [...back.map((b) => b.file), ...state.files],
      requested: true,
      collapsed: false,
    });
    for (const { file, job } of back) if (job) resume(file, job);
    pump();
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

  /**
   * Add one file's kept sections to the vault. A failure stays on the file's
   * row (`publishError`), where the person adds it again; what partly landed is
   * recorded so a second try cannot write it twice.
   */
  async function publishOne(
    id: string,
    attachments?: AttachmentPort,
  ): Promise<boolean> {
    const file = state.files.find((f) => f.id === id);
    let data = bytes.get(id);
    const kept = blobs.get(id);
    // A published row stays visible for its message but never publishes twice:
    // `POST sources` is not idempotent on content.
    if (!file || (!data && !kept) || !driveId || file.publishedIds || state.publishing)
      return false;

    commit({ publishing: true, publishingId: id, progress: null });
    try {
      // A row brought back after a reload has its bytes as the blob kept with it.
      if (!data && kept) {
        data = new Uint8Array(await kept.arrayBuffer());
        bytes.set(id, data);
        blobs.delete(id);
      }
      if (!data) throw new Error("The file's contents are no longer here — remove it and add it again.");
      const result = await deps.publish(file, data, {
        api,
        attachments,
        driveId,
        journal: deps.journal,
        onProgress: reportProgress,
        // From here the add's own journal carries it on: the batch lets it go.
        onJournaled: () => {
          handedOver.add(id);
          void saveBatch();
        },
      });
      updateFiles((files) =>
        setState(markPublished(files, id, result.sourceIds), id, {
          attachError: result.attached ? undefined : result.attachError,
          publishError: undefined,
        }),
      );
      if (file.originalRef)
        addedThisSession.set(file.originalRef, {
          folderName: file.folderName,
          sources: result.sourceIds.length,
          addedAt: new Date(deps.now()).toISOString(),
        });
      if (!result.attached && result.attachError) {
        // Loud on purpose: a source without its original is a degraded state.
        console.error("[intake] original not attached:", result.attachError, {
          file: file.name,
          sourceIds: result.sourceIds,
        });
      }
      return true;
    } catch (error) {
      if (error instanceof PublishPartialFailure) {
        // What landed is recorded on the row so a retry cannot duplicate it.
        const kept = file.selected.filter(Boolean).length;
        updateFiles((files) =>
          setState(markPublished(files, id, error.partial.sourceIds), id, {
            publishError: `Only ${error.partial.sourceIds.length} of ${kept} sections were added before it stopped: ${error.message}`,
          }),
        );
      } else {
        updateFiles((files) =>
          setState(files, id, { publishError: message(error) }),
        );
      }
      return false;
    } finally {
      commit({ publishing: false, publishingId: null, progress: null });
    }
  }

  /** Progress, at most a few times a second: a 900-section add would otherwise redraw the panel 900 times. */
  let lastProgress = 0;
  function reportProgress(done: number, total: number) {
    const at = deps.now();
    if (done < total && at - lastProgress < 200) return;
    lastProgress = at;
    commit({ progress: { done, total } });
  }

  const carryView = (entry: JournalEntry): CarryOn => ({
    id: entry.id,
    fileName: entry.fileName,
    folderName: entry.folderName,
    total: entry.total,
    done: entry.done,
    status: entry.error ? "stopped" : "waiting",
    ...(entry.error ? { error: entry.error } : {}),
  });
  function updateCarry(id: string, patch: Partial<CarryOn>) {
    commit({ carrying: state.carrying.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  }

  /**
   * Adds this vault started in an earlier visit and did not finish: read once,
   * when the page first reaches the vault, and carried on one at a time — each
   * in its turn with this page's own adds, never beside them. One the vault
   * refused waits for the person (`carryOn`).
   */
  let carryRead = false;
  async function readCarried() {
    if (carryRead || !deps.journal || !driveId) return;
    carryRead = true;
    let entries: JournalEntry[];
    try {
      entries = await deps.journal.entries(driveId);
    } catch {
      return;
    }
    if (entries.length === 0) return;
    commit({ carrying: entries.map(carryView) });
    for (const entry of entries) {
      if (!entry.error) await runCarried(entry.id);
    }
  }

  async function runCarried(id: string) {
    const journal = deps.journal;
    const folderTitles = deps.folderTitles;
    if (!journal || !folderTitles) return;
    // Its turn comes after any add already under way.
    while (state.publishing) await new Promise((resolve) => setTimeout(resolve, 500));
    const entry = (await journal.entries(driveId).catch(() => [] as JournalEntry[])).find((e) => e.id === id);
    if (!entry) {
      commit({ carrying: state.carrying.filter((c) => c.id !== id) });
      return;
    }
    // Marked as the add under way, so every row's Add waits its turn rather than doing nothing.
    commit({ publishing: true, publishingId: `carry:${id}` });
    updateCarry(id, { status: "adding", error: undefined, done: entry.done });
    try {
      const result = await continuePublish(entry, {
        api,
        journal,
        folderTitles,
        onProgress: (done) => {
          const at = deps.now();
          if (done < entry.total && at - lastProgress < 200) return;
          lastProgress = at;
          updateCarry(id, { done });
        },
      });
      if (result === null) {
        // Another window of this vault is carrying it on.
        commit({ carrying: state.carrying.filter((c) => c.id !== id) });
      } else {
        updateCarry(id, { status: "done", done: entry.total });
      }
    } catch (error) {
      updateCarry(id, { status: "stopped", error: message(error) });
    } finally {
      commit({ publishing: false, publishingId: null });
    }
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
      // The first time the page reaches the vault: bring back the batch an
      // earlier load left, and carry on the adds it left unfinished.
      void restoreBatch();
      void readCarried();
    },
    /** Try a stopped add again, from where it stopped. */
    carryOn: (id: string) => {
      const view = state.carrying.find((c) => c.id === id);
      if (!view || view.status === "adding" || view.status === "waiting") return;
      updateCarry(id, { status: "waiting" });
      void runCarried(id);
    },
    /** Forget an add left unfinished — or clear one that is done — from the panel and the journal. */
    forgetCarried: (id: string) => {
      const view = state.carrying.find((c) => c.id === id);
      if (!view || view.status === "adding") return;
      commit({ carrying: state.carrying.filter((c) => c.id !== id) });
      if (view.status !== "done") void deps.journal?.finish(id).catch(() => {});
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
        // Written down with its bytes, so a reloaded page brings it back.
        const batch = deps.batch;
        if (batch && driveId) {
          written.set(file.id, { file });
          void batch.claim(file.id);
          void batch
            .add(driveId, file, data instanceof Uint8Array ? new Blob([data.slice()]) : data)
            .catch(() => {
              written.delete(file.id);
            });
        }
      });
      // New files get the full wait for the vault's answer.
      if (vault.status === "waiting") {
        vault = { status: "waiting", since: deps.now() };
        scheduleCheckTimeout();
      }
      // New files are worth seeing: a hidden panel opens again.
      commit({ files, requested: true, collapsed: false, refused: [...refused] });
      pump();
    },

    /**
     * A view will say what the vault holds (`setVault`): from now on files
     * wait for that answer — at most `CHECK_WAIT_MS` — before they are read.
     */
    expectVault: () => {
      if (vault.status !== "none") return;
      vault = { status: "waiting", since: deps.now() };
      scheduleCheckTimeout();
      commit({ checking: true });
    },

    /**
     * What the vault holds now, from the Sources view; null while it is still
     * loading. A later answer replaces an earlier one; an index once known is
     * kept while a fresh one loads.
     */
    setVault: (index: VaultIndex | null) => {
      if (index) {
        vault = { status: "ready", index };
        scheduleCheckTimeout();
      } else if (vault.status === "none") {
        vault = { status: "waiting", since: deps.now() };
        scheduleCheckTimeout();
      }
      commit({ checking: true });
      pump();
    },

    /** Read and add a file the vault already holds — a second copy, in a folder of its own. */
    addAgain: (id: string) => {
      updateFiles((files) =>
        setState(files, id, {
          state: "queued",
          addAgain: true,
          check: undefined,
        }),
      );
      pump();
    },
    open: () => commit({ requested: true, collapsed: false }),
    close: () => commit({ requested: false }),
    /** "Hide": fold the panel to one line; the batch carries on. */
    collapse: () => commit({ collapsed: true }),
    expand: () => commit({ collapsed: false }),
    /** The person has read why some files were not taken. */
    dismissRefused: () => commit({ refused: [] }),
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
        setState(files, id, {
          state: "queued",
          error: undefined,
          publishError: undefined,
        }),
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

    publish: (id: string, attachments?: AttachmentPort) =>
      publishOne(id, attachments),

    /**
     * "Add N ready files": every file waiting for a decision, as it is, in the
     * order they were added — one at a time, as `publish` always is. A file
     * with nothing kept is left for the person; one that fails says so on its
     * row and the rest still go.
     */
    publishAll: async (attachments?: AttachmentPort): Promise<void> => {
      const ids = state.files
        .filter((f) => isReviewReady(f) && selectedCount(f) > 0)
        .map((f) => f.id);
      for (const id of ids) {
        const file = state.files.find((f) => f.id === id);
        // Removed, or added from its review, while an earlier one was adding.
        if (!file || !isReviewReady(file)) continue;
        await publishOne(id, attachments);
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
        collapsed: false,
        openId: null,
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
        collapsed: false,
        openId: null,
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
  originalRef: originalRefOf,
  journal: pageJournal(),
  folderTitles: readFolderTitles,
  batch: pageBatchJournal(),
  collect: (job, name, api) => collectConversion(job, name, { api }),
};

const stores = new Map<string, IntakeStore>();

/** The batch for a drive, created on first use and kept for the life of the page. */
export function intakeStoreFor(driveId: string): IntakeStore {
  let store = stores.get(driveId);
  if (!store) {
    const created = createIntakeStore({
      driveId,
      api: pinnedVaultApi(),
      deps: browserDeps,
    });
    created.subscribe(() => reportAdding(driveId, isAdding(created.getSnapshot())));
    stores.set(driveId, created);
    store = created;
  }
  return store;
}

/**
 * Sources are being added right now: this visit's add, or one carried on from
 * an earlier visit. What quitting would cut short — the rest carries on the
 * next time the vault opens, but not while the app is closed.
 */
export function isAdding(snapshot: IntakeSnapshot): boolean {
  return (
    snapshot.publishing ||
    snapshot.carrying.some((c) => c.status === "adding" || c.status === "waiting")
  );
}

/** The drives of this page with sources being added. */
const addingIn = new Set<string>();
let stopAskingToLeave: (() => void) | null = null;

/**
 * Tell whoever would end the page that an add is under way, once it starts
 * and once the last one ends — from here rather than a view, because an add
 * runs on after the person leaves the vault. The desktop app asks before it
 * quits (host-config `setBusy`); a browser asks before the page is left.
 */
function reportAdding(driveId: string, adding: boolean) {
  const before = addingIn.size > 0;
  if (adding) addingIn.add(driveId);
  else addingIn.delete(driveId);
  const now = addingIn.size > 0;
  if (before === now) return;
  const host = getHostConfig();
  if (host?.setBusy) {
    host.setBusy(now ? "Sources are still being added." : null);
    return;
  }
  if (typeof window === "undefined") return;
  if (now) {
    const ask = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers ask only when this is set.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", ask);
    stopAskingToLeave = () => window.removeEventListener("beforeunload", ask);
  } else {
    stopAskingToLeave?.();
    stopAskingToLeave = null;
  }
}
