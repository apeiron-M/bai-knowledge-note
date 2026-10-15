import { describe, expect, it } from "vitest";
import { convertFile } from "./intake-service.js";
import type { VaultApi } from "./vault-api.js";

const markdown =
  "## Core Competencies\n\nskills\n\n## Education\n\n| Academy | 2016 |\n";
const summary = {
  filename: "Book chapter.pdf",
  format: "pdf",
  chars: markdown.length,
  chunks: 55,
  sections: [
    {
      title: "Core Competencies",
      headingPath: ["Core Competencies"],
      text: "skills",
      charCount: 6,
      chunks: [0],
      mergedFrom: [],
      markdownRange: { start: 0, end: markdown.indexOf("## Education") },
    },
    {
      title: "Education",
      headingPath: ["Education"],
      text: "Academy, 1 = 2016",
      charCount: 17,
      chunks: [1],
      mergedFrom: [
        { title: "Education", headingPath: ["Education"], charCount: 17 },
      ],
      markdownRange: {
        start: markdown.indexOf("## Education"),
        end: markdown.length,
      },
    },
  ],
  plan: {
    cutLevel: 1,
    splitSections: 0,
    mergedSections: 0,
    rejoinedSections: 0,
    ceiling: 40000,
    minSectionChars: 2000,
  },
  markdown,
  timings: { convertMs: 1, chunkMs: 1, totalMs: 2 },
};

function recordingApi(response: unknown = summary) {
  const calls: { path: string; bytes: Uint8Array; contentType?: string }[] = [];
  const api = {
    get: () => Promise.reject(new Error("not used")),
    post: () => Promise.reject(new Error("not used")),
    postRaw: (
      path: string,
      bytes: Uint8Array,
      options?: { contentType?: string },
    ) => {
      calls.push({ path, bytes, contentType: options?.contentType });
      return Promise.resolve(response);
    },
  } as unknown as VaultApi;
  return { api, calls };
}

describe("convertFile", () => {
  it("asks the convert route for this filename and the markdown, with the bytes", async () => {
    const { api, calls } = recordingApi();
    const bytes = new Uint8Array([1, 2, 3]);
    const result = await convertFile(
      { name: "Book chapter.pdf", bytes },
      { api },
    );

    expect(calls[0].path).toBe(
      "/convert?filename=Book%20chapter.pdf&markdown=1",
    );
    expect(calls[0].bytes).toBe(bytes);
    expect(calls[0].contentType).toBe("application/octet-stream");
    expect(result.sections).toHaveLength(2);
    expect(result.format).toBe("pdf");
    expect(result.plan).toEqual({
      cutLevel: 1,
      splitSections: 0,
      mergedSections: 0,
      rejoinedSections: 0,
      minSectionChars: 2000,
    });
  });

  it("gives each section the markdown slice as content, so tables survive", async () => {
    const { api } = recordingApi();
    const result = await convertFile(
      { name: "cv.pdf", bytes: new Uint8Array() },
      { api },
    );
    expect(result.sections[0].content).toBe(
      "## Core Competencies\n\nskills\n\n",
    );
    expect(result.sections[1].content).toBe(
      "## Education\n\n| Academy | 2016 |\n",
    );
    // The chunk text is kept beside it, for display and as the fallback.
    expect(result.sections[1].text).toBe("Academy, 1 = 2016");
    expect(result.sections[1].mergedFrom).toHaveLength(1);
  });

  it("falls back to the chunk text when a section has no markdown range", async () => {
    const { api } = recordingApi({
      ...summary,
      sections: [{ ...summary.sections[0], markdownRange: null }],
    });
    const result = await convertFile(
      { name: "cv.pdf", bytes: new Uint8Array() },
      { api },
    );
    expect(result.sections[0].content).toBe("skills");
    expect(result.sections[0].markdownRange).toBeNull();
  });

  it("tolerates an older route that sends neither mergedFrom nor markdownRange", async () => {
    const { api } = recordingApi({
      ...summary,
      markdown: undefined,
      sections: [
        {
          title: "One",
          headingPath: ["One"],
          text: "a",
          charCount: 1,
          chunks: [0],
        },
      ],
    });
    const result = await convertFile(
      { name: "a.md", bytes: new Uint8Array() },
      { api },
    );
    expect(result.sections[0]).toMatchObject({
      content: "a",
      mergedFrom: [],
      markdownRange: null,
    });
  });

  it("encodes a filename that would otherwise break the query string", async () => {
    const { api, calls } = recordingApi();
    await convertFile(
      { name: "Q&A #1 (final).pdf", bytes: new Uint8Array() },
      { api },
    );
    expect(calls[0].path).toBe(
      `/convert?filename=${encodeURIComponent("Q&A #1 (final).pdf")}&markdown=1`,
    );
  });

  it("refuses a body the service did not answer with sections", async () => {
    // A CONVERT_SERVICE_URL pointing at something that is not our service
    // answers 200 with a shape we cannot use. Failing loudly here is what stops
    // a publish of zero sources reading as a success.
    const { api } = recordingApi({ markdown: "# hi" });
    await expect(
      convertFile({ name: "a.pdf", bytes: new Uint8Array() }, { api }),
    ).rejects.toThrow(/unexpected/i);
  });
});

