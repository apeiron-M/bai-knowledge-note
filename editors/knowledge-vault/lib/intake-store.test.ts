import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConvertedFile } from "./intake-model.js";
import {
  BUSY_RETRY_MS,
  createIntakeStore,
  intakeStoreFor,
  PROGRESS_POLL_MS,
  sortOffered,
  type IncomingFile,
  type IntakeDeps,
} from "./intake-store.js";
import { VaultApiFailure, type VaultApi } from "./vault-api.js";

const api = {} as VaultApi;
const formats = ["pdf", "md"];

const converted = (name: string): ConvertedFile => ({
  filename: name,
  format: "pdf",
  sections: [
    {
      title: "Part one",
      headingPath: ["Part one"],
      text: "Body.",
      content: "Body.",
      charCount: 5,
      chunks: [0],
      mergedFrom: [],
      markdownRange: null,
    },
  ],
  plan: {
    cutLevel: 1,
    splitSections: 0,
    mergedSections: 0,
    rejoinedSections: 0,
    minSectionChars: 0,
  },
});

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A converter the test answers by hand, one call at a time. */
function harness(over: Partial<IntakeDeps> = {}) {
  const calls: { name: string; job: string; reply: Deferred<ConvertedFile> }[] =
    [];
  const released: number[] = [];
  let held = 0;
  let jobs = 0;
  const deps: IntakeDeps = {
    convert: vi.fn((input: { name: string; job: string }) => {
      const reply = deferred<ConvertedFile>();
      calls.push({ name: input.name, job: input.job, reply });
      return reply.promise;
    }),
    progress: vi.fn(() =>
      Promise.resolve({
        phase: "reading" as const,
        pages: 10,
        pagesDone: 3,
        elapsedMs: 1000,
      }),
    ),
    publish: vi.fn(() =>
      Promise.resolve({
        folderId: "folder-1",
        folderCreated: true,
        sourceIds: ["s1", "s2"],
        skipped: 0,
        attached: true,
        attachments: 0,
        attachmentErrors: 0,
      }),
    ),
    attach: vi.fn(() => Promise.resolve({ attached: true })),
    now: () => Date.now(),
    jobId: () => `job-${++jobs}`,
    isHidden: () => false,
    keepAlive: vi.fn(() => {
      held++;
      const n = held;
      return () => released.push(n);
    }),
    ...over,
  };
  const store = createIntakeStore({ driveId: "drive-1", api, deps });
  return { store, deps, calls, released, held: () => held };
}

const bytesOf = (name: string, size = 4): IncomingFile => ({
  name,
  size,
  mimeType: "application/pdf",
  data: new Uint8Array(size),
});

