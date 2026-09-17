/**
 * A local document-conversion service over `docling.rs`.
 *
 * The vault talks to this over HTTP (`CONVERT_SERVICE_URL`) through the
 * `subgraphs/convert` proxy. It is deliberately its own process: the binding
 * keeps hundreds of megabytes of ONNX weights resident once it has converted a
 * PDF, and the Switchboard should not carry that.
 *
 * Design points that come from measurement, not taste:
 *
 * - **It starts instantly and loads nothing.** The native binding (~68 MB) is
 *   imported on first use, and the warm `Pipeline` — which holds the ONNX
 *   models — is created only when a PDF or image actually arrives. A fresh
 *   process that has served no documents costs no model memory.
 * - **The warm `Pipeline` serves `pdf` and `image` only.** Its own typings say
 *   so; every declarative format (`md`, `html`, `docx`, `csv`, `epub`, …) goes
 *   through the per-call functions and needs no models at all. That is what
 *   makes "conversion works before the 700 MB is fetched" true rather than
 *   aspirational.
 * - **One instance serialises PDF conversions.** The binding documents that
 *   overlapping calls on one `Pipeline` queue, because the models are mutable
 *   sessions — so batch throughput comes from warm models and extra *processes*,
 *   never from extra concurrent requests.
 * - **It chunks with `chunkFileAsync`, not by re-chunking its own JSON.** Chunking
 *   the document it already converted (`chunkDocumentAsync` on the `to: "json"`
 *   output) measured ~1.6× cheaper, but **disagrees with `chunkFile` on
 *   tables** — on the sample PDF the education table's cells came back
 *   associated differently. Correctness won; re-converting inside the chunker
 *   is cheap because models live for the life of the process (three consecutive
 *   calls: 1630 / 1522 / 1580 ms), not per call.
 * - Model files are ~700 MB and are *not* fetched here at start-up. See
 *   `fetch-models.mjs`, and `/health`, which reports `ready: false` and the
 *   missing list until they exist.
 *
 * Cache hygiene, since "where does the scratch go?" is a fair question:
 *
 * - Per-request scratch (the uploaded bytes, and any qpdf/gs rewrite) lives in
 *   a `mkdtemp` dir removed in a `finally`, so it is gone on the error path
 *   too. Measured after a conversion: zero dirs left behind.
 * - `DOCLING_RS_HOME` is *not* a cache: a conversion writes nothing into it.
 *   The 707 MB there is the models, downloaded once on purpose.
 * - Leftovers therefore only come from a hard kill (`SIGKILL` skips `finally`),
 *   which `sweepStaleTempDirs()` clears at start-up.
 * - **Do not switch on `imageMode: "referenced"`** without cleaning up after
 *   it: that mode writes image files into `artifactsDir`, and nothing here
 *   removes those. `ConvertResult.images` is empty in the current calls, which
 *   is why no artifact cleanup exists.
 * - The one thing that cannot be freed per extraction is the warm pipeline's
 *   ~1.36 GB of loaded models — that warmth is what avoids reloading them per
 *   request. `CONVERT_IDLE_RELEASE_MS` trades it back after a quiet period.
 *
 * Runs on Node and Bun: `node:http` and `node:child_process` are both
 * implemented by Bun, and Node is what Vetra deploys the vault with.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Chunk, Pipeline } from "docling.rs";

const PORT = Number(process.env.CONVERT_SERVICE_PORT ?? process.env.PORT ?? 5007);
const HOST = process.env.CONVERT_SERVICE_HOST ?? "127.0.0.1";

/** `scripts/docling-serve/server.ts` sits two levels below the package root. */
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// docling.rs resolves its model home from `DOCLING_RS_HOME` and otherwise falls
// back to the **CWD** — which is wherever the *host* process happened to start,
// so a service autostarted by the vault would look in a different directory from
// the one it was told to. Pin the default to the package root: `<root>/.models`
// is then the same location whether the service is started by hand from the
// repo, from anywhere else, or by the subgraph. An explicit `DOCLING_RS_HOME`
// still wins, which is the knob a real deployment sets (a mounted volume).
process.env.DOCLING_RS_HOME ??= PACKAGE_ROOT;
const MAX_BYTES = Number(process.env.CONVERT_MAX_BYTES ?? 256 * 1024 * 1024);

