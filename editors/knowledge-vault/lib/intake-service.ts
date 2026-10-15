import {
  addAttachmentInput,
  bytesFromBase64,
  countOccurrences,
  FORMULA_PLACEHOLDER,
  PICTURE_PLACEHOLDER,
  rewriteWithAttachments,
} from "./intake-attachments.js";
import type {
  ConversionFigure,
  ConversionProgress,
  ConversionQuality,
  ConvertedFile,
  Section,
  SectionPlanSummary,
} from "./intake-model.js";
import { VaultApiFailure, type VaultApi } from "./vault-api.js";

/**
 * The conversion half of the flow: one file in, its sections out.
 *
 * `POST convert` takes the document as its body and the name in the query, and
 * it *creates nothing* — which is what makes the review step possible. The
 * route refuses to answer with anything but `{ sections, ... }`, so a body
 * without them is a misconfigured URL rather than a document with no sections.
 */

/** A section as the route sends it; `mergedFrom`/`markdownRange` are absent on an older route. */
type RouteSection = Omit<Section, "content" | "mergedFrom" | "markdownRange"> &
  Partial<Pick<Section, "mergedFrom" | "markdownRange">>;

type ConvertSummary = {
  filename?: string;
  format?: string;
  sections?: RouteSection[];
  plan?: Partial<SectionPlanSummary>;
  markdown?: string;
  ocr?: "tesseract" | "docling" | null;
  textSource?: "docling" | "pdfjs" | "tesseract" | "docling-ocr" | "text";
  needsOcr?: {
    via: "tesseract" | "docling-ocr";
    estimateSeconds: number;
  } | null;
  pages?: number | null;
  quality?: ConversionQuality | null;
  ocrOffer?: ConvertedFile["ocrOffer"];
  figures?: ConvertedFile["figures"];
  figureStats?: ConvertedFile["figureStats"];
};

/**
 * `&markdown=1` is asked for on purpose, even though it doubles the response
 * for a book: the markdown is where tables are rendered correctly, and each
 * section's `markdownRange` is the slice that becomes its `content`. The whole
 * markdown is dropped once the sections have their slices — only the slices
 * are kept, so a 400 000-character book does not sit in memory twice.
 *
 * `signal` withdraws the request — the upload and the wait — and the call then
 * fails with `ABORTED`. It does not stop the service: the vault cannot follow
 * its caller hanging up, so the job is stopped with `cancelConversion`.
 */
export async function convertFile(
  input: {
    name: string;
    bytes: Uint8Array;
    ocr?: boolean;
    job?: string;
    figures?: boolean;
  },
  deps: { api: VaultApi; signal?: AbortSignal },
): Promise<ConvertedFile> {
  const path =
    `/convert?filename=${encodeURIComponent(input.name)}&markdown=1` +
    `${input.ocr ? "&ocr=1" : ""}${input.job ? `&job=${encodeURIComponent(input.job)}` : ""}` +
    `${input.figures ? "&figures=1" : ""}`;
  const body = await deps.api.postRaw<ConvertSummary>(path, input.bytes, {
    contentType: "application/octet-stream",
    ...(deps.signal ? { signal: deps.signal } : {}),
  });
  return readConvertBody(body, input.name);
}

/**
 * The answer to a conversion this page — or an earlier load of it — started
 * with `job` (`GET convert/result/:job`). The vault keeps it half an hour, so
 * a page reloaded while a file converted picks the answer up instead of
 * converting the file again. `running` while the service is still at it;
 * `failed` with the vault's own failure when it failed; null when no answer is
 * kept — the engine restarted, it ended too long ago, or the vault is older
 * than this route — and the file has to be converted again.
 */
export async function collectConversion(
  job: string,
  name: string,
  deps: { api: VaultApi },
): Promise<
  | { kind: "done"; converted: ConvertedFile }
  | { kind: "running" }
  | { kind: "failed"; error: VaultApiFailure }
  | null
> {
  let body: ConvertSummary & {
    running?: boolean;
    failed?: { status?: number; code?: string; error?: string };
  };
  try {
    body = await deps.api.get(`/convert/result/${encodeURIComponent(job)}`);
  } catch (error) {
    if (error instanceof VaultApiFailure && error.status === 404) return null;
    throw error;
  }
  if (body.running === true) return { kind: "running" };
  if (body.failed) {
    return {
      kind: "failed",
      error: new VaultApiFailure(
        body.failed.status ?? 500,
        body.failed.code ?? "CONVERT_FAILED",
        body.failed.error ?? "The conversion failed.",
      ),
    };
  }
  return { kind: "done", converted: readConvertBody(body, name) };
}