// ---------------------------------------------------------------------------
// publishFile — the write half
// ---------------------------------------------------------------------------
import type { IntakeFile } from "./intake-model.js";
import {
  publishFile,
  PublishPartialFailure,
  type AttachmentPort,
} from "./intake-service.js";

function publishApi() {
  const calls: { path: string; body: unknown }[] = [];
  const api = {
    get: () => Promise.reject(new Error("not used")),
    postRaw: () => Promise.reject(new Error("not used")),
    post: (path: string, body: unknown) => {
      // A vault older than `POST sources/batch`: these tests cover the add one source at a time.
      if (path === "/sources/batch") {
        return Promise.reject(new VaultApiFailure(404, "UNKNOWN", "The vault refused the request (404)."));
      }
      calls.push({ path, body });
      if (path === "/sources/folders") {
        return Promise.resolve({
          id: "folder-1",
          name: "Book",
          path: "/sources/Book",
          created: true,
        });
      }
      if (path === "/sources") {
        const n = calls.filter((c) => c.path === "/sources").length;
        return Promise.resolve({
          id: `source-${n}`,
          status: "EXTRACTING",
          task: { id: "t1" },
        });
      }
      return Promise.resolve({ revision: 2 });
    },
  } as unknown as VaultApi;
  return { api, calls };
}

const plan = {
  cutLevel: 1,
  splitSections: 0,
  mergedSections: 0,
  rejoinedSections: 0,
  minSectionChars: 2000,
};
const sec = (title: string, text: string, headingPath: string[] = [title]) => ({
  title,
  headingPath,
  text,
  content: text,
  charCount: text.length,
  chunks: [0],
  mergedFrom: [],
  markdownRange: null,
});

const convertedFile = (over: Partial<IntakeFile> = {}): IntakeFile => ({
  id: "f1",
  name: "Book.pdf",
  size: 10,
  mimeType: "application/pdf",
  state: "converted",
  sourceType: "BOOK_CHAPTER",
  folderName: "Book",
  selected: [true, true],
  converted: {
    filename: "Book.pdf",
    format: "pdf",
    plan,
    sections: [sec("Record", "first"), sec("Reduce", "second")],
  },
  ...over,
});

const sourceBodies = (calls: { path: string; body: unknown }[]) =>
  calls
    .filter((c) => c.path === "/sources")
    .map((c) => c.body as Record<string, unknown>);

