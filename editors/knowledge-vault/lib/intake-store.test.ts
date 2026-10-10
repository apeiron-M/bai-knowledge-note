import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  needsUser,
  type ConvertedFile,
  type KnownOriginal,
  type VaultIndex,
} from "./intake-model.js";
import {
  BUSY_RETRY_MS,
  CANCEL_GRACE_MS,
  CHECK_WAIT_MS,
  createIntakeStore,
  intakeStoreFor,
  PROGRESS_POLL_MS,
  sortOffered,
  type IncomingFile,
  type IntakeDeps,
  type LaneConfig,
} from "./intake-store.js";
import { PublishPartialFailure } from "./intake-service.js";
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
  const calls: {
    name: string;
    job: string;
    signal: AbortSignal;
    reply: Deferred<ConvertedFile>;
  }[] = [];
  const released: number[] = [];
  let held = 0;
  let jobs = 0;
  const deps: IntakeDeps = {
    convert: vi.fn(
      (
        input: { name: string; job: string },
        _api: VaultApi,
        signal: AbortSignal,
      ) => {
        const reply = deferred<ConvertedFile>();
        calls.push({ name: input.name, job: input.job, signal, reply });
        return reply.promise;
      },
    ),
    cancel: vi.fn(() => Promise.resolve(true)),
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
    // A ref per content: equal bytes, equal ref — as the real SHA-256 gives.
    originalRef: vi.fn((bytes: Uint8Array) =>
      Promise.resolve(`attachment://v1:${Buffer.from(bytes).toString("hex")}`),
    ),
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
    // A ready file waits on its row: the review covers the screen, so only
    // the person opens it.
    expect(store.getSnapshot().openId).toBeNull();

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
    expect(store.getSnapshot().files[0].publishError).toBeUndefined();
    expect(store.getSnapshot()).toMatchObject({
      publishing: false,
      publishingId: null,
    });
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
        "notes.xyz: the vault can't read .xyz files.",
      ],
    });
  });
});

const LANES: LaneConfig = {
  models: 1,
  other: 2,
  modelExtensions: ["pdf", "png", "jpg"],
};

/** The convert call's rejection when its own signal fired, as `VaultApi` reports it. */
const abortedFailure = () =>
  new VaultApiFailure(0, "ABORTED", "The request was cancelled before the vault answered.");