const flush = () => vi.advanceTimersByTimeAsync(0);
const states = (store: ReturnType<typeof harness>["store"]) =>
  store.getSnapshot().files.map((f) => `${f.name}:${f.state}`);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("intake store", () => {
  it("takes more files while one converts, and converts them in turn", async () => {
    const { store, deps, calls } = harness();

    store.add([bytesOf("a.pdf")]);
    expect(states(store)).toEqual(["a.pdf:converting"]);

    // File N+1 joins at once — it does not wait for the conversion.
    store.add([bytesOf("b.pdf"), bytesOf("c.pdf")]);
    expect(states(store)).toEqual([
      "a.pdf:converting",
      "b.pdf:queued",
      "c.pdf:queued",
    ]);
    expect(deps.convert).toHaveBeenCalledTimes(1);

    calls[0].reply.resolve(converted("a.pdf"));
    await flush();
    expect(states(store)).toEqual([
      "a.pdf:converted",
      "b.pdf:converting",
      "c.pdf:queued",
    ]);
    // The first file that is ready opens for review by itself.
    expect(store.getSnapshot().openId).toBe(store.getSnapshot().files[0].id);

    calls[1].reply.resolve(converted("b.pdf"));
    await flush();
    calls[2].reply.resolve(converted("c.pdf"));
    await flush();
    expect(states(store)).toEqual([
      "a.pdf:converted",
      "b.pdf:converted",
      "c.pdf:converted",
    ]);
    expect(calls.map((c) => c.name)).toEqual(["a.pdf", "b.pdf", "c.pdf"]);
  });

  it("shows every picked file at once and reads their bytes in the background", async () => {
    const { store, calls } = harness();
    const files = [
      new File([new Uint8Array([1, 2, 3])], "one.pdf", {
        type: "application/pdf",
      }),
      new File([new Uint8Array([4, 5])], "two.md", { type: "text/markdown" }),
    ];

    const { accepted, refused } = sortOffered(files, formats);
    store.add(accepted, refused);
    // Rows exist before a single byte is read.
    expect(states(store)).toEqual(["one.pdf:queued", "two.md:queued"]);
    expect(store.getSnapshot().requested).toBe(true);

    await flush();
    expect(states(store)).toEqual(["one.pdf:converting", "two.md:queued"]);
    calls[0].reply.resolve(converted("one.pdf"));
    await flush();
    expect(states(store)).toEqual(["one.pdf:converted", "two.md:converting"]);
  });

  it("keeps converting with nobody listening — the view can unmount", async () => {
    const { store, calls } = harness();
    const seen: number[] = [];
    const unsubscribe = store.subscribe(() => seen.push(1));

    store.add([bytesOf("a.pdf"), bytesOf("b.pdf")]);
    unsubscribe(); // the explorer unmounts: Settings, another drive, another vault

    calls[0].reply.resolve(converted("a.pdf"));
    await flush();
    calls[1].reply.resolve(converted("b.pdf"));
    await flush();

    // The next mount reads the same batch back, finished.
    expect(states(store)).toEqual(["a.pdf:converted", "b.pdf:converted"]);
    expect(seen.length).toBeGreaterThan(0);
  });

  it("waits before asking a busy converter again, and says why the file waits", async () => {
    const { store, deps, calls } = harness();
    store.add([bytesOf("a.pdf")]);

    calls[0].reply.reject(
      new VaultApiFailure(503, "CONVERT_BUSY", "a conversion is running"),
    );
    await flush();
    const row = store.getSnapshot().files[0];
    expect(row.state).toBe("queued");
    expect(row.error).toMatch(/busy/);

    // No hammering: nothing is sent until the wait is over.
    await vi.advanceTimersByTimeAsync(BUSY_RETRY_MS - 100);
    expect(deps.convert).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(deps.convert).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().files[0]).toMatchObject({
      state: "converting",
      error: undefined,
    });
  });

  it("fails a file on any other error, and Retry queues it again", async () => {
    const { store, calls } = harness();
    store.add([bytesOf("a.pdf")]);
    calls[0].reply.reject(new Error("unsupported layout"));
    await flush();
    expect(store.getSnapshot().files[0]).toMatchObject({
      state: "failed",
      error: "unsupported layout",
    });

    store.retry(store.getSnapshot().files[0].id);
    expect(states(store)).toEqual(["a.pdf:converting"]);
  });

  it("polls measured progress while visible, and not while the page is hidden", async () => {
    let hidden = false;
    const { store, deps } = harness({ isHidden: () => hidden });
    store.add([bytesOf("a.pdf")]);

    await vi.advanceTimersByTimeAsync(PROGRESS_POLL_MS);
    expect(deps.progress).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().files[0].progress).toMatchObject({
      pagesDone: 3,
    });

    hidden = true;
    await vi.advanceTimersByTimeAsync(PROGRESS_POLL_MS * 5);
    expect(deps.progress).toHaveBeenCalledTimes(1);
  });

  it("holds the page awake while there is work, and lets go when there is none", async () => {
    const { store, deps, calls, released } = harness();
    store.add([bytesOf("a.pdf"), bytesOf("b.pdf")]);
    expect(deps.keepAlive).toHaveBeenCalledTimes(1);

    calls[0].reply.resolve(converted("a.pdf"));
    await flush();
    expect(released).toEqual([]);
    calls[1].reply.resolve(converted("b.pdf"));
    await flush();
    expect(released).toEqual([1]);

    // Review is the user's pace, not work in flight: no lock while waiting for them.
    expect(deps.keepAlive).toHaveBeenCalledTimes(1);
  });

  it("marks a file failed when its bytes cannot be read, and reads again on Retry", async () => {
    const { store } = harness();
    let fail = true;
    const blob = {
      arrayBuffer: () =>
        fail
          ? Promise.reject(new Error("the file moved"))
          : Promise.resolve(new ArrayBuffer(3)),
    } as unknown as Blob;
    store.add([
      { name: "a.pdf", size: 3, mimeType: "application/pdf", data: blob },
    ]);
    await flush();
    expect(store.getSnapshot().files[0]).toMatchObject({
      state: "failed",
      error: "Could not read the file: the file moved",
    });

    fail = false;
    store.retry(store.getSnapshot().files[0].id);
    await flush();
    expect(states(store)).toEqual(["a.pdf:converting"]);
  });

  it("cancel drops what is not in the vault, and a late conversion result is ignored", async () => {
    const { store, calls } = harness();
    store.add([bytesOf("a.pdf"), bytesOf("b.pdf")]);
    store.cancel();
    expect(store.getSnapshot()).toMatchObject({ files: [], requested: false });

    calls[0].reply.resolve(converted("a.pdf"));
    await flush();
    expect(store.getSnapshot().files).toEqual([]);
  });

  it("publishes a reviewed file once, and records what landed", async () => {
    const { store, deps, calls } = harness();
    store.add([bytesOf("a.pdf")]);
    calls[0].reply.resolve(converted("a.pdf"));
    await flush();
    const id = store.getSnapshot().files[0].id;

    await store.publish(id);
    await store.publish(id); // a second click must not create a second set
    expect(deps.publish).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().files[0].publishedIds).toEqual(["s1", "s2"]);
    expect(store.getSnapshot().notice).toMatchObject({ kind: "ok" });
    expect(store.getSnapshot().publishing).toBe(false);
  });

  it("opens the panel to say why, even when every file is refused", () => {
    const { store } = harness();
    const { accepted, refused } = sortOffered(
      [new File(["x"], "notes.xyz")],
      formats,
    );
    store.add(accepted, refused);
    expect(store.getSnapshot()).toMatchObject({
      files: [],
      requested: true,
      refused: [
        "notes.xyz: .xyz is not one of the formats the converter reads.",
      ],
    });
  });
});