describe("publishFile", () => {
  it("mints the folder once, then creates one source per ticked section", async () => {
    const { api, calls } = publishApi();
    const result = await publishFile(convertedFile(), new Uint8Array([1]), {
      api,
      driveId: "vetra-a933d854",
    });

    const paths = calls.map((c) => c.path);
    expect(paths[0]).toBe("/sources/folders");
    expect(paths.filter((p) => p === "/sources")).toHaveLength(2);
    expect(result.sourceIds).toEqual(["source-1", "source-2"]);
    expect(result.folderId).toBe("folder-1");
    expect(result.folderCreated).toBe(true);
  });

  it("names the folder, and places every source in it", async () => {
    const { api, calls } = publishApi();
    await publishFile(convertedFile(), new Uint8Array([1]), {
      api,
      driveId: "d",
    });
    expect(calls[0].body).toEqual({ drive: "d", name: "Book" });
    expect(
      sourceBodies(calls).every((b) => b.parentFolder === "folder-1"),
    ).toBe(true);
  });

  it("queues every source, so it reaches the pipeline as EXTRACTING, with the conversion as provenance", async () => {
    // `queue` defaults to true server-side; sending it explicitly means the
    // intent survives a change to that default.
    const { api, calls } = publishApi();
    await publishFile(convertedFile(), new Uint8Array([1]), {
      api,
      driveId: "d",
    });
    const bodies = sourceBodies(calls);
    expect(bodies.every((b) => b.queue === true)).toBe(true);
    expect(bodies.every((b) => b.method === "converted")).toBe(true);
    expect(bodies.every((b) => b.tool === "docling.rs")).toBe(true);
    expect(bodies[0]).toMatchObject({
      drive: "d",
      title: "Record",
      content: "first",
      sourceType: "BOOK_CHAPTER",
    });
  });

  it("creates only the ticked sections", async () => {
    const { api, calls } = publishApi();
    const result = await publishFile(
      convertedFile({ selected: [false, true] }),
      new Uint8Array([1]),
      { api, driveId: "d" },
    );
    expect(sourceBodies(calls).map((b) => b.title)).toEqual(["Reduce"]);
    expect(result.sourceIds).toHaveLength(1);
  });

  it("uploads the original once, before any source exists, then gives each source its ref as it is created", async () => {
    // The store is content-addressed, so one upload serves every source. Up
    // front, so no source ever names a file the store does not hold, and an
    // add cut off part-way can carry on without the file's bytes.
    const { api, calls } = publishApi();
    const order: string[] = [];
    const attachments: AttachmentPort = {
      prepare: () => {
        order.push("prepare");
        return Promise.resolve({ ref: "attachment://v1:abc" });
      },
      upload: () => {
        order.push("upload");
        return Promise.resolve();
      },
    };
    const apiWithOrder = {
      ...api,
      post: (path: string, body: unknown) => {
        order.push(path === "/actions" ? "attach" : path);
        return api.post(path, body);
      },
    } as unknown as VaultApi;

    const result = await publishFile(convertedFile(), new Uint8Array([1]), {
      api: apiWithOrder,
      attachments,
      driveId: "d",
    });

    expect(order[0]).toBe("prepare");
    expect(order.filter((o) => o === "attach")).toHaveLength(2);
    expect(order.filter((o) => o === "upload")).toHaveLength(1);
    expect(order.indexOf("upload")).toBeLessThan(order.indexOf("/sources"));
    // Each source is given its original right after it is created — several
    // are made at once, so an attach never runs ahead of the creates.
    const fromFirst = order.slice(order.indexOf("/sources"));
    expect(fromFirst.filter((o) => o === "/sources")).toHaveLength(2);
    fromFirst.forEach((_, i) => {
      const seen = fromFirst.slice(0, i + 1);
      expect(seen.filter((o) => o === "attach").length).toBeLessThanOrEqual(seen.filter((o) => o === "/sources").length);
    });
    expect(result.attached).toBe(true);

    const attachBodies = calls
      .filter((c) => c.path === "/actions")
      .map(
        (c) =>
          c.body as {
            drive: string;
            documentId: string;
            actions: {
              type: string;
              scope: string;
              input: Record<string, unknown>;
            }[];
          },
      );
    expect(attachBodies.map((b) => b.documentId)).toEqual([
      "source-1",
      "source-2",
    ]);
    expect(
      attachBodies.every(
        (b) =>
          b.actions[0].type === "ATTACH_ORIGINAL_FILE" &&
          b.actions[0].scope === "global",
      ),
    ).toBe(true);
    expect(attachBodies[0].actions[0].input).toMatchObject({
      originalFile: "attachment://v1:abc",
      originalFileName: "Book.pdf",
      originalMimeType: "application/pdf",
      originalSizeBytes: 10,
      convertedBy: "docling.rs",
    });
    expect(typeof attachBodies[0].actions[0].input.attachedAt).toBe("string");
  });

  it("sends POST actions only the fields the route allows — a stray field is a 400 and no attachment", async () => {
    // Found in the UI: every publish lost its attachment because the body
    // carried `drive`, which the actions route rejects with
    // "body has unknown field: drive. Allowed: actions, allowLiteralEscapes, documentId, wait".
    const { api, calls } = publishApi();
    const attachments: AttachmentPort = {
      prepare: () => Promise.resolve({ ref: "attachment://v1:abc" }),
      upload: () => Promise.resolve(),
    };
    await publishFile(convertedFile(), new Uint8Array([1]), {
      api,
      attachments,
      driveId: "d",
    });
    const attach = calls.filter((c) => c.path === "/actions");
    expect(attach.length).toBeGreaterThan(0);
    for (const c of attach) {
      const keys = Object.keys(c.body as Record<string, unknown>).sort();
      expect(
        keys.every((k) =>
          ["actions", "allowLiteralEscapes", "documentId", "wait"].includes(k),
        ),
      ).toBe(true);
      expect(keys).toContain("documentId");
      expect(keys).toContain("actions");
    }
  });

  it("publishes figures as attachments: hashed before creation, referenced from the content, claimed with ADD_ATTACHMENT, uploaded once", async () => {
    const { api, calls } = publishApi();
    const prepared: string[] = [];
    const uploaded: string[] = [];
    const attachments: AttachmentPort = {
      prepare: (f) => {
        prepared.push(f.name);
        return Promise.resolve({
          ref: `attachment://v1:${f.name.replace(/\W/g, "").padEnd(64, "0")}`,
        });
      },
      upload: (p) => {
        uploaded.push(p.ref);
        return Promise.resolve();
      },
    };
    const figure = {
      id: "formula-1",
      kind: "formula" as const,
      page: 2,
      placeholderIndex: 0,
      alt: "formula 1, page 2 — not decoded",
      mimeType: "image/png",
      width: 9,
      height: 4,
      bytesBase64: "iVBORw0KGgo=",
    };
    const file = convertedFile({
      selected: [true],
      converted: {
        filename: "Paper.pdf",
        format: "pdf",
        plan,
        sections: [
          {
            ...sec("Intro", "Intro\n\n<!-- formula-not-decoded -->\n\nafter"),
            markdownRange: { start: 0, end: 40 },
            placeholderBase: { picture: 0, formula: 0 },
          },
        ],
        figures: [figure],
      },
    });

    const result = await publishFile(file, new Uint8Array([1]), {
      api,
      attachments,
      driveId: "d",
    });

    // hashed: the original and the figure, before any document existed
    expect(prepared).toEqual(["Book.pdf", "formula-1.png"]);
    // the content that was written references the figure by ref, alt intact
    const [source] = sourceBodies(calls);
    expect(source.content).toContain(
      "![formula 1, page 2 — not decoded](attachment://v1:formula1png",
    );
    expect(source.content).not.toContain("<!-- formula-not-decoded -->");
    // one actions batch per source: the original, then the figure claim
    const actions = calls
      .filter((c) => c.path === "/actions")
      .map(
        (c) =>
          (
            c.body as {
              actions: { type: string; input: Record<string, unknown> }[];
            }
          ).actions,
      );
    expect(actions).toHaveLength(1);
    expect(actions[0].map((a) => a.type)).toEqual([
      "ATTACH_ORIGINAL_FILE",
      "ADD_ATTACHMENT",
    ]);
    expect(actions[0][1].input).toMatchObject({
      id: "formula-1",
      role: "formula",
      mimeType: "image/png",
      page: 2,
      width: 9,
      height: 4,
      fileName: "formula-1.png",
    });
    // uploaded once each
    expect(uploaded).toHaveLength(2);
    expect(result.attached).toBe(true);
    expect(result.attachments).toBe(1);
    expect(result.attachmentErrors).toBe(0);
  });

  it("still uploads every figure when the original's upload fails, and says which failed", async () => {
    // 2026-09-28: re-reserving an already-stored original answered 500 on a
    // dev.28 Switchboard; the shared try skipped all 36 figure uploads.
    const { api } = publishApi();
    const uploaded: string[] = [];
    const attachments: AttachmentPort = {
      prepare: (f) => Promise.resolve({ ref: `attachment://v1:${f.name.replace(/\W/g, "").padEnd(64, "0")}` }),
      upload: (p) => {
        if (p.ref.includes("Bookpdf")) return Promise.reject(new Error("Internal error"));
        if (p.ref.includes("picture2")) return Promise.reject(new Error("reserve 500"));
        uploaded.push(p.ref);
        return Promise.resolve();
      },
    };
    const picture = (n: number) => ({
      id: `picture-${n}`,
      kind: "picture" as const,
      page: 1,
      placeholderIndex: n - 1,
      alt: `figure ${n}`,
      mimeType: "image/png",
      width: 4,
      height: 4,
      bytesBase64: "iVBORw0KGgo=",
    });
    const file = convertedFile({
      selected: [true],
      converted: {
        filename: "Paper.pdf",
        format: "pdf",
        plan,
        sections: [
          {
            ...sec("Intro", "Intro\n\n<!-- image -->\n\n<!-- image -->\n\n<!-- image -->"),
            markdownRange: { start: 0, end: 60 },
            placeholderBase: { picture: 0, formula: 0 },
          },
        ],
        figures: [picture(1), picture(2), picture(3)],
      },
    });
    const result = await publishFile(file, new Uint8Array([1]), { api, attachments, driveId: "d" });
    expect(uploaded).toHaveLength(2);
    expect(result.attached).toBe(false);
    expect(result.attachmentErrors).toBe(1);
    expect(result.attachError).toBe("Upload failed for original: Internal error; 1 figure: reserve 500");
  });

  it("keeps a figure's placeholder and finishes the publish when that figure cannot be hashed", async () => {
    const { api, calls } = publishApi();
    const attachments: AttachmentPort = {
      prepare: (f) =>
        f.name === "formula-1.png"
          ? Promise.reject(new Error("no crypto"))
          : Promise.resolve({ ref: `attachment://v1:${"a".repeat(64)}` }),
      upload: () => Promise.resolve(),
    };
    const file = convertedFile({
      selected: [true],
      converted: {
        filename: "Paper.pdf",
        format: "pdf",
        plan,
        sections: [
          {
            ...sec("Intro", "Intro\n\n<!-- formula-not-decoded -->"),
            markdownRange: { start: 0, end: 30 },
            placeholderBase: { picture: 0, formula: 0 },
          },
        ],
        figures: [
          {
            id: "formula-1",
            kind: "formula",
            page: 1,
            placeholderIndex: 0,
            alt: "formula 1",
            mimeType: "image/png",
            width: 1,
            height: 1,
            bytesBase64: "iVBORw0KGgo=",
          },
        ],
      },
    });

    const result = await publishFile(file, new Uint8Array([1]), {
      api,
      attachments,
      driveId: "d",
    });

    expect(sourceBodies(calls)[0].content).toContain(
      "<!-- formula-not-decoded -->",
    );
    expect(result.sourceIds).toHaveLength(1);
    expect(result.attached).toBe(true);
    expect(result.attachments).toBe(0);
    expect(result.attachmentErrors).toBe(1);
  });

  it("still publishes when there is no attachment port configured", async () => {
    // A vault whose attachment service is unavailable must still ingest the
    // content: a missing original is a degraded state, not a failed publish.
    const { api, calls } = publishApi();
    const result = await publishFile(convertedFile(), new Uint8Array([1]), {
      api,
      driveId: "d",
    });
    expect(result.attached).toBe(false);
    expect(calls.some((c) => c.path === "/actions")).toBe(false);
  });

  it("does not fail the publish when the attachment step fails — the sources exist and are queued", async () => {
    const { api } = publishApi();
    const attachments: AttachmentPort = {
      prepare: () =>
        Promise.reject(new Error("AttachmentClient not available")),
      upload: () => Promise.resolve(),
    };
    const result = await publishFile(convertedFile(), new Uint8Array([1]), {
      api,
      attachments,
      driveId: "d",
    });
    expect(result.sourceIds).toHaveLength(2);
    expect(result.attached).toBe(false);
    expect(result.attachError).toContain("AttachmentClient not available");
  });

  it("reports what it skipped, so the caller can say so", async () => {
    const { api } = publishApi();
    const result = await publishFile(
      convertedFile({
        converted: {
          filename: "Book.pdf",
          format: "pdf",
          plan,
          sections: [sec("Record", "first", []), sec("Blank", "  ", [])],
        },
      }),
      new Uint8Array([1]),
      { api, driveId: "d" },
    );
    expect(result.skipped).toBe(1);
    expect(result.sourceIds).toHaveLength(1);
  });

  it("creates nothing — not even the folder — when nothing is ticked", async () => {
    const { api, calls } = publishApi();
    const result = await publishFile(
      convertedFile({ selected: [false, false] }),
      new Uint8Array([1]),
      { api, driveId: "d" },
    );
    expect(calls).toHaveLength(0);
    expect(result.sourceIds).toEqual([]);
    expect(result.folderId).toBeNull();
  });

  it("reports a partial failure with what landed, rather than hiding it", async () => {
    // The third source refuses; the first two exist. The caller must be told
    // both, or a retry duplicates them.
    let n = 0;
    const api = {
      get: () => Promise.reject(new Error("no")),
      postRaw: () => Promise.reject(new Error("no")),
      post: (path: string) => {
        if (path === "/sources/batch") return Promise.reject(new VaultApiFailure(404, "UNKNOWN", "The vault refused the request (404)."));
        if (path === "/sources/folders")
          return Promise.resolve({ id: "folder-1", created: false });
        n++;
        if (n === 3) return Promise.reject(new Error("CREATE_FAILED"));
        return Promise.resolve({ id: `source-${n}` });
      },
    } as unknown as VaultApi;
    const three = convertedFile({
      selected: [true, true, true],
      converted: {
        filename: "Book.pdf",
        format: "pdf",
        plan,
        sections: [sec("A", "a"), sec("B", "b"), sec("C", "c")],
      },
    });
    const failure: PublishPartialFailure = await publishFile(
      three,
      new Uint8Array([1]),
      {
        api,
        driveId: "d",
      },
    ).then(
      () => {
        throw new Error("the publish did not fail");
      },
      (e: unknown) => e as PublishPartialFailure,
    );
    expect(failure).toBeInstanceOf(PublishPartialFailure);
    expect(failure.message).toContain("CREATE_FAILED");
    expect(failure.partial).toEqual({
      folderId: "folder-1",
      sourceIds: ["source-1", "source-2"],
      failedAt: 2,
    });
  });
});