/** A convert route's answer, as the review reads it. */
function readConvertBody(body: ConvertSummary, name: string): ConvertedFile {
  if (!Array.isArray(body.sections)) {
    throw new Error(
      "The conversion service answered with an unexpected body — is CONVERT_SERVICE_URL pointing at this vault's convert route?",
    );
  }

  const markdown = typeof body.markdown === "string" ? body.markdown : null;
  const sections: Section[] = body.sections.map((s) => {
    const range = s.markdownRange ?? null;
    const sliced = markdown !== null && range;
    return {
      ...s,
      mergedFrom: s.mergedFrom ?? [],
      markdownRange: range,
      content: sliced ? markdown.slice(range.start, range.end) : s.text,
      // Counted now, while the whole markdown is here: the publish step only
      // has the slice, and a figure's index is document-wide.
      placeholderBase: sliced
        ? {
            picture: countOccurrences(
              markdown.slice(0, range.start),
              PICTURE_PLACEHOLDER,
            ),
            formula: countOccurrences(
              markdown.slice(0, range.start),
              FORMULA_PLACEHOLDER,
            ),
          }
        : null,
    };
  });

  return {
    filename: body.filename ?? name,
    format: body.format ?? "unknown",
    ocr: body.ocr ?? null,
    textSource: body.textSource ?? "docling",
    needsOcr: body.needsOcr ?? null,
    pages: body.pages ?? null,
    quality: body.quality ?? null,
    ocrOffer: body.ocrOffer ?? null,
    figures: body.figures ?? [],
    figureStats: body.figureStats ?? null,
    sections,
    plan: {
      cutLevel: body.plan?.cutLevel ?? 0,
      splitSections: body.plan?.splitSections ?? 0,
      mergedSections: body.plan?.mergedSections ?? 0,
      rejoinedSections: body.plan?.rejoinedSections ?? 0,
      minSectionChars: body.plan?.minSectionChars ?? 0,
    },
  };
}

// ---------------------------------------------------------------------------
// The write half: folder, sources, original
// ---------------------------------------------------------------------------

import type { IntakeFile } from "./intake-model.js";
import { publishPlan, titleKey } from "./intake-publish.js";
import {
  holdingJournal,
  ifJournalFree,
  type JournalAction,
  type JournalEntry,
  type JournalItem,
  type PublishJournal,
} from "./publish-journal.js";

export type AttachmentPort = {
  /** Content-addressed: resolves to a ref without sending the bytes. */
  prepare(file: {
    name: string;
    mimeType: string;
    bytes: Uint8Array;
  }): Promise<{ ref: string }>;
  upload(prepared: { ref: string }): Promise<void>;
};

export type PublishResult = {
  /** `null` when nothing was ticked: then nothing was created, not even the folder. */
  folderId: string | null;
  folderCreated: boolean;
  sourceIds: string[];
  /** Ticked sections with no content, which cannot become a source. */
  skipped: number;
  /** True when the original was attached to every created source and uploaded. */
  attached: boolean;
  /** Why the original could not be attached, when it could not. The sources still exist. */
  attachError?: string;
  /** Figures (pictures, formula images) uploaded and claimed by their sources. */
  attachments: number;
  /** Figures that could not be hashed or uploaded; their placeholders stay in the content. */
  attachmentErrors: number;
};

/**
 * A publish that stopped part-way. The sources named in `partial` exist and
 * are queued; a blind retry would duplicate them. The caller shows what landed.
 */
export class PublishPartialFailure extends Error {
  constructor(
    message: string,
    readonly partial: {
      folderId: string;
      sourceIds: string[];
      failedAt: number;
    },
  ) {
    super(message);
    this.name = "PublishPartialFailure";
  }
}

const CONVERT_TOOL = "docling.rs";
const CONVERT_METHOD = "converted";

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Order, so an add can be cut off and carry on: hash the original and its
 * figures → upload them → the folder → the journal → every source, created and
 * at once given its original and figures, written down as it lands.
 *
 * Uploading first means no source ever names a file the store does not hold,
 * and what is left of an add needs only what the journal keeps — never the
 * file's bytes. The ref is content-addressed (convert spec §12.1), so every
 * source points at one stored original. The routes enforce the rules — `POST
 * sources` resolves `/sources`, keeps `parentFolder` inside it, verifies
 * containment by reading it back, rolls back if it did not land, and queues by
 * default; reimplementing that here would be a second set of rules with its
 * own way to leave orphans. A failure to hash or upload does not block the add:
 * the sources are created without what failed, and the result says why.
 */
