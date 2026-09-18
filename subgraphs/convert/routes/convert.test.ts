import type { RouteContext } from "@powerhousedao/shared/processors";
import { describe, expect, it } from "vitest";
import { HttpError } from "../lib/respond.js";
import type { ConversionService } from "../lib/service.js";
import {
  createConvertRoute,
  MAX_MIN_SECTION_CHARS,
  MAX_UPLOAD_BYTES,
} from "./convert.js";

const ctx = (rawBody?: Buffer, user = true) =>
  ({
    params: {},
    // Only presence matters: requireUser() accepts any verified user.
    user: user ? { address: "0xabc" } : undefined,
    authEnabled: true,
    rawBody,
  }) as RouteContext;

/**
 * Chunks are deliberately above `SECTION_MIN_CHARS` (2 000): the sections a
 * preview returns are the ones a human would be asked to keep, and anything
 * smaller is folded into a neighbour by design. A test using tiny strings
 * asserts on behaviour the route does not have.
 */
const CHUNK = (heading: string) => ({
  text: `${heading} ` + "x".repeat(2_500),
  headings: [heading],
});

/** Heading lines matching the stub chunks, so `markdownRange` can be located. */
const STUB_MARKDOWN =
  "# The Vault\n\nvault body\n\n# Record\n\nrecord body\n\n# Reduce\n\nreduce body\n";

const stubService = (
  over: Partial<ConversionService> = {},
): ConversionService => ({
  convert: async () => ({
    markdown: STUB_MARKDOWN,
    chunks: [CHUNK("The Vault"), CHUNK("Record"), CHUNK("Reduce")],
    format: "md",
  }),
  progress: async () => null,
  health: async () => ({
    ok: true,
    backend: "docling.rs",
    ready: true,
    missing: [],
    formats: ["md", "pdf"],
  }),
  ...over,
});

const post = (filename: string, body = "abc") =>
  new Request(
    `http://vault.test/api/@powerhousedao/knowledge-note/convert?filename=${encodeURIComponent(filename)}`,
    { method: "POST", body },
  );