// ---------------------------------------------------------------------------
// Withdrawing a conversion: the request's signal, and the service's job
// ---------------------------------------------------------------------------

import { cancelConversion } from "./intake-service.js";
import { VaultApiFailure } from "./vault-api.js";

describe("convertFile — withdrawing the request", () => {
  function signalApi() {
    const seen: { signal?: AbortSignal }[] = [];
    const api = {
      postRaw: (
        _path: string,
        _bytes: Uint8Array,
        options?: { contentType?: string; signal?: AbortSignal },
      ) => {
        seen.push({ signal: options?.signal });
        return Promise.resolve(summary);
      },
    } as unknown as VaultApi;
    return { api, seen };
  }

  it("hands the caller's signal to the upload, so removing the file stops it", async () => {
    const { api, seen } = signalApi();
    const controller = new AbortController();
    await convertFile(
      { name: "a.pdf", bytes: new Uint8Array([1]) },
      { api, signal: controller.signal },
    );
    expect(seen[0].signal).toBe(controller.signal);
  });

  it("sends no signal when the caller has none", async () => {
    const { api, seen } = signalApi();
    await convertFile({ name: "a.pdf", bytes: new Uint8Array([1]) }, { api });
    expect(seen[0].signal).toBeUndefined();
  });
});

describe("cancelConversion", () => {
  function deletingApi(answer: () => Promise<unknown>) {
    const paths: string[] = [];
    const api = {
      delete: (path: string) => {
        paths.push(path);
        return answer();
      },
    } as unknown as VaultApi;
    return { api, paths };
  }

  it("asks the vault to stop the job, and says it was running", async () => {
    const { api, paths } = deletingApi(() =>
      Promise.resolve({ cancelled: true }),
    );
    await expect(cancelConversion(api, "job-1")).resolves.toBe(true);
    expect(paths).toEqual(["/convert/job-1"]);
  });

  it("encodes the job id into the path", async () => {
    const { api, paths } = deletingApi(() =>
      Promise.resolve({ cancelled: true }),
    );
    await cancelConversion(api, "a b");
    expect(paths).toEqual(["/convert/a%20b"]);
  });

  it("treats 404 — finished already, or never started — as nothing left to stop", async () => {
    const { api } = deletingApi(() =>
      Promise.reject(
        new VaultApiFailure(404, "UNKNOWN", "The vault refused the request (404)."),
      ),
    );
    await expect(cancelConversion(api, "job-1")).resolves.toBe(false);
  });

  it("lets any other failure through, for the caller to decide", async () => {
    const { api } = deletingApi(() =>
      Promise.reject(new VaultApiFailure(0, "UNREACHABLE", "Could not reach the vault")),
    );
    await expect(cancelConversion(api, "job-1")).rejects.toMatchObject({
      code: "UNREACHABLE",
    });
  });
});