describe("intake store — lanes", () => {
  it("without lanes from the service, converts one file at a time whatever its format", () => {
    const { store, deps } = harness();
    store.add([bytesOf("a.pdf"), bytesOf("b.md")]);
    expect(states(store)).toEqual(["a.pdf:converting", "b.md:queued"]);
    expect(deps.convert).toHaveBeenCalledTimes(1);
  });

  it("fills each lane to its slots: a PDF converts while two Markdown files convert beside it, a second PDF waits", async () => {
    const { store, calls } = harness();
    store.configure(LANES);
    store.add([
      bytesOf("a.pdf"),
      bytesOf("b.md"),
      bytesOf("c.md"),
      bytesOf("d.pdf"),
      bytesOf("e.md"),
    ]);
    expect(states(store)).toEqual([
      "a.pdf:converting",
      "b.md:converting",
      "c.md:converting",
      "d.pdf:queued",
      "e.md:queued",
    ]);

    // A slot in the other lane goes to the next file of that lane only.
    calls[1].reply.resolve(converted("b.md"));
    await flush();
    expect(states(store)).toEqual([
      "a.pdf:converting",
      "b.md:converted",
      "c.md:converting",
      "d.pdf:queued",
      "e.md:converting",
    ]);

    calls[0].reply.resolve(converted("a.pdf"));
    await flush();
    expect(states(store)[3]).toBe("d.pdf:converting");
    expect(calls.map((c) => c.name)).toEqual([
      "a.pdf",
      "b.md",
      "c.md",
      "e.md",
      "d.pdf",
    ]);
  });

  it("keeps drop order within a lane, never size order", async () => {
    const { store, calls } = harness();
    store.configure({ models: 1, other: 1, modelExtensions: ["pdf"] });
    store.add([
      bytesOf("a.md", 10),
      bytesOf("b.pdf"),
      bytesOf("c.md", 9_000),
      bytesOf("d.md", 1),
    ]);
    expect(states(store)).toEqual([
      "a.md:converting",
      "b.pdf:converting",
      "c.md:queued",
      "d.md:queued",
    ]);

    calls[0].reply.resolve(converted("a.md"));
    await flush();
    // The big file dropped first goes first, though the small one would be quicker.
    expect(states(store).slice(2)).toEqual(["c.md:converting", "d.md:queued"]);
    calls[2].reply.resolve(converted("c.md"));
    await flush();
    expect(states(store)[3]).toBe("d.md:converting");
    expect(calls.map((c) => c.name)).toEqual(["a.md", "b.pdf", "c.md", "d.md"]);
  });

  it("does not let a busy models lane hold back a file of the other lane", async () => {
    const { store, calls } = harness();
    store.configure({ models: 1, other: 1, modelExtensions: ["pdf"] });
    store.add([bytesOf("a.pdf")]);
    calls[0].reply.reject(
      new VaultApiFailure(503, "CONVERT_BUSY", "a conversion is running"),
    );
    await flush();
    expect(store.getSnapshot().files[0]).toMatchObject({ state: "queued" });

    store.add([bytesOf("b.md"), bytesOf("c.pdf")]);
    // The models lane waits out the busy answer; the other lane does not.
    expect(states(store)).toEqual([
      "a.pdf:queued",
      "b.md:converting",
      "c.pdf:queued",
    ]);

    await vi.advanceTimersByTimeAsync(BUSY_RETRY_MS);
    expect(states(store)).toEqual([
      "a.pdf:converting",
      "b.md:converting",
      "c.pdf:queued",
    ]);
    expect(calls.map((c) => c.name)).toEqual(["a.pdf", "b.md", "a.pdf"]);
  });

  it("books a conversion that started before the lanes were known to its real lane", () => {
    const { store } = harness();
    store.add([bytesOf("a.pdf"), bytesOf("b.md"), bytesOf("c.pdf")]);
    expect(states(store)).toEqual([
      "a.pdf:converting",
      "b.md:queued",
      "c.pdf:queued",
    ]);

    store.configure({ models: 1, other: 1, modelExtensions: ["pdf"] });
    // a.pdf holds the models lane, so c.pdf waits; b.md takes the other lane.
    expect(states(store)).toEqual([
      "a.pdf:converting",
      "b.md:converting",
      "c.pdf:queued",
    ]);
  });

  it("never closes a lane: a count below one is read as one, and extensions are matched as the converter names them", () => {
    const { store } = harness();
    store.configure({
      models: 0,
      other: Number.NaN,
      modelExtensions: [".PDF"],
    });
    store.add([bytesOf("a.pdf"), bytesOf("b.md"), bytesOf("c.md")]);
    expect(states(store)).toEqual([
      "a.pdf:converting",
      "b.md:converting",
      "c.md:queued",
    ]);
  });
});

