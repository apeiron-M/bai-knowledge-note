import { HttpError } from "./respond.js";

/** A chunk as the conversion service returns it (docling's shape). */
export interface ConversionChunk {
  text: string;
  headings?: string[];
  docItems?: string[];
  contextualized?: string;
}

export interface ConversionResult {
  markdown: string;
  chunks: ConversionChunk[];
  format?: string;
  timings?: Record<string, unknown>;
  /** Which OCR engine read the file, when one did. */
  ocr?: "tesseract" | "docling" | null;
  /** Which rung produced the text — `pdfjs` means the text layer, without layout. */
  textSource?: "docling" | "pdfjs" | "tesseract" | "docling-ocr";
  /** Set when OCR is needed but over the budget: the caller may re-request with `ocr: true`. */
  needsOcr?: {
    via: "tesseract" | "docling-ocr";
    estimateSeconds: number;
  } | null;
  pages?: number | null;
  /** With `figures: true`: the document's pictures and display formulas as PNGs, keyed to the n-th placeholder. */
  figures?: ConversionFigure[];
  figureStats?: {
    pictures: number;
    formulas: number;
    located: number;
    skipped: number;
    droppedForBudget: number;
    unplaced?: number;
    jsonMs: number;
    renderMs: number;
  } | null;
  /** The text layer was read flat (`textSource: "pdfjs"`): what OCR would cost to recover tables. */
  ocrOffer?: {
    via: "tesseract" | "docling-ocr";
    estimateSeconds: number;
  } | null;
  /** How much of the file's text layer survived, and the losses docling announces. A floor, not a proof. */
  quality?: ConversionQualityReport | null;
}

export interface ConversionQualityReport {
  coverage: number | null;
  rawTokens: number;
  formulas: { total: number; decoded: number };
  images: number;
}

export interface ConversionFigure {
  id: string;
  kind: "picture" | "formula";
  page: number;
  /** The n-th `<!-- image -->` (pictures) or `<!-- formula-not-decoded -->` (formulas) in the markdown. */
  placeholderIndex: number;
  alt: string;
  mimeType: string;
  width: number;
  height: number;
  bytesBase64: string;
}

export interface ConversionProgress {
  phase:
    | "starting"
    | "reading"
    | "structuring"
    | "text-layer"
    | "ocr"
    | "done"
    | "failed";
  pages: number | null;
  pagesDone: number;
  elapsedMs: number;
}

export interface ConversionHealth {
  ok: boolean;
  backend: string;
  ready: boolean;
  missing: string[];
  formats: string[];
}

export interface ConversionService {
  convert(input: {
    filename: string;
    bytes: Uint8Array;
    /** Ask the service to OCR regardless of its budget. */
    ocr?: boolean;
    /** A caller-chosen id to watch this conversion through `progress()`. */
    job?: string;
    /** Ask for the pictures and display formulas as images (PDF only; costs a second docling pass). */
    figures?: boolean;
  }): Promise<ConversionResult>;
  /** Live progress of a conversion started with `job`; null once the service has forgotten it. */
  progress(job: string): Promise<ConversionProgress | null>;
  health(): Promise<ConversionHealth>;
}

/**
 * A 238-page book takes 5 m 33 s on this host, and the vault is expected to
 * convert things larger than that. The timeout is a dead-peer detector, not a
 * service-level objective — it must not be the thing that fails a big document.
 */
const DEFAULT_TIMEOUT_MS = 30 * 60_000;

/**
 * The HTTP client for whatever conversion backend is configured, behind ONE
 * shape: `{ markdown, chunks }`.
 *
 * That shape is a contract the backend must meet, not a property it has — the
 * local service over docling.rs meets it natively, and `docling-serve` does not
 * (it answers `{ document: { md_content, … }, status, timings }`), so it needs a
 * small adapter. Keeping the adapter on the backend side is what lets this file
 * — and the subgraph — stay ignorant of which engine is running.
 *
 * A body that does not match the shape is an error, not an empty source: a
 * misconfigured `CONVERT_SERVICE_URL` should fail loudly rather than mint a
 * `bai/source` with no text in it.
 */
