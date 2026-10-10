import type { RouteContext } from "@powerhousedao/shared/processors";
import { requireUser } from "../lib/authorize.js";
import type { ConvertRouteDeps } from "../lib/deps.js";
import { HttpError, jsonError, OK_CACHE } from "../lib/respond.js";
import { deriveSections } from "../lib/sections.js";

/**
 * Deliberately NOT the 2 MB house cap that `POST actions` / `POST sources`
 * use: the documents this route exists for are bigger. Measured — 47 KB CV,
 * 20 KB purchase order, **17.4 MB book**. 30 MB clears the worst case with
 * room, and stays a bound an operator can hold; the body is buffered per
 * request in the Switchboard, which is why it is not larger. The service's own
 * cap (`CONVERT_MAX_BYTES`, 256 MB) is higher on purpose: last line, not policy.
 *
 * That is the default for a vault the file reaches over the network. A vault on
 * the person's own computer has no network in between — a 39 MB report is a
 * local copy — so its host raises the cap with `CONVERT_MAX_UPLOAD_MB` (the
 * desktop app's engine sets 100). Never above the service's last line.
 */
export const DEFAULT_MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
export const UPLOAD_CEILING_BYTES = 256 * 1024 * 1024;

/** The upload cap for this process: `CONVERT_MAX_UPLOAD_MB` when set to a positive number, else the default. */
export function maxUploadBytes(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.CONVERT_MAX_UPLOAD_MB?.trim();
  const mb = raw ? Number(raw) : Number.NaN;
  if (!Number.isFinite(mb) || mb <= 0) return DEFAULT_MAX_UPLOAD_BYTES;
  return Math.min(Math.floor(mb * 1024 * 1024), UPLOAD_CEILING_BYTES);
}

/**
 * The floor is a *granularity* dial, not a quality one — measured on a
 * 238-page book: 2 000 → 117 sections, 4 000 → 68, 8 000 → 36, 12 000 → 25,
 * all of them clean. So the caller may set it; the default stays the
 * exported `SECTION_MIN_CHARS`. Bounded above so a typo cannot ask the rule to
 * fold a whole book into one source and call that a plan.
 */
export const MAX_MIN_SECTION_CHARS = 200_000;

function readMinSectionChars(url: URL): number | undefined {
  const raw = url.searchParams.get("minSectionChars");
  if (raw === null || raw.trim() === "") return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > MAX_MIN_SECTION_CHARS) {
    throw new HttpError(
      400,
      "INVALID_MIN_SECTION_CHARS",
      `minSectionChars must be an integer between 0 and ${MAX_MIN_SECTION_CHARS}.`,
    );
  }
  return value;
}

/** The refusal of a vault with no conversion service — shared with `DELETE convert/:job`. */
export const notConfigured = () =>
  new HttpError(
    503,
    "CONVERT_NOT_CONFIGURED",
    "No conversion service is configured. Set CONVERT_SERVICE_URL in the package config.",
  );

/**
 * The preview. **Creates nothing** — that is the whole point: the user sees the
 * sections the document would become, edits them, and only then does the app
 * write anything.
 *
 * The markdown is opt-in (`?markdown=1`) because a book-sized document would
 * otherwise round-trip through the browser twice: the sections already carry
 * the text. Each section still reports its `markdownRange`, so a caller that
 * did ask for the markdown can slice a table-correct body out of it.
 * `?minSectionChars=N` overrides the folding floor (see `readMinSectionChars`).
 */
export function createConvertRoute(deps: ConvertRouteDeps) {
  return async function handleConvert(
    request: Request,
    ctx: RouteContext,
  ): Promise<Response> {
    try {
      requireUser(ctx);

      const url = new URL(request.url);
      const filename = url.searchParams.get("filename")?.trim();
      if (!filename) {
        throw new HttpError(
          400,
          "FILENAME_REQUIRED",
          "Pass ?filename=<name with extension> — the extension is how the format is detected.",
        );
      }
      const bytes = ctx.rawBody;
      if (!bytes || bytes.byteLength === 0) {
        throw new HttpError(400, "EMPTY_BODY", "The request body is empty.");
      }
      const minSectionChars = readMinSectionChars(url);
      if (!deps.service) throw notConfigured();

      // `ctx.signal` is deliberately NOT forwarded to the service. reactor-api
      // (6.2.3-dev.44 … dev.52, `#serve`) arms it with
      // `req.once("close", () => controller.abort())`, and on Node 16+ an
      // IncomingMessage emits "close" as soon as its body has been read — which
      // for a `body: "raw"` route happens before this handler is called. The
      // signal arrives already aborted, so forwarding it would cancel every
      // conversion the moment it started. A client that no longer wants the
      // file says so explicitly instead: `DELETE convert/:job`
      // (routes/cancel.ts), which calls the service's `DELETE /convert/:job`.
      const result = await deps.service.convert({
        filename,
        bytes,
        ocr: url.searchParams.get("ocr") === "1",
        job: url.searchParams.get("job") ?? undefined,
        figures: url.searchParams.get("figures") === "1",
      });
      // The markdown is handed to the section rule so each section can say
      // where it sits in it (`markdownRange`): the markdown is where tables
      // are rendered correctly, and `text` is not.
      const plan = deriveSections(result.chunks, {
        documentName: filename,
        markdown: result.markdown,
        ...(minSectionChars === undefined ? {} : { minSectionChars }),
      });

      return Response.json(
        {
          filename,
          format: result.format ?? null,
          chars: result.markdown.length,
          chunks: result.chunks.length,
          sections: plan.sections,
          plan: {
            cutLevel: plan.cutLevel,
            splitSections: plan.splitSections,
            mergedSections: plan.mergedSections,
            rejoinedSections: plan.rejoinedSections,
            ceiling: plan.ceiling,
            minSectionChars: plan.minSectionChars,
          },
          ...(url.searchParams.get("markdown") === "1"
            ? { markdown: result.markdown }
            : {}),
          timings: result.timings ?? null,
          // The service OCR'd the file because its text layer was unusable
          // (or the caller asked): the UI should say so, since OCR text has
          // its own kinds of mistakes.
          ocr: result.ocr ?? null,
          textSource: result.textSource ?? "docling",
          // Over the OCR budget: no sections, an estimate, and the caller may
          // re-request with `?ocr=1` — the user decides to spend the minutes.
          needsOcr: result.needsOcr ?? null,
          pages: result.pages ?? null,
          // Measured completeness: share of the text layer's tokens that made
          // it through, plus formulas left undecoded and pictures not transcribed.
          quality: result.quality ?? null,
          ocrOffer: result.ocrOffer ?? null,
          // Pictures and display formulas as PNGs (with `?figures=1`), keyed to the n-th placeholder in `markdown`.
          figures: result.figures ?? [],
          figureStats: result.figureStats ?? null,
        },
        { headers: OK_CACHE },
      );
    } catch (error) {
      return jsonError(error);
    }
  };
}