describe("sortOffered", () => {
  it("refuses unknown formats, empty and oversized files, and copies already in the batch", () => {
    const big = { name: "big.pdf", size: 31 * 1024 * 1024, type: "" } as File;
    const { accepted, refused } = sortOffered(
      [
        new File(["a"], "a.pdf"),
        new File(["a"], "a.pdf"), // the same file twice in one drop
        new File([""], "empty.md"),
        new File(["x"], "x.exe"),
        big,
        new File(["bb"], "b.md"),
      ],
      formats,
      [
        {
          id: "1",
          name: "b.md",
          size: 2,
          mimeType: "text/markdown",
          state: "queued",
          sourceType: "ARTICLE",
          folderName: "b",
          selected: [],
        },
      ],
    );
    expect(accepted.map((f) => f.name)).toEqual(["a.pdf"]);
    expect(accepted[0].mimeType).toBe("application/octet-stream");
    expect(refused).toEqual([
      "a.pdf: already in this batch.",
      "empty.md: “empty.md” is empty.",
      "x.exe: .exe is not one of the formats the converter reads.",
      "big.pdf: 31.0 MB is over the 30 MB limit for one document.",
      "b.md: already in this batch.",
    ]);
  });
});

describe("intakeStoreFor", () => {
  it("keeps one batch per drive for the life of the page", () => {
    expect(intakeStoreFor("drive-a")).toBe(intakeStoreFor("drive-a"));
    expect(intakeStoreFor("drive-a")).not.toBe(intakeStoreFor("drive-b"));
  });
});
