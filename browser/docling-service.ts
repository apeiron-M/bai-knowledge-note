/**
 * File conversion in the page: docling.rs compiled to WebAssembly, behind the
 * same `ConversionService` the Switchboard's convert routes call. It reads
 * Office, HTML, Markdown, EPUB and the other declarative formats with their
 * structure, and the text layer of PDFs; a scanned PDF has none and is refused
 * with a pointer to the desktop app. The ~2 MB engine loads on the first file.
 */
import { HttpError } from "../subgraphs/convert/lib/respond.js";
import type {
  ConversionChunk,
  ConversionHealth,
  ConversionResult,
  ConversionService,
} from "../subgraphs/convert/lib/service.js";

type Docling = {
  default: (input?: unknown) => Promise<unknown>;
  convert: (bytes: Uint8Array, filename: string, to?: string | null) => string;
  supported_extensions: () => string;
};

/** What this build reads, as the engine lists it (`supported_extensions`), without loading it for a health check. */
const FORMATS = [
  "adoc", "asciidoc", "csv", "docx", "eml", "epub", "htm", "html", "json", "md", "markdown",
  "mhtml", "odp", "ods", "odt", "pdf", "pptx", "tex", "txt", "vtt", "xhtml", "xlsx", "xml",
];

let engine: Promise<Docling> | null = null;
function loadEngine(): Promise<Docling> {
  engine ??= import("docling.rs-wasm/web").then(async (module) => {
    const docling = module as unknown as Docling;
    await docling.default();
    return docling;
  });
  return engine;
}

/** Fewer letters than this per page means the PDF is a scan: its text layer is empty or nearly so. */
const MIN_PDF_LETTERS_PER_PAGE = 40;

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

/**
 * Docling's chunk shape, rebuilt from its Markdown: one chunk per block
 * (paragraph, list, table, code), each with the heading path it sits under.
 * Every chunk's text is an exact slice of the Markdown, so the sections built
 * from them can say where they sit in it.
 */
export function chunksFromMarkdown(markdown: string): ConversionChunk[] {
  const chunks: ConversionChunk[] = [];
  const path: string[] = [];
  let block: string[] = [];
  const flush = () => {
    const text = block.join("\n").trim();
    if (text) chunks.push(path.length > 0 ? { text, headings: [...path] } : { text });
    block = [];
  };
  for (const line of markdown.split("\n")) {
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      path.length = Math.min(path.length, level - 1);
      path.push(heading[2].trim());
      continue;
    }
    if (line.trim() === "") flush();
    else block.push(line);
  }
  flush();
  return chunks;
}

const extensionOf = (filename: string) => (filename.split(".").pop() ?? "").toLowerCase();

export function createDoclingService(): ConversionService {
  return {
    async convert(input) {
      const format = extensionOf(input.filename);
      if (!FORMATS.includes(format)) {
        throw new HttpError(
          415,
          "UNSUPPORTED_FORMAT",
          `The browser vault cannot read .${format} files. The desktop app reads images, audio and scanned documents too.`,
        );
      }
      const started = performance.now();
      const docling = await loadEngine();
      let markdown: string;
      try {
        markdown = docling.convert(input.bytes, input.filename, "md");
      } catch (error) {
        throw new HttpError(
          422,
          "CONVERT_FAILED",
          `This file could not be read in the browser: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const letters = markdown.replace(/[^\p{L}\p{N}]/gu, "").length;
      if (format === "pdf" && letters < MIN_PDF_LETTERS_PER_PAGE) {
        throw new HttpError(
          422,
          "NO_TEXT_LAYER",
          "This PDF has no text to read: it is a scan. The desktop app reads scanned documents; here, paste its text instead.",
        );
      }
      const result: ConversionResult = {
        markdown,
        chunks: chunksFromMarkdown(markdown),
        format,
        textSource: "docling",
        timings: { totalMs: Math.round(performance.now() - started), engine: "docling.rs-wasm" },
      };
      return result;
    },
    progress: () => Promise.resolve(null),
    cancel: () => Promise.resolve(false),
    health(): Promise<ConversionHealth> {
      return Promise.resolve({
        ok: true,
        backend: "docling.rs-wasm",
        ready: true,
        missing: [],
        formats: FORMATS,
        modelExtensions: [],
      });
    },
  };
}