/** Prefix for this service's per-request scratch dirs, so it can find its own. */
const TMP_PREFIX = "vault-convert-";

/**
 * How old a scratch dir must be before startup will delete it.
 *
 * Generous on purpose: two services can share one temp dir, and a dir younger
 * than this may belong to a conversion in flight right now.
 */
const STALE_TMP_MS = Number(process.env.CONVERT_TMP_STALE_MS ?? 6 * 60 * 60_000);

/**
 * Release the warm pipeline after this long with no conversion. `0` = never.
 *
 * Off by default, because warmth is the whole point: the models cost ~1.36 GB
 * resident but a reload per request costs seconds. Turn it on where memory
 * matters more than latency.
 */
const IDLE_RELEASE_MS = Number(process.env.CONVERT_IDLE_RELEASE_MS ?? 0);

/** Format ids that cannot be converted without the downloaded models. */
const MODEL_BACKED_FORMATS = new Set(["pdf", "image", "mets_gbs"]);

// --- binding, resolved on demand -------------------------------------------

/** Import the native binding once, on first use — not at start-up. */
const load = () => import("docling.rs");

let binding: ReturnType<typeof load> | null = null;

function docling(): ReturnType<typeof load> {
  binding ??= load();
  return binding;
}

let warmPipeline: Pipeline | null = null;

/**
 * The warm pipeline, for `pdf` / `image` only.
 *
 * `Pipeline` rejects anything else: it exists to keep the ONNX models loaded
 * across calls, and declarative formats have no models to keep.
 */
function pipelineFor(PipelineClass: typeof Pipeline): Pipeline {
  warmPipeline ??= new PipelineClass();
  return warmPipeline;
}

let idleTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Give the models back after a quiet period — the only "cache" here that can
 * be released, and off unless asked for (see `IDLE_RELEASE_MS`). Dropping the
 * reference is enough: the ONNX sessions belong to the Pipeline and are
 * collected with it.
 */
function scheduleIdleRelease(): void {
  if (IDLE_RELEASE_MS <= 0) return;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (warmPipeline !== null) {
      warmPipeline = null;
      console.log(`[convert] released the warm pipeline after ${IDLE_RELEASE_MS} ms idle`);
    }
  }, IDLE_RELEASE_MS);
  // A pending release must never keep the process alive.
  idleTimer.unref();
}

/**
 * Delete leftover scratch dirs from a previous run.
 *
 * The per-request dir is removed in a `finally`, so this is only for the cases
 * that skip it: `SIGKILL`, a crash, or the machine going down mid-conversion.
 * Measured after a normal conversion: zero dirs left, which is why this is a
 * safety net rather than routine cleanup.
 *
 * Only entries with this service's prefix, and only ones older than
 * `STALE_TMP_MS`, so a conversion running right now is never deleted.
 */
async function sweepStaleTempDirs(): Promise<number> {
  const root = tmpdir();
  let removed = 0;
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (!entry.startsWith(TMP_PREFIX)) continue;
    const path = join(root, entry);
    try {
      const info = await stat(path);
      if (Date.now() - info.mtimeMs < STALE_TMP_MS) continue;
      await rm(path, { recursive: true, force: true });
      removed += 1;
    } catch {
      // Raced with another process, or not ours to remove. Not worth failing over.
    }
  }
  return removed;
}

// --- helpers ----------------------------------------------------------------

function runtimeName(): string {
  const bun = (globalThis as { Bun?: { version: string } }).Bun;
  return bun ? `bun ${bun.version}` : `node ${process.version}`;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

/** Read the raw request body, refusing anything over `MAX_BYTES`. */
function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    let size = 0;
    req.on("data", (part: Buffer) => {
      size += part.length;
      if (size > MAX_BYTES) {
        reject(new Error(`body exceeds ${MAX_BYTES} bytes`));
        req.destroy();
        return;
      }
      parts.push(part);
    });
    req.on("end", () => resolve(Buffer.concat(parts)));
    req.on("error", reject);
  });
}

/** Run a helper binary, resolving to whether it succeeded. */
function run(command: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.on("error", () => resolve(false)); // binary absent
    child.on("close", (code) => resolve(code === 0));
  });
}