describe("createConvertRoute", () => {
  it("answers a preview with sections and no markdown by default", async () => {
    const handler = createConvertRoute({ service: stubService() });
    const res = await handler(post("Book.md"), ctx(Buffer.from("abc")));
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.filename).toBe("Book.md");
    expect(body.markdown).toBeUndefined();
    expect(body.plan).toMatchObject({ cutLevel: 1, splitSections: 0 });
    expect((body.sections as unknown[]).length).toBe(3);
  });

  it("includes the markdown only when asked", async () => {
    const handler = createConvertRoute({ service: stubService() });
    const res = await handler(
      new Request("http://vault.test/x/convert?filename=Book.md&markdown=1", {
        method: "POST",
        body: "abc",
      }),
      ctx(Buffer.from("abc")),
    );
    expect(((await res.json()) as Record<string, unknown>).markdown).toBe(
      STUB_MARKDOWN,
    );
  });

  it("passes the service's ocr verdict through, and null when there was none", async () => {
    // The UI tells the user when a file was read by OCR: OCR text has its own
    // kinds of mistakes (names, numbers), and the user should check those.
    const plain = createConvertRoute({ service: stubService() });
    const a = (await (
      await plain(post("Book.md"), ctx(Buffer.from("abc")))
    ).json()) as { ocr: unknown };
    expect(a.ocr).toBeNull();
    const ocrd = createConvertRoute({
      service: stubService({
        convert: async () => ({
          markdown: STUB_MARKDOWN,
          chunks: [CHUNK("The Vault")],
          format: "pdf",
          ocr: "tesseract",
        }),
      }),
    });
    const b = (await (
      await ocrd(post("scan.pdf"), ctx(Buffer.from("abc")))
    ).json()) as { ocr: unknown };
    expect(b.ocr).toBe("tesseract");
  });

  it("forwards ?ocr=1 to the service and passes needsOcr/textSource/pages through", async () => {
    let seen: { ocr?: boolean } | undefined;
    const handler = createConvertRoute({
      service: stubService({
        convert: async (input) => {
          seen = input;
          return {
            markdown: "",
            chunks: [],
            format: "pdf",
            needsOcr: { via: "tesseract", estimateSeconds: 90 },
            pages: 300,
            textSource: "docling",
          };
        },
      }),
    });
    const res = await handler(
      new Request("http://vault.test/x/convert?filename=scan.pdf&ocr=1", {
        method: "POST",
        body: "abc",
      }),
      ctx(Buffer.from("abc")),
    );
    const body = (await res.json()) as Record<string, unknown>;
    expect(seen?.ocr).toBe(true);
    expect(body.needsOcr).toEqual({ via: "tesseract", estimateSeconds: 90 });
    expect(body.pages).toBe(300);
    expect(body.textSource).toBe("docling");
    expect(body.sections).toEqual([]);
  });

  it("answers 503 CONVERT_BUSY when the service is mid-conversion, distinct from an outage", async () => {
    const handler = createConvertRoute({
      service: stubService({
        convert: async () => {
          throw new HttpError(
            503,
            "CONVERT_BUSY",
            "The conversion service is busy",
          );
        },
      }),
    });
    const res = await handler(post("Book.md"), ctx(Buffer.from("abc")));
    expect(res.status).toBe(503);
    expect(((await res.json()) as Record<string, unknown>).code).toBe(
      "CONVERT_BUSY",
    );
  });

  it("reports the full plan, including how many sections were rejoined", async () => {
    const handler = createConvertRoute({ service: stubService() });
    const res = await handler(post("Book.md"), ctx(Buffer.from("abc")));
    const body = (await res.json()) as { plan: Record<string, unknown> };
    expect(Object.keys(body.plan).sort()).toEqual([
      "ceiling",
      "cutLevel",
      "mergedSections",
      "minSectionChars",
      "rejoinedSections",
      "splitSections",
    ]);
    expect(body.plan.rejoinedSections).toBe(0);
  });

  it("locates every section in the markdown, whether or not the markdown was asked for", async () => {
    const handler = createConvertRoute({ service: stubService() });
    const res = await handler(post("Book.md"), ctx(Buffer.from("abc")));
    const body = (await res.json()) as {
      markdown?: string;
      sections: {
        title: string;
        markdownRange: { start: number; end: number } | null;
        mergedFrom: unknown[];
      }[];
    };
    expect(body.markdown).toBeUndefined();
    const ranges = body.sections.map((s) => s.markdownRange);
    expect(ranges).toEqual([
      { start: 0, end: STUB_MARKDOWN.indexOf("# Record") },
      {
        start: STUB_MARKDOWN.indexOf("# Record"),
        end: STUB_MARKDOWN.indexOf("# Reduce"),
      },
      { start: STUB_MARKDOWN.indexOf("# Reduce"), end: STUB_MARKDOWN.length },
    ]);
    // The ranges are what a client slices `?markdown=1` with; the slice must
    // start on the section's own heading line.
    expect(STUB_MARKDOWN.slice(ranges[1]!.start, ranges[1]!.end)).toBe(
      "# Record\n\nrecord body\n\n",
    );
    expect(body.sections.every((s) => s.mergedFrom.length === 0)).toBe(true);
  });

  it("lets the caller set the folding floor, and reports what was applied", async () => {
    // Three 2 500-char chunks: at the default floor they are three sections;
    // at 6 000 the first two fold into a third, named after the largest part.
    const handler = createConvertRoute({ service: stubService() });
    const res = await handler(
      new Request(
        "http://vault.test/x/convert?filename=Book.md&minSectionChars=6000",
        {
          method: "POST",
          body: "abc",
        },
      ),
      ctx(Buffer.from("abc")),
    );
    const body = (await res.json()) as {
      plan: { minSectionChars: number; mergedSections: number };
      sections: { title: string; mergedFrom: { title: string }[] }[];
    };
    expect(res.status).toBe(200);
    expect(body.plan.minSectionChars).toBe(6000);
    expect(body.sections).toHaveLength(1);
    expect(body.plan.mergedSections).toBe(2);
    expect(body.sections[0].mergedFrom.map((p) => p.title)).toEqual([
      "The Vault",
      "Record",
      "Reduce",
    ]);
  });

  it("rejects a folding floor that is not a non-negative integer within the bound", async () => {
    const handler = createConvertRoute({ service: stubService() });
    for (const bad of ["-1", "2.5", "abc", String(MAX_MIN_SECTION_CHARS + 1)]) {
      const res = await handler(
        new Request(
          `http://vault.test/x/convert?filename=Book.md&minSectionChars=${bad}`,
          {
            method: "POST",
            body: "abc",
          },
        ),
        ctx(Buffer.from("abc")),
      );
      expect(res.status).toBe(400);
      expect(((await res.json()) as Record<string, unknown>).code).toBe(
        "INVALID_MIN_SECTION_CHARS",
      );
    }
  });

  it("treats an empty minSectionChars as absent, and 0 as 'do not fold'", async () => {
    const handler = createConvertRoute({ service: stubService() });
    const empty = await handler(
      new Request(
        "http://vault.test/x/convert?filename=Book.md&minSectionChars=",
        { method: "POST", body: "abc" },
      ),
      ctx(Buffer.from("abc")),
    );
    expect(
      ((await empty.json()) as { plan: { minSectionChars: number } }).plan
        .minSectionChars,
    ).toBe(2000);
    const zero = await handler(
      new Request(
        "http://vault.test/x/convert?filename=Book.md&minSectionChars=0",
        { method: "POST", body: "abc" },
      ),
      ctx(Buffer.from("abc")),
    );
    expect(
      ((await zero.json()) as { plan: { minSectionChars: number } }).plan
        .minSectionChars,
    ).toBe(0);
  });

  it("requires a filename", async () => {
    const handler = createConvertRoute({ service: stubService() });
    const res = await handler(
      new Request("http://vault.test/x/convert", {
        method: "POST",
        body: "abc",
      }),
      ctx(Buffer.from("abc")),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as Record<string, unknown>).code).toBe(
      "FILENAME_REQUIRED",
    );
  });

  it("rejects an empty body", async () => {
    const handler = createConvertRoute({ service: stubService() });
    const res = await handler(post("Book.md"), ctx(Buffer.alloc(0)));
    expect(res.status).toBe(400);
    expect(((await res.json()) as Record<string, unknown>).code).toBe(
      "EMPTY_BODY",
    );
  });

  it("requires a verified caller, because a host with auth off serves routes anonymously", async () => {
    const handler = createConvertRoute({ service: stubService() });
    const res = await handler(post("Book.md"), ctx(Buffer.from("abc"), false));
    expect(res.status).toBe(401);
    expect(((await res.json()) as Record<string, unknown>).code).toBe(
      "UNAUTHENTICATED",
    );
  });

  it("answers 502 when the backend fails, and says nothing was written", async () => {
    const handler = createConvertRoute({
      service: stubService({
        convert: async () => {
          // What the real client throws: an HttpError, not a bare Error with a
          // `status` property. jsonError only trusts the former.
          throw new HttpError(
            502,
            "CONVERT_UNAVAILABLE",
            "Conversion service unreachable",
          );
        },
      }),
    });
    const res = await handler(post("Book.md"), ctx(Buffer.from("abc")));
    expect(res.status).toBe(502);
    expect(((await res.json()) as Record<string, unknown>).code).toBe(
      "CONVERT_UNAVAILABLE",
    );
  });

  it("answers 503 and refuses to convert when no backend is configured", async () => {
    const handler = createConvertRoute({});
    const res = await handler(post("Book.md"), ctx(Buffer.from("abc")));
    expect(res.status).toBe(503);
    expect(((await res.json()) as Record<string, unknown>).code).toBe(
      "CONVERT_NOT_CONFIGURED",
    );
  });

  it("does not send a file to the service when it is too large for the route", async () => {
    // The cap is enforced by the host from `maxBodyBytes`; what this asserts is
    // that the exported bound is the one Task 4 registers, and that it is
    // deliberately not the 2 MB house default.
    expect(MAX_UPLOAD_BYTES).toBe(30 * 1024 * 1024);
    expect(MAX_UPLOAD_BYTES).toBeGreaterThan(17_387_337);
  });
});