export function createHttpConversionService(options: {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): ConversionService {
  const base = options.baseUrl.replace(/\/+$/, "");
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function request(path: string, init: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    };
    if (options.apiKey) headers["x-api-key"] = options.apiKey;
    try {
      return await doFetch(`${base}${path}`, {
        ...init,
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      // Unreachable, DNS failure, or our own timeout. The caller must not
      // retry blindly, so the distinction from a 5xx is kept in the message.
      throw new HttpError(
        502,
        "CONVERT_UNAVAILABLE",
        `Conversion service unreachable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * One place to turn a conversion failure into an `HttpError`, because it can
   * arrive two ways: as a status code, or — when the service had already begun
   * heartbeating — inside a `200` body.
   */
  function conversionFailure(status: number, detail: string): HttpError {
    // The service runs one conversion at a time and says so; that is a
    // retry-later, not an outage, and the client must be able to tell.
    if (status === 503 && detail.includes("CONVERSION_BUSY")) {
      return new HttpError(
        503,
        "CONVERT_BUSY",
        `The conversion service is busy: ${detail.slice(0, 300)}`,
      );
    }
    return new HttpError(
      502,
      "CONVERT_UNAVAILABLE",
      `Conversion service answered ${status}: ${detail.slice(0, 300)}`,
    );
  }

  async function readJson<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw conversionFailure(response.status, text);
    }

    const body = (await response.json()) as
      | (T & { error?: unknown; code?: unknown; deferredStatus?: unknown })
      | null;

    // A conversion behind a reverse proxy writes keep-alive bytes so the
    // connection is not culled mid-document. The first of those commits the
    // status to 200, so a failure after it cannot answer 4xx/5xx — the service
    // puts the code it would have sent in `deferredStatus` instead. Without
    // this branch the body would fall through to the shape check and be
    // reported as "unexpected body", which reads as a misconfigured URL and
    // discards a perfectly good error message.
    if (body && typeof body.deferredStatus === "number") {
      const detail = [
        typeof body.error === "string" ? body.error : "",
        typeof body.code === "string" ? `(${body.code})` : "",
      ]
        .filter(Boolean)
        .join(" ");
      throw conversionFailure(body.deferredStatus, detail || JSON.stringify(body));
    }

    return body as T;
  }

  return {
    async convert({ filename, bytes, ocr, job, figures }) {
      const response = await request(
        `/convert?filename=${encodeURIComponent(filename)}${ocr ? "&ocr=1" : ""}${job ? `&job=${encodeURIComponent(job)}` : ""}${figures ? "&figures=1" : ""}`,
        {
          method: "POST",
          headers: { "content-type": "application/octet-stream" },
          body: bytes as unknown as BodyInit,
        },
      );
      const body = await readJson<{
        markdown: string;
        chunks: ConversionChunk[];
        format?: string;
        timings?: Record<string, unknown>;
        ocr?: "tesseract" | "docling" | null;
        textSource?: "docling" | "pdfjs" | "tesseract" | "docling-ocr";
        needsOcr?: {
          via: "tesseract" | "docling-ocr";
          estimateSeconds: number;
        } | null;
        pages?: number | null;
        quality?: ConversionQualityReport | null;
        ocrOffer?: ConversionResult["ocrOffer"];
        figures?: ConversionFigure[];
        figureStats?: ConversionResult["figureStats"];
      }>(response);
      if (typeof body.markdown !== "string" || !Array.isArray(body.chunks)) {
        throw new HttpError(
          502,
          "CONVERT_UNAVAILABLE",
          "Conversion service returned an unexpected body — is it a docling-serve instance without the adapter?",
        );
      }
      return {
        markdown: body.markdown,
        chunks: body.chunks,
        format: body.format,
        timings: body.timings,
        ocr: body.ocr ?? null,
        textSource: body.textSource ?? "docling",
        needsOcr: body.needsOcr ?? null,
        pages: body.pages ?? null,
        quality: body.quality ?? null,
        ocrOffer: body.ocrOffer ?? null,
        figures: body.figures ?? [],
        figureStats: body.figureStats ?? null,
      };
    },

    async progress(job) {
      const response = await request(`/progress/${encodeURIComponent(job)}`, {
        method: "GET",
      });
      if (response.status === 404) return null;
      return readJson<ConversionProgress>(response);
    },

    async health() {
      const response = await request("/health", { method: "GET" });
      return readJson<ConversionHealth>(response);
    },
  };
}