/**
 * The rewrites to try, in order, when pdfium refuses a PDF.
 *
 * `qpdf --linearize` first because it is lossless and fast, `gs` second because
 * it rebuilds the page tree wholesale — which is the only thing that helps for
 * some malformations.
 */
const REWRITERS = [
  {
    tool: "qpdf" as const,
    args: (src: string, dst: string) => ["--linearize", src, dst],
  },
  {
    tool: "gs" as const,
    args: (src: string, dst: string) => [
      "-q",
      "-dNOPAUSE",
      "-dBATCH",
      "-sDEVICE=pdfwrite",
      `-sOutputFile=${dst}`,
      src,
    ],
  },
];

const isFormatError = (error: unknown): boolean =>
  /FormatError|pdfium/i.test(error instanceof Error ? error.message : String(error));

// --- conversion -------------------------------------------------------------

interface Conversion {
  markdown: string;
  chunks: Chunk[];
  format: string;
  inputName: string;
  timings: { convertMs: number; chunkMs: number };
}

/**
 * One conversion pass: markdown for the source's own content, plus the chunks
 * the vault turns into sections.
 *
 * Both calls are needed. Chunk text is *not* markdown-quality for tables — a
 * PDF invoice's line items come back as `PART-X, QUANTITY = 480 pcs` triplets —
 * and the binding exposes no json→markdown export to derive one from the other.
 *
 * The chunks deliberately come from `chunkFileAsync`, which converts the file a
 * second time internally even though we already hold a conversion. Chunking our
 * own JSON instead (`chunkDocumentAsync`) is ~1.6× cheaper but loses table
 * fidelity: on the sample PDF the education table's cells came back associated
 * differently, and the two renders were not equal after whitespace
 * normalisation. 0.6 s is a fair price for correct tables.
 */
async function convertOnce(file: string, usePipeline: boolean): Promise<Conversion> {
  const library = await docling();
  const { chunkFileAsync, convertFileAsync } = library;
  const warm = usePipeline ? pipelineFor(library.Pipeline) : null;

  const convertStart = Date.now();
  const converted = warm
    ? await warm.convertFileAsync(file, { to: "markdown" })
    : await convertFileAsync(file, { to: "markdown" });
  const convertMs = Date.now() - convertStart;

  const chunkStart = Date.now();
  const chunks = await chunkFileAsync(file);
  const chunkMs = Date.now() - chunkStart;

  return {
    markdown: converted.content,
    chunks,
    format: converted.format,
    inputName: converted.inputName,
    timings: { convertMs, chunkMs },
  };
}