export async function publishFile(
  file: IntakeFile,
  bytes: Uint8Array,
  deps: {
    api: VaultApi;
    attachments?: AttachmentPort;
    driveId: string;
    now?: () => Date;
    /** Written as it goes, so an add that is cut off carries on later (`continuePublish`). */
    journal?: PublishJournal;
    /** Sources in the vault so far, of how many. */
    onProgress?: (done: number, total: number) => void;
    /** The add is written down (`journal`): from here it carries on by itself after a reload. */
    onJournaled?: () => void;
  },
): Promise<PublishResult> {
  const plan = publishPlan(file);
  if (plan.sources.length === 0) {
    return {
      folderId: null,
      folderCreated: false,
      sourceIds: [],
      skipped: plan.skipped,
      attached: false,
      attachments: 0,
      attachmentErrors: 0,
    };
  }

  // Hash first: the refs are known before anything is written.
  let prepared: { ref: string } | null = null;
  let hashError: string | undefined;
  if (deps.attachments) {
    try {
      prepared = await deps.attachments.prepare({
        name: file.name,
        mimeType: file.mimeType,
        bytes,
      });
    } catch (error) {
      hashError = message(error);
    }
  }
  // Figures the same way, referenced from the content as ![alt](attachment://…)
  // and claimed with ADD_ATTACHMENT. One that cannot be hashed keeps its
  // placeholder; the add goes on.
  const figures = file.converted?.figures ?? [];
  const hashed = new Map<string, { ref: string }>();
  let attachmentErrors = 0;
  if (deps.attachments) {
    for (const figure of figures) {
      try {
        hashed.set(
          figure.id,
          await deps.attachments.prepare({
            name: `${figure.id}.png`,
            mimeType: figure.mimeType,
            bytes: bytesFromBase64(figure.bytesBase64),
          }),
        );
      } catch {
        attachmentErrors += 1;
      }
    }
  }

  // Uploaded before any source exists. Each upload stands alone: when one
  // shared a try with the rest, the original's failure (2026-09-28: a dev.28
  // Switchboard answered 500 instead of 409 to re-reserving a stored PDF)
  // skipped every figure, leaving content that named images the store never
  // received. A failure now costs only that file, and is reported.
  let uploadError: string | undefined;
  let originalStored = false;
  if (prepared !== null && deps.attachments) {
    try {
      await deps.attachments.upload(prepared);
      originalStored = true;
    } catch (error) {
      uploadError = message(error);
    }
  }
  // Figures a few at a time; only the ones the store now holds are named.
  const stored = new Map<string, { ref: string }>();
  const queue = [...hashed.entries()];
  let figureErrors = 0;
  let firstFigureError: string | undefined;
  await Promise.all(
    Array.from({ length: Math.min(4, queue.length) }, async () => {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        const [figureId, ref] = next;
        try {
          await deps.attachments!.upload(ref);
          stored.set(figureId, ref);
        } catch (error) {
          figureErrors += 1;
          firstFigureError ??= message(error);
        }
      }
    }),
  );

  const sections = file.converted?.sections ?? [];
  const refOf = (figure: ConversionFigure) => stored.get(figure.id)?.ref;
  const attachedAt = (deps.now ?? (() => new Date()))().toISOString();
  let claimed = 0;
  const items: JournalItem[] = plan.sources.map((source) => {
    const section = sections.at(source.sectionIndex);
    const rewritten = section
      ? rewriteWithAttachments(section, figures, refOf)
      : { content: source.content, attached: [] };
    const actions: JournalAction[] = [];
    if (prepared !== null && originalStored) {
      actions.push({
        type: "ATTACH_ORIGINAL_FILE",
        scope: "global",
        input: {
          originalFile: prepared.ref,
          originalFileName: file.name,
          originalMimeType: file.mimeType,
          originalSizeBytes: file.size,
          convertedBy: CONVERT_TOOL,
          attachedAt,
        },
      });
    }
    for (const figure of rewritten.attached) {
      const ref = refOf(figure);
      if (ref === undefined) continue;
      actions.push({
        type: "ADD_ATTACHMENT",
        scope: "global",
        input: addAttachmentInput(figure, ref, attachedAt),
      });
      claimed += 1;
    }
    return {
      title: source.title,
      content: rewritten.content,
      sourceType: source.sourceType,
      actions,
    };
  });

  const folder = await deps.api.post<{ id: string; created: boolean }>(
    "/sources/folders",
    {
      drive: deps.driveId,
      name: plan.folderName,
    },
  );

  // Written down before the first source. No room to write it (a full
  // storage quota) costs only the carrying on: the add goes ahead as it
  // always did.
  let jobId: string | null = null;
  if (deps.journal) {
    try {
      jobId = await deps.journal.start(
        {
          driveId: deps.driveId,
          fileName: file.name,
          folderId: folder.id,
          folderName: plan.folderName,
        },
        items,
      );
      deps.onJournaled?.();
    } catch {
      jobId = null;
    }
  }

  const create = () =>
    createSources(items, 0, {
      api: deps.api,
      driveId: deps.driveId,
      folderId: folder.id,
      journal: jobId === null ? undefined : deps.journal,
      jobId,
      onProgress: deps.onProgress,
    });
  const run = jobId === null ? await create() : await holdingJournal(jobId, create);
  if (jobId !== null) await deps.journal?.finish(jobId).catch(() => {});

  const problems = [
    uploadError ? `original: ${uploadError}` : undefined,
    figureErrors
      ? `${figureErrors} figure${figureErrors === 1 ? "" : "s"}: ${firstFigureError}`
      : undefined,
  ].filter(Boolean);
  const attachError = problems.length
    ? `Upload failed for ${problems.join("; ")}`
    : (hashError ?? run.attachError);
  return {
    folderId: folder.id,
    folderCreated: folder.created,
    sourceIds: run.sourceIds,
    skipped: plan.skipped,
    attached: prepared !== null && originalStored && run.attachError === undefined,
    attachments: claimed,
    attachmentErrors: attachmentErrors + figureErrors,
    ...(attachError ? { attachError } : {}),
  };
}