describe("publishFile — in batches", () => {
  const book = (n: number) =>
    convertedFile({
      selected: Array.from({ length: n }, () => true),
      converted: {
        filename: "Book.pdf",
        format: "pdf",
        plan,
        sections: Array.from({ length: n }, (_, i) => sec(`S${i + 1}`, `text ${i + 1}`)),
      },
    });

  /** A vault with `POST sources/batch`; `answer` shapes each batch's reply. */
  function batchApi(
    answer: (batch: number, sources: { title: string }[]) => Record<string, unknown>,
  ) {
    const batches: { drive: string; parentFolder: string; queue: boolean; sources: { title: string }[] }[] = [];
    const other: string[] = [];
    const api = {
      get: () => Promise.reject(new Error("not used")),
      postRaw: () => Promise.reject(new Error("not used")),
      post: (path: string, body: never) => {
        if (path === "/sources/folders") return Promise.resolve({ id: "folder-1", created: true });
        if (path !== "/sources/batch") {
          other.push(path);
          return Promise.resolve({});
        }
        batches.push(body);
        return Promise.resolve(answer(batches.length, (body as { sources: { title: string }[] }).sources));
      },
    } as unknown as VaultApi;
    return { api, batches, other };
  }

  it("sends 30 sections as a batch of 25 and one of 5, each source mapped back in order", async () => {
    const { api, batches, other } = batchApi((n, sources) => ({
      sources: sources.map((_, index) => ({
        index,
        id: `b${n}-${index}`,
        operations:
          n === 2 && index === 1
            ? [{ type: "INGEST_SOURCE", error: null }, { type: "ATTACH_ORIGINAL_FILE", error: "the ref is unknown" }]
            : [{ type: "INGEST_SOURCE", error: null }],
      })),
      ...(n === 2 ? { queueError: "the queue is locked" } : {}),
    }));
    const result = await publishFile(book(30), new Uint8Array([1]), { api, driveId: "d" });

    expect(batches.map((b) => b.sources.length)).toEqual([25, 5]);
    expect(batches.every((b) => b.drive === "d" && b.parentFolder === "folder-1" && b.queue)).toBe(true);
    expect(batches.flatMap((b) => b.sources.map((s) => s.title))).toEqual(
      Array.from({ length: 30 }, (_, i) => `S${i + 1}`),
    );
    expect(result.sourceIds).toEqual([
      ...Array.from({ length: 25 }, (_, i) => `b1-${i}`),
      ...Array.from({ length: 5 }, (_, i) => `b2-${i}`),
    ]);
    expect(result.attachError).toBe("1 source could not take its original: the ref is unknown");
    expect(result.queueError).toBe("5 sources could not be queued for processing: the queue is locked");
    expect(other).toEqual([]); // nothing went one source at a time
  });

  it("stops at a source the vault refuses, naming every source that landed before it", async () => {
    const { api } = batchApi((n, sources) =>
      n === 1
        ? { sources: sources.map((_, index) => ({ index, id: `b1-${index}` })) }
        : {
            sources: [{ index: 0, id: "b2-0" }, { index: 1, id: "b2-1" }],
            failure: { index: 2, code: "INGEST_REJECTED", message: "INGEST_SOURCE was rejected" },
          },
    );
    const failure = await publishFile(book(30), new Uint8Array([1]), { api, driveId: "d" }).then(
      () => {
        throw new Error("the publish did not fail");
      },
      (e: unknown) => e as PublishPartialFailure,
    );
    expect(failure).toBeInstanceOf(PublishPartialFailure);
    expect(failure.partial.sourceIds).toHaveLength(27);
    expect(failure.partial.sourceIds.slice(-2)).toEqual(["b2-0", "b2-1"]);
    expect(failure.partial.failedAt).toBe(27);
    expect(failure.message).toContain("source 28 of 30");
  });
});