async function handleConvert(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const filename = basename(url.searchParams.get("filename") ?? "");
  if (!filename) {
    sendJson(res, 400, { error: "filename query parameter is required" });
    return;
  }

  let bytes: Buffer;
  try {
    bytes = await readBody(req);
  } catch (error) {
    sendJson(res, 413, { error: error instanceof Error ? error.message : String(error) });
    return;
  }
  if (bytes.length === 0) {
    sendJson(res, 400, { error: "empty body" });
    return;
  }

  let library: Awaited<ReturnType<typeof docling>>;
  try {
    library = await docling();
  } catch (error) {
    sendJson(res, 503, {
      error: "the docling.rs binding is not installed",
      detail: error instanceof Error ? error.message : String(error),
      hintForOperators: "run `bun install` in the vault package",
    });
    return;
  }

  const format = library.formatFromName(filename);
  const usePipeline = format !== null && MODEL_BACKED_FORMATS.has(format);
  const dependencies = library.checkDependencies();

  // Models are only needed for the model-backed formats. Everything else works
  // on a fresh install, which is what lets the UI offer the 700 MB download
  // instead of failing.
  if (usePipeline && !dependencies.ready) {
    sendJson(res, 415, {
      error: `cannot convert ${format} without the docling models`,
      missing: dependencies.missing,
      modelsDir: dependencies.home,
      hintForOperators:
        "node scripts/docling-serve/fetch-models.mjs — downloads ~700 MB, once",
    });
    return;
  }

  const dir = await mkdtemp(join(tmpdir(), "vault-convert-"));
  const started = Date.now();
  try {
    const file = join(dir, filename);
    await writeFile(file, bytes);

    let result: Conversion | null = null;
    let normalised: "qpdf" | "gs" | null = null;
    let refusal: unknown = null;

    try {
      result = await convertOnce(file, usePipeline);
    } catch (error) {
      // Rewrite only when pdfium actually refused the file, and only for PDFs.
      const isPdf = filename.toLowerCase().endsWith(".pdf");
      if (!isPdf || !isFormatError(error)) throw error;
      refusal = error;

      // "The tool exited 0" is NOT the test — "the rewritten file converts" is.
      // Measured: on a PDF whose page tree declares more pages than it has,
      // `qpdf --linearize` exits 0 and leaves the file just as refused (it
      // preserves the bad /Count), while `gs` rebuilds the tree and cures it.
      // So each rewrite is tried and then converted; the first that works wins.
      for (const rewriter of REWRITERS) {
        const target = join(dir, `normalised-${rewriter.tool}.pdf`);
        if (!(await run(rewriter.tool, rewriter.args(file, target)))) continue;
        try {
          result = await convertOnce(target, usePipeline);
          normalised = rewriter.tool;
          break;
        } catch {
          // This rewrite did not help; try the next one.
        }
      }
    }

    // pdfium refused it and no rewrite produced something it accepts.
    if (result === null) {
      sendJson(res, 415, {
        error: "the document could not be read, even after rewriting it",
        detail: refusal instanceof Error ? refusal.message : String(refusal),
        attempted: REWRITERS.map((rewriter) => rewriter.tool),
        hintForOperators:
          "pdfium refused this PDF and neither qpdf nor ghostscript produced a file it accepts",
      });
      return;
    }

    // A conversion just happened: re-arm the idle release if it is enabled.
    scheduleIdleRelease();

    sendJson(res, 200, {
      markdown: result.markdown,
      chunks: result.chunks,
      format: result.format,
      inputName: result.inputName,
      timings: { ...result.timings, totalMs: Date.now() - started },
      backend: "docling.rs",
      normalised,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** `/health`: the two independent states — binding present, models present. */
async function handleHealth(res: ServerResponse): Promise<void> {
  try {
    const library = await docling();
    const dependencies = library.checkDependencies();
    sendJson(res, 200, {
      ok: true,
      backend: "docling.rs",
      runtime: runtimeName(),
      ready: dependencies.ready,
      missing: dependencies.missing,
      modelsDir: dependencies.home,
      modelsLoaded: warmPipeline !== null,
      formats: library.supportedFormats(),
    });
  } catch (error) {
    sendJson(res, 503, {
      ok: false,
      backend: "docling.rs",
      runtime: runtimeName(),
      error: "the docling.rs binding is not installed",
      detail: error instanceof Error ? error.message : String(error),
      hintForOperators: "run `bun install` in the vault package",
    });
  }
}

// --- server -----------------------------------------------------------------

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    try {
      if (req.method === "GET" && url.pathname === "/health") {
        await handleHealth(res);
        return;
      }
      if (req.method === "POST" && url.pathname === "/convert") {
        await handleConvert(req, res, url);
        return;
      }
      if (url.pathname === "/") {
        sendJson(res, 200, {
          service: "vault-convert",
          endpoints: ["GET /health", "POST /convert?filename=<name>"],
        });
        return;
      }
      sendJson(res, 404, { error: "not found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/ENOENT|command not found/i.test(message)) {
        sendJson(res, 415, { error: message });
        return;
      }
      sendJson(res, 500, { error: message });
    }
  })();
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}

server.listen(PORT, HOST, () => {
  // One line, so `docker logs` / journald show something useful at start-up.
  console.log(`vault-convert listening on http://${HOST}:${PORT} (${runtimeName()})`);
  if (IDLE_RELEASE_MS > 0) {
    console.log(`[convert] idle release: ${IDLE_RELEASE_MS} ms`);
    scheduleIdleRelease();
  }
  // After listening, so a slow sweep never delays readiness.
  void sweepStaleTempDirs().then((removed) => {
    if (removed > 0) {
      console.log(`[convert] swept ${removed} stale scratch dir(s) from a previous run`);
    }
  });
});