describe("intake store — stopping a conversion", () => {
  it("remove() of a converting file aborts its request, asks the service to stop its job, and fails nothing", async () => {
    const { store, deps, calls } = harness();
    store.add([bytesOf("a.pdf"), bytesOf("b.pdf")]);
    const [a] = store.getSnapshot().files;

    store.remove(a.id);
    expect(calls[0].signal.aborted).toBe(true);
    expect(deps.cancel).toHaveBeenCalledWith("job-1", api);

    // The withdrawn upload rejects the way the client reports it.
    calls[0].reply.reject(abortedFailure());
    await flush();
    expect(states(store)).toEqual(["b.pdf:converting"]);
    expect(store.getSnapshot().files.every((f) => f.error === undefined)).toBe(
      true,
    );
    expect(deps.cancel).toHaveBeenCalledTimes(1);
  });

  it("ignores the service's CONVERT_CANCELLED for a file that is gone", async () => {
    const { store, calls } = harness();
    store.add([bytesOf("a.pdf")]);
    store.remove(store.getSnapshot().files[0].id);
    calls[0].reply.reject(
      new VaultApiFailure(409, "CONVERT_CANCELLED", "The conversion was cancelled."),
    );
    await flush();
    expect(store.getSnapshot()).toMatchObject({ files: [], refused: [] });
  });

  it("fails a file whose conversion the batch did not stop, so Retry can send it again", async () => {
    // The service stopped the job on its own — not this batch's doing.
    const { store, calls } = harness();
    store.add([bytesOf("a.pdf")]);
    calls[0].reply.reject(
      new VaultApiFailure(409, "CONVERT_CANCELLED", "The conversion was cancelled."),
    );
    await flush();
    expect(store.getSnapshot().files[0]).toMatchObject({
      state: "failed",
      error: "The conversion was cancelled.",
    });
    store.retry(store.getSnapshot().files[0].id);
    expect(states(store)).toEqual(["a.pdf:converting"]);
  });

  it("keeps the stopped file's slot until the service has heard the cancel", async () => {
    // Freed sooner, the next file would meet a lane the service still counts
    // as busy, and wait out BUSY_RETRY_MS for nothing.
    const heard = deferred<boolean>();
    const { store, calls } = harness({ cancel: vi.fn(() => heard.promise) });
    store.add([bytesOf("a.pdf"), bytesOf("b.pdf")]);
    store.remove(store.getSnapshot().files[0].id);
    calls[0].reply.reject(abortedFailure());
    await flush();
    expect(states(store)).toEqual(["b.pdf:queued"]);

    heard.resolve(true);
    await flush();
    expect(states(store)).toEqual(["b.pdf:converting"]);
  });

  it("hands the slot on anyway once the cancel has hung for the grace period", async () => {
    const { store } = harness({
      cancel: vi.fn(() => new Promise<boolean>(() => {})),
    });
    store.add([bytesOf("a.pdf"), bytesOf("b.pdf")]);
    store.remove(store.getSnapshot().files[0].id);

    await vi.advanceTimersByTimeAsync(CANCEL_GRACE_MS - 1);
    expect(states(store)).toEqual(["b.pdf:queued"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(states(store)).toEqual(["b.pdf:converting"]);
  });

  it("hands the slot on when the cancel itself fails — the file is gone either way", async () => {
    const { store } = harness({
      cancel: vi.fn(() =>
        Promise.reject(new VaultApiFailure(0, "UNREACHABLE", "Could not reach the vault")),
      ),
    });
    store.add([bytesOf("a.pdf"), bytesOf("b.pdf")]);
    store.remove(store.getSnapshot().files[0].id);
    await flush();
    expect(states(store)).toEqual(["b.pdf:converting"]);
    expect(store.getSnapshot().files[0].error).toBeUndefined();
  });

  it("holds the page awake while a stopped conversion is still being cancelled", async () => {
    const heard = deferred<boolean>();
    const { store, released } = harness({
      cancel: vi.fn(() => heard.promise),
    });
    store.add([bytesOf("a.pdf")]);
    store.remove(store.getSnapshot().files[0].id);
    await flush();
    expect(released).toEqual([]);

    heard.resolve(true);
    await flush();
    expect(released).toEqual([1]);
  });

  it("does not stop anything for a file that was only queued", () => {
    const { store, deps, calls } = harness();
    store.add([bytesOf("a.pdf"), bytesOf("b.pdf")]);
    store.remove(store.getSnapshot().files[1].id);
    expect(deps.cancel).not.toHaveBeenCalled();
    expect(calls[0].signal.aborted).toBe(false);
    expect(states(store)).toEqual(["a.pdf:converting"]);
  });

  it("cancel() stops every conversion in flight, and sends nothing more", async () => {
    const { store, deps, calls } = harness();
    store.configure(LANES);
    store.add([
      bytesOf("a.pdf"),
      bytesOf("b.md"),
      bytesOf("c.md"),
      bytesOf("d.md"),
    ]);
    expect(calls).toHaveLength(3);

    store.cancel();
    expect(calls.map((c) => c.signal.aborted)).toEqual([true, true, true]);
    expect(vi.mocked(deps.cancel).mock.calls.map(([job]) => job)).toEqual([
      "job-1",
      "job-2",
      "job-3",
    ]);
    for (const call of calls) call.reply.reject(abortedFailure());
    await flush();
    expect(store.getSnapshot()).toMatchObject({
      files: [],
      requested: false,
      refused: [],
    });
    expect(deps.convert).toHaveBeenCalledTimes(3);
  });

  it("reset() stops every conversion in flight too", async () => {
    const { store, deps, calls } = harness();
    store.configure(LANES);
    store.add([bytesOf("a.pdf"), bytesOf("b.md")]);

    store.reset();
    expect(calls.map((c) => c.signal.aborted)).toEqual([true, true]);
    expect(deps.cancel).toHaveBeenCalledTimes(2);
    for (const call of calls) call.reply.reject(abortedFailure());
    await flush();
    expect(store.getSnapshot().files).toEqual([]);
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
      "a.pdf: it's already in this batch.",
      "empty.md: the file is empty.",
      "x.exe: the vault can't read .exe files.",
      "big.pdf: it's 31.0 MB, over the 30 MB limit for one file.",
      "b.md: it's already in this batch.",
    ]);
  });
});

