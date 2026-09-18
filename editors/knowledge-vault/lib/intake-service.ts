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
  textSource?: "docling" | "pdfjs" | "tesseract" | "docling-ocr";
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
 */
export async function convertFile(
  input: {
    name: string;
    bytes: Uint8Array;
    ocr?: boolean;
    job?: string;
    figures?: boolean;
  },
  deps: { api: VaultApi },
): Promise<ConvertedFile> {
  const path =
    `/convert?filename=${encodeURIComponent(input.name)}&markdown=1` +
    `${input.ocr ? "&ocr=1" : ""}${input.job ? `&job=${encodeURIComponent(input.job)}` : ""}` +
    `${input.figures ? "&figures=1" : ""}`;
  const body = await deps.api.postRaw<ConvertSummary>(path, input.bytes, {
    contentType: "application/octet-stream",
  });

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
    filename: body.filename ?? input.name,
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
import { publishPlan } from "./intake-publish.js";

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

/**
 * Two calls per file plus one per source, all against routes that already
 * enforce the rules — `POST sources` resolves `/sources`, keeps `parentFolder`
 * inside it, verifies containment by reading it back, rolls back if it did not
 * land, and queues by default. Reimplementing that here would be a second set
 * of rules with its own way to leave orphans.
 *
 * Order: ref → folder → sources → attach to each → upload once. The ref is
 * hashed first, before anything is written, because the store is
 * content-addressed: every source can point at the original while 30 MB is
 * still streaming (convert spec §12.1), and uploading per source would be N
 * copies of the same bytes. A failure to hash does not block the publish — the
 * sources are created without an original and the result says why.
 */
export async function publishFile(
  file: IntakeFile,
  bytes: Uint8Array,
  deps: {
    api: VaultApi;
    attachments?: AttachmentPort;
    driveId: string;
    now?: () => Date;
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

  // Hash first: the ref is known before a single document exists.
  let prepared: { ref: string } | null = null;
  let attachError: string | undefined;
  if (deps.attachments) {
    try {
      prepared = await deps.attachments.prepare({
        name: file.name,
        mimeType: file.mimeType,
        bytes,
      });
    } catch (error) {
      attachError = error instanceof Error ? error.message : String(error);
    }
  }

  // Figures the same way: hashed now, uploaded once at the end, referenced from
  // the content as ![alt](attachment://…) and claimed with ADD_ATTACHMENT. A
  // figure that cannot be hashed keeps its placeholder; the publish goes on.
  const figures = file.converted?.figures ?? [];
  const figureRefs = new Map<string, { ref: string }>();
  let attachmentErrors = 0;
  if (deps.attachments) {
    for (const figure of figures) {
      try {
        figureRefs.set(
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
  const sections = file.converted?.sections ?? [];
  const refOf = (figure: ConversionFigure) => figureRefs.get(figure.id)?.ref;
  const rewritten = plan.sources.map((source) => {
    const section = sections[source.sectionIndex];
    return section
      ? rewriteWithAttachments(section, figures, refOf)
      : { content: source.content, attached: [] };
  });

  const folder = await deps.api.post<{ id: string; created: boolean }>(
    "/sources/folders",
    {
      drive: deps.driveId,
      name: plan.folderName,
    },
  );

  const sourceIds: string[] = [];
  for (const [index, source] of plan.sources.entries()) {
    let created: { id: string };
    try {
      created = await deps.api.post<{ id: string }>("/sources", {
        drive: deps.driveId,
        title: source.title,
        content: rewritten[index]?.content ?? source.content,
        sourceType: source.sourceType,
        parentFolder: folder.id,
        queue: true,
        method: CONVERT_METHOD,
        tool: CONVERT_TOOL,
      });
    } catch (error) {
      throw new PublishPartialFailure(
        `Could not create source ${index + 1} of ${plan.sources.length} (“${source.title}”): ${
          error instanceof Error ? error.message : String(error)
        }`,
        { folderId: folder.id, sourceIds, failedAt: index },
      );
    }
    sourceIds.push(created.id);
  }

  const base: PublishResult = {
    folderId: folder.id,
    folderCreated: folder.created,
    sourceIds,
    skipped: plan.skipped,
    attached: false,
    attachments: 0,
    attachmentErrors,
  };

  // No attachment port, or hashing failed: publish the content anyway. A source
  // with no original is a degraded state the vault already supports; failing the
  // publish over it would throw away a conversion that may have taken minutes.
  if (!deps.attachments || (prepared === null && figureRefs.size === 0)) {
    return attachError === undefined ? base : { ...base, attachError };
  }

  try {
    const attachedAt = (deps.now ?? (() => new Date()))().toISOString();
    let claimed = 0;
    for (const [index, documentId] of sourceIds.entries()) {
      const actions: { type: string; scope: "global"; input: unknown }[] = [];
      if (prepared !== null) {
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
      for (const figure of rewritten[index]?.attached ?? []) {
        const ref = refOf(figure);
        if (ref === undefined) continue;
        actions.push({
          type: "ADD_ATTACHMENT",
          scope: "global",
          input: addAttachmentInput(figure, ref, attachedAt),
        });
        claimed += 1;
      }
      if (actions.length === 0) continue;
      // `POST actions` is keyed by document alone — the route rejects any
      // other field (a stray `drive` here cost every UI publish its attachment).
      await deps.api.post("/actions", { documentId, actions });
    }
    if (prepared !== null) await deps.attachments.upload(prepared);
    // Figures a few at a time: 73 sequential PUTs left a window in which an
    // opened source showed 404s for images its content already named.
    const queue = [...figureRefs.values()];
    await Promise.all(
      Array.from({ length: Math.min(4, queue.length) }, async () => {
        for (
          let next = queue.shift();
          next !== undefined;
          next = queue.shift()
        ) {
          await deps.attachments!.upload(next);
        }
      }),
    );
    return { ...base, attached: prepared !== null, attachments: claimed };
  } catch (error) {
    // The sources exist and are queued; only the attachments are missing. Say
    // so rather than fail a publish that already succeeded.
    return {
      ...base,
      attached: false,
      attachError: error instanceof Error ? error.message : String(error),
    };
  }
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