/**
 * Create sources in order from `from`, each at once given its original and
 * figures, written down as it lands. A source the vault refuses stops the add
 * where it is — `PublishPartialFailure` names what landed, and the journal keeps
 * the rest for the person to try again; a request that never got an answer (the
 * page going away) is not a refusal, and leaves the add to carry on by itself.
 * `skip` holds titles already in the folder, each taken once: carrying on, the
 * source created as the page went away is not made twice.
 */
async function createSources(
  items: readonly JournalItem[],
  from: number,
  ctx: {
    api: VaultApi;
    driveId: string;
    folderId: string;
    journal?: PublishJournal;
    jobId: string | null;
    onProgress?: (done: number, total: number) => void;
    skip?: Map<string, number>;
  },
): Promise<{ sourceIds: string[]; attachError?: string }> {
  const sourceIds: string[] = [];
  let attachFailures = 0;
  let firstAttachError: string | undefined;
  const journal = ctx.jobId === null ? undefined : ctx.journal;
  for (let index = from; index < items.length; index++) {
    const item = items[index];
    const key = titleKey(item.title);
    const already = ctx.skip?.get(key) ?? 0;
    if (already > 0) {
      ctx.skip!.set(key, already - 1);
      if (journal) await journal.advance(ctx.jobId!, null).catch(() => {});
      ctx.onProgress?.(index + 1, items.length);
      continue;
    }
    let created: { id: string };
    try {
      created = await ctx.api.post<{ id: string }>("/sources", {
        drive: ctx.driveId,
        title: item.title,
        content: item.content,
        sourceType: item.sourceType,
        parentFolder: ctx.folderId,
        queue: true,
        method: CONVERT_METHOD,
        tool: CONVERT_TOOL,
      });
    } catch (error) {
      const why = `Could not create source ${index + 1} of ${items.length} (“${item.title}”): ${message(error)}`;
      // Only a refusal waits for the person; a request with no answer carries on by itself.
      if (journal && error instanceof VaultApiFailure) await journal.fail(ctx.jobId!, why).catch(() => {});
      throw new PublishPartialFailure(why, {
        folderId: ctx.folderId,
        sourceIds,
        failedAt: index,
      });
    }
    sourceIds.push(created.id);
    if (item.actions.length > 0) {
      try {
        // `POST actions` is keyed by document alone — the route rejects any
        // other field (a stray `drive` here cost every UI publish its attachment).
        await ctx.api.post("/actions", { documentId: created.id, actions: item.actions });
      } catch (error) {
        attachFailures += 1;
        firstAttachError ??= message(error);
      }
    }
    if (journal) await journal.advance(ctx.jobId!, created.id).catch(() => {});
    ctx.onProgress?.(index + 1, items.length);
  }
  return {
    sourceIds,
    ...(attachFailures
      ? {
          attachError: `${attachFailures} source${attachFailures === 1 ? "" : "s"} could not take ${attachFailures === 1 ? "its" : "their"} original: ${firstAttachError}`,
        }
      : {}),
  };
}