describe("intakeStoreFor", () => {
  it("keeps one batch per drive for the life of the page", () => {
    expect(intakeStoreFor("drive-a")).toBe(intakeStoreFor("drive-a"));
    expect(intakeStoreFor("drive-a")).not.toBe(intakeStoreFor("drive-b"));
  });
});

describe("intake store — the review, Hide and adding", () => {
  /** Two files read and ready; the converter answered both. */
  async function twoReady(over: Partial<IntakeDeps> = {}) {
    const h = harness(over);
    h.store.add([bytesOf("a.pdf"), bytesOf("b.pdf")]);
    h.calls[0].reply.resolve(converted("a.pdf"));
    await flush();
    h.calls[1].reply.resolve(converted("b.pdf"));
    await flush();
    const [a, b] = h.store.getSnapshot().files;
    return { ...h, a, b };
  }

  it("opens a review only when asked, and closes it once its file is added", async () => {
    const { store, a } = await twoReady();
    expect(store.getSnapshot().openId).toBeNull();

    store.setOpenId(a.id);
    expect(store.getSnapshot().openId).toBe(a.id);
    await store.publish(a.id);
    // Added: the review closes and the row says so; the next file does not pop open.
    expect(store.getSnapshot().openId).toBeNull();
    expect(store.getSnapshot().files[0].publishedIds).toEqual(["s1", "s2"]);
  });

  it("closes the review when its file is sent back to be read as a scan", async () => {
    const { store, a } = await twoReady();
    store.setOpenId(a.id);
    store.runOcr(a.id);
    expect(store.getSnapshot().openId).toBeNull();
  });

  it("Hide folds the panel and the batch carries on; new files open it again", async () => {
    const { store, calls } = harness();
    store.add([bytesOf("a.pdf"), bytesOf("b.pdf")]);
    store.collapse();
    expect(store.getSnapshot().collapsed).toBe(true);

    calls[0].reply.resolve(converted("a.pdf"));
    await flush();
    expect(states(store)).toEqual(["a.pdf:converted", "b.pdf:converting"]);
    expect(store.getSnapshot().collapsed).toBe(true);

    store.add([bytesOf("c.pdf")]);
    expect(store.getSnapshot().collapsed).toBe(false);
    store.collapse();
    store.open(); // "Add sources" shows it too
    expect(store.getSnapshot().collapsed).toBe(false);
  });

  it("keeps a failed add on the file's row, and adding again clears it", async () => {
    const publish = vi
      .fn<IntakeDeps["publish"]>()
      .mockRejectedValueOnce(new Error("The vault did not answer."))
      .mockResolvedValue({
        folderId: "folder-1",
        folderCreated: true,
        sourceIds: ["s1"],
        skipped: 0,
        attached: true,
        attachments: 0,
        attachmentErrors: 0,
      });
    const { store, a } = await twoReady({ publish });

    await store.publish(a.id);
    let row = store.getSnapshot().files[0];
    expect(row.publishedIds).toBeUndefined();
    expect(row.publishError).toBe("The vault did not answer.");
    expect(store.getSnapshot().publishing).toBe(false);

    await store.publish(a.id);
    row = store.getSnapshot().files[0];
    expect(row.publishedIds).toEqual(["s1"]);
    expect(row.publishError).toBeUndefined();
  });

  it("records what landed when an add stops part-way, and never writes it twice", async () => {
    const publish = vi.fn<IntakeDeps["publish"]>(() =>
      Promise.reject(
        new PublishPartialFailure("the vault stopped answering", {
          folderId: "folder-1",
          sourceIds: ["s1"],
          failedAt: 1,
        }),
      ),
    );
    const { store, a } = await twoReady({ publish });

    await store.publish(a.id);
    await store.publish(a.id);
    const row = store.getSnapshot().files[0];
    expect(publish).toHaveBeenCalledTimes(1);
    expect(row.publishedIds).toEqual(["s1"]);
    expect(row.publishError).toBe(
      "Only 1 of 1 sections were added before it stopped: the vault stopped answering",
    );
  });

  it("adds every ready file in order, one at a time — skipping one with nothing kept, going on after a failure", async () => {
    const order: string[] = [];
    let running = 0;
    let overlap = false;
    const publish = vi.fn<IntakeDeps["publish"]>(async (file) => {
      running += 1;
      if (running > 1) overlap = true;
      order.push(file.name);
      await Promise.resolve();
      running -= 1;
      if (file.name === "b.pdf") throw new Error("no room");
      return {
        folderId: "f",
        folderCreated: true,
        sourceIds: [`${file.name}-1`],
        skipped: 0,
        attached: true,
        attachments: 0,
        attachmentErrors: 0,
      };
    });
    const { store, calls } = harness({ publish });
    store.add([bytesOf("a.pdf"), bytesOf("b.pdf"), bytesOf("c.pdf"), bytesOf("d.pdf")]);
    for (const [i, name] of ["a.pdf", "b.pdf", "c.pdf", "d.pdf"].entries()) {
      calls[i].reply.resolve(converted(name));
      await flush();
    }
    // d keeps nothing: it is left for the person.
    store.all(store.getSnapshot().files[3].id, false);

    await store.publishAll();
    expect(order).toEqual(["a.pdf", "b.pdf", "c.pdf"]);
    expect(overlap).toBe(false);
    const files = store.getSnapshot().files;
    expect(files.map((f) => f.publishedIds?.[0] ?? null)).toEqual([
      "a.pdf-1",
      null,
      "c.pdf-1",
      null,
    ]);
    expect(files[1].publishError).toBe("no room");
    expect(store.getSnapshot().publishingId).toBeNull();
  });

  it("forgets why files were refused once the person has read it", () => {
    const { store } = harness();
    const { accepted, refused } = sortOffered([new File(["x"], "a.xyz")], formats);
    store.add(accepted, refused);
    expect(store.getSnapshot().refused).toHaveLength(1);
    store.dismissRefused();
    expect(store.getSnapshot().refused).toEqual([]);
  });

  it("refuses a second copy of a file already in the batch, in plain words", () => {
    const { store } = harness();
    store.add([bytesOf("a.pdf", 1)]);
    const { refused } = sortOffered(
      [new File(["x"], "a.pdf")],
      formats,
      store.getSnapshot().files,
    );
    expect(refused).toEqual(["a.pdf: it's already in this batch."]);
  });
});

