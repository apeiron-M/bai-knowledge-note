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
  }): Promise<ConversionResult>;
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

  async function readJson<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new HttpError(
        502,
        "CONVERT_UNAVAILABLE",
        `Conversion service answered ${response.status}: ${text.slice(0, 300)}`,
      );
    }
    return (await response.json()) as T;
  }

  return {
    async convert({ filename, bytes }) {
      const response = await request(
        `/convert?filename=${encodeURIComponent(filename)}`,
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
      };
    },

    async health() {
      const response = await request("/health", { method: "GET" });
      return readJson<ConversionHealth>(response);
    },
  };
}