/**
 * Carry on an add the page did not live to finish — `publishFile` wrote it
 * down. The folder is read first, so what is already in it (every source
 * counted as done, and the one created as the page went away, which is not)
 * is not made twice.
 */
export async function continuePublish(
  entry: JournalEntry,
  deps: {
    api: VaultApi;
    journal: PublishJournal;
    folderTitles: (driveId: string, folderId: string) => Promise<string[]>;
    onProgress?: (done: number, total: number) => void;
  },
): Promise<{ sourceIds: string[]; attachError?: string } | null> {
  // Another window of this vault is carrying it on: leave it to that one.
  return ifJournalFree(entry.id, () => carryOn(entry, deps));
}

async function carryOn(
  entry: JournalEntry,
  deps: Parameters<typeof continuePublish>[1],
): Promise<{ sourceIds: string[]; attachError?: string }> {
  const items = await deps.journal.items(entry.id);
  if (items.length === 0) {
    await deps.journal.finish(entry.id);
    return { sourceIds: entry.sourceIds };
  }
  if (entry.error) await deps.journal.clearError(entry.id);
  const skip = new Map<string, number>();
  for (const title of await deps.folderTitles(entry.driveId, entry.folderId)) {
    const key = titleKey(title);
    skip.set(key, (skip.get(key) ?? 0) + 1);
  }
  // The sources counted as done are in the folder: only what is there beyond them is skipped.
  for (const item of items.slice(0, entry.done)) {
    const key = titleKey(item.title);
    const n = skip.get(key) ?? 0;
    if (n > 0) skip.set(key, n - 1);
  }
  const run = await createSources(items, entry.done, {
    api: deps.api,
    driveId: entry.driveId,
    folderId: entry.folderId,
    journal: deps.journal,
    jobId: entry.id,
    onProgress: deps.onProgress,
    skip,
  });
  await deps.journal.finish(entry.id).catch(() => {});
  return { sourceIds: [...entry.sourceIds, ...run.sourceIds], ...(run.attachError ? { attachError: run.attachError } : {}) };
}

/**
 * Attach the original to sources that already exist — the retry after a
 * publish whose attach step failed. Same three moves as inside `publishFile`
 * (hash → `ATTACH_ORIGINAL_FILE` per source → upload once), on their own.
 */
export async function attachOriginal(
  file: IntakeFile,
  bytes: Uint8Array,
  sourceIds: readonly string[],
  deps: {
    api: VaultApi;
    attachments: AttachmentPort;
    driveId: string;
    now?: () => Date;
  },
): Promise<{ attached: boolean; attachError?: string }> {
  try {
    const prepared = await deps.attachments.prepare({
      name: file.name,
      mimeType: file.mimeType,
      bytes,
    });
    const attachedAt = (deps.now ?? (() => new Date()))().toISOString();
    for (const documentId of sourceIds) {
      // `POST actions` is keyed by document alone — the route rejects any
      // other field (a stray `drive` here cost every UI publish its attachment).
      await deps.api.post("/actions", {
        documentId,
        actions: [
          {
            type: "ATTACH_ORIGINAL_FILE",
            scope: "global",
            input: {
              originalFile: prepared.ref,
              originalFileName: file.name,
              originalMimeType: file.mimeType,
              originalSizeBytes: file.size,
              convertedBy: CONVERT_TOOL,
              attachedAt,
            },
          },
        ],
      });
    }
    await deps.attachments.upload(prepared);
    return { attached: true };
  } catch (error) {
    return {
      attached: false,
      attachError: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Where a conversion started with `job` is; null once the service has forgotten it (a minute after it ends). */
export async function conversionProgress(
  job: string,
  deps: { api: VaultApi },
): Promise<ConversionProgress | null> {
  try {
    return await deps.api.get<ConversionProgress>(
      `/convert/progress/${encodeURIComponent(job)}`,
    );
  } catch (error) {
    if (error instanceof VaultApiFailure && error.status === 404) return null;
    throw error;
  }
}

/**
 * Stop a conversion started with `job` (`DELETE convert/:job`): the service
 * stops the worker and frees the file's lane. True when it was running; false
 * when it was not — finished already, or never started — which is not a
 * failure: there is nothing left to stop. Anything else is thrown; the intake
 * swallows it, since the file is leaving the batch either way.
 */
export async function cancelConversion(
  api: VaultApi,
  job: string,
): Promise<boolean> {
  try {
    const answer = await api.delete<{ cancelled?: boolean }>(
      `/convert/${encodeURIComponent(job)}`,
    );
    return answer.cancelled === true;
  } catch (error) {
    if (error instanceof VaultApiFailure && error.status === 404) return false;
    throw error;
  }
}