describe("intake store — files the vault already holds", () => {
  /** The harness's ref for some content: equal bytes, equal ref. */
  const refOf = (text: string) =>
    `attachment://v1:${Buffer.from(text).toString("hex")}`;
  const fileWith = (name: string, text: string): IncomingFile => ({
    name,
    size: text.length,
    mimeType: "application/pdf",
    data: new TextEncoder().encode(text),
  });
  const indexOf = (
    originals: [string, KnownOriginal][] = [],
    folders: string[] = [],
  ): VaultIndex => ({ originals: new Map(originals), folders: new Set(folders) });
  const earlier: KnownOriginal = {
    folderName: "Report",
    sources: 12,
    addedAt: "2026-10-08T09:00:00Z",
  };

  it("holds a file the vault already has, unread, and says where the earlier copy is", async () => {
    const { store, deps } = harness();
    store.setVault(indexOf([[refOf("report v1"), earlier]], ["Report"]));
    store.add([fileWith("Report.pdf", "report v1")]);
    await flush();
    const [file] = store.getSnapshot().files;
    expect(file.state).toBe("duplicate");
    expect(file.known).toEqual(earlier);
    expect(deps.convert).not.toHaveBeenCalled();
    expect(needsUser(store.getSnapshot().files)).toBe(1);
  });

  it("recognises it by its content, whatever it is called now", async () => {
    const { store } = harness();
    store.setVault(indexOf([[refOf("report v1"), earlier]], ["Report"]));
    store.add([fileWith("Copy of the report (final).pdf", "report v1")]);
    await flush();
    expect(store.getSnapshot().files[0]).toMatchObject({
      state: "duplicate",
      known: earlier,
    });
  });

  it("Add again reads it, into a folder of its own", async () => {
    const { store, deps } = harness();
    store.setVault(indexOf([[refOf("report v1"), earlier]], ["Report"]));
    store.add([fileWith("Report.pdf", "report v1")]);
    await flush();
    store.addAgain(store.getSnapshot().files[0].id);
    await flush();
    expect(states(store)).toEqual(["Report.pdf:converting"]);
    expect(deps.convert).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().files[0]).toMatchObject({
      check: "clear",
      addAgain: true,
      folderName: "Report (2)",
      renamedFrom: "Report",
    });
  });

  it("gives a different file whose name is taken a folder of its own", async () => {
    const { store } = harness();
    store.setVault(indexOf([], ["Report", "Report (2)"]));
    store.add([fileWith("Report.pdf", "report v2")]);
    await flush();
    expect(states(store)).toEqual(["Report.pdf:converting"]);
    expect(store.getSnapshot().files[0]).toMatchObject({
      check: "clear",
      folderName: "Report (3)",
      renamedFrom: "Report",
    });
  });

  it("holds the second of two identical files in one batch, and keeps two same-named files apart", async () => {
    const { store, calls } = harness();
    store.setVault(indexOf());
    store.add([
      fileWith("Report.pdf", "same"),
      fileWith("Copy.pdf", "same"),
      fileWith("Report.md", "different"),
    ]);
    await flush();
    calls[0].reply.resolve(converted("Report.pdf"));
    await flush();
    const [first, copy, notes] = store.getSnapshot().files;
    expect(first.folderName).toBe("Report");
    expect(copy).toMatchObject({
      state: "duplicate",
      known: { inBatch: "Report.pdf", sources: 0, folderName: null },
    });
    expect(notes).toMatchObject({ folderName: "Report (2)", renamedFrom: "Report" });
  });

  it("waits for the vault's answer before reading a file — and reads it as soon as the answer comes", async () => {
    const { store, deps } = harness();
    store.expectVault();
    expect(store.getSnapshot().checking).toBe(true);
    store.add([fileWith("a.pdf", "a")]);
    await flush();
    // Hashed while it waits, not read.
    expect(states(store)).toEqual(["a.pdf:queued"]);
    expect(store.getSnapshot().files[0].originalRef).toBe(refOf("a"));
    expect(deps.convert).not.toHaveBeenCalled();

    store.setVault(null); // the Sources view is still loading
    await flush();
    expect(states(store)).toEqual(["a.pdf:queued"]);

    store.setVault(indexOf());
    await flush();
    expect(states(store)).toEqual(["a.pdf:converting"]);
    expect(store.getSnapshot().files[0].check).toBe("clear");
  });

  it("reads it unchecked rather than hold it, when no answer comes in time", async () => {
    const { store } = harness();
    store.expectVault();
    store.add([fileWith("a.pdf", "a")]);
    await vi.advanceTimersByTimeAsync(CHECK_WAIT_MS - 100);
    expect(states(store)).toEqual(["a.pdf:queued"]);
    await vi.advanceTimersByTimeAsync(100);
    expect(states(store)).toEqual(["a.pdf:converting"]);
    expect(store.getSnapshot().files[0].check).toBe("skipped");
  });

  it("gives every new drop the full wait", async () => {
    const { store } = harness();
    store.expectVault();
    await vi.advanceTimersByTimeAsync(CHECK_WAIT_MS * 3); // nothing dropped for a while
    store.add([fileWith("a.pdf", "a")]);
    await flush();
    expect(states(store)).toEqual(["a.pdf:queued"]);
  });

  it("recognises a file added earlier this session, before the vault's own list has caught up", async () => {
    const { store, calls } = harness();
    store.setVault(indexOf());
    store.add([fileWith("Report.pdf", "r")]);
    await flush();
    calls[0].reply.resolve(converted("Report.pdf"));
    await flush();
    await store.publish(store.getSnapshot().files[0].id);
    store.reset(); // Done
    store.add([fileWith("Report.pdf", "r")]);
    await flush();
    expect(store.getSnapshot().files[0]).toMatchObject({
      state: "duplicate",
      known: { folderName: "Report", sources: 2 },
    });
  });

  it("reads a file it cannot hash, rather than hold it", async () => {
    const { store } = harness({
      originalRef: vi.fn(() => Promise.reject(new Error("no crypto here"))),
    });
    store.setVault(indexOf());
    store.add([fileWith("a.pdf", "a")]);
    await flush();
    expect(states(store)).toEqual(["a.pdf:converting"]);
    expect(store.getSnapshot().files[0].check).toBe("skipped");
  });

  it("checks nothing, and reads at once, when no view will say what the vault holds", () => {
    const { store, deps } = harness();
    store.add([fileWith("a.pdf", "a")]);
    expect(states(store)).toEqual(["a.pdf:converting"]);
    expect(deps.originalRef).not.toHaveBeenCalled();
    expect(store.getSnapshot().checking).toBe(false);
  });

  it("hashes one file at a time, and stops checking a file that is removed", async () => {
    const first = deferred<string>();
    let calls = 0;
    const { store } = harness({
      originalRef: vi.fn((bytes: Uint8Array) => {
        calls += 1;
        return calls === 1
          ? first.promise
          : Promise.resolve(`attachment://v1:${Buffer.from(bytes).toString("hex")}`);
      }),
    });
    store.setVault(indexOf());
    store.add([fileWith("a.pdf", "a"), fileWith("b.md", "b")]);
    await flush();
    expect(calls).toBe(1);
    store.remove(store.getSnapshot().files[0].id);
    first.resolve(refOf("a"));
    await flush();
    expect(calls).toBe(2);
    expect(states(store)).toEqual(["b.md:converting"]);
  });
});
