import { beforeEach, describe, expect, it, vi } from "vitest";

const { configure, get, stores } = vi.hoisted(() => {
  type FakeFile = { id: string; name: string; state: "queued" | "converted"; publishedIds?: string[] };
  const configure = vi.fn();
  /** The per-vault store, reduced: files in order, minted ids, listeners, and a publish that files a source. */
  function fakeStore() {
    const files: FakeFile[] = [];
    const listeners = new Set<() => void>();
    let minted = 0;
    const notify = () => listeners.forEach((listener) => listener());
    return {
      configure,
      add: (incoming: readonly { name: string }[]) => {
        for (const f of incoming) files.push({ id: `file-${++minted}`, name: f.name, state: "queued" });
        notify();
      },
      getSnapshot: () => ({ files: files.map((f) => ({ ...f })), publishing: false }),
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      publish: vi.fn(async (id: string) => {
        const file = files.find((f) => f.id === id)!;
        file.publishedIds = [`source-for-${id}`];
        notify();
      }),
      /** Test helper: the converter finished this file. */
      converted: (id: string) => {
        files.find((f) => f.id === id)!.state = "converted";
        notify();
      },
    };
  }
  const stores = new Map<string, ReturnType<typeof fakeStore>>();
  return {
    configure,
    get: vi.fn(),
    stores: {
      for(driveId: string) {
        let store = stores.get(driveId);
        if (!store) {
          store = fakeStore();
          stores.set(driveId, store);
        }
        return store;
      },
    },
  };
});

vi.mock("./attachments.js", () => ({
  attachmentPort: () => ({ prepare: vi.fn(), upload: vi.fn() }),
}));
vi.mock("./intake-store.js", () => ({
  intakeStoreFor: (driveId: string) => stores.for(driveId),
  pinnedVaultApi: () => ({ get }),
}));

import { hostIntake } from "./host-intake.js";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  configure.mockReset();
  get.mockReset();
  get.mockResolvedValue({ ok: true });
});

/** The desktop app's setup guide has no view reading the health, so the intake reads it itself. */
describe("hostIntake — the converter's lanes", () => {
  it("tells the batch how many files the converter takes at once, per lane", async () => {
    get.mockResolvedValue({
      ok: true,
      slots: { models: 1, other: 2, busyModels: 0, busyOther: 0 },
      modelExtensions: ["pdf", "png"],
    });
    hostIntake("drive-1");
    await settle();
    expect(get).toHaveBeenCalledWith("/convert/health");
    expect(configure).toHaveBeenCalledWith({
      models: 1,
      other: 2,
      modelExtensions: ["pdf", "png"],
    });
  });

  it("leaves the batch at one file at a time when the service reports no lanes", async () => {
    get.mockResolvedValue({ ok: true, formats: ["pdf"] });
    hostIntake("drive-1");
    await settle();
    expect(configure).not.toHaveBeenCalled();
  });

  it("is best effort: an unreadable health changes nothing and throws nothing", async () => {
    get.mockRejectedValue(new Error("Could not reach the vault"));
    expect(() => hostIntake("drive-1")).not.toThrow();
    await settle();
    expect(configure).not.toHaveBeenCalled();
  });
});

/** The store is the Sources view's too: what a host publishes on its own must be only what it added. */
describe("hostIntake — publishes only the files it added", () => {
  const file = (name: string) => new File(["%PDF"], name, { type: "application/pdf" });

  it("publishes a file it added as soon as it has converted", async () => {
    const store = stores.for("vault-a");
    const intake = hostIntake("vault-a");
    intake.add([file("guide.pdf")]);
    const stop = intake.publishAsConverted();
    store.converted("file-1");
    await settle();
    expect(store.publish).toHaveBeenCalledWith("file-1", expect.anything());
    stop();
  });

  it("leaves a file added in the vault's Sources view to its review, even while the host publishes", async () => {
    const store = stores.for("vault-b");
    const intake = hostIntake("vault-b");
    const stop = intake.publishAsConverted();
    store.add([{ name: "added-in-the-vault.pdf" }]); // the vault's own panel, not the host
    store.converted("file-1");
    await settle();
    expect(store.publish).not.toHaveBeenCalled();
    stop();
  });

  it("publishes a later batch the host adds through another intake for the same vault", async () => {
    const store = stores.for("vault-c");
    const stop = hostIntake("vault-c").publishAsConverted(); // the guide starts publishing once
    hostIntake("vault-c").add([file("second-batch.pdf")]); // and adds each batch through a new intake
    store.converted("file-1");
    await settle();
    expect(store.publish).toHaveBeenCalledWith("file-1", expect.anything());
    stop();
  });
});
