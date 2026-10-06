/**
 * Regression tests for the package-load remote-first bootstrap.
 *
 * The bug these exist for: `addRemoteDrive` never writes a local drive
 * document (the document normally arrives via replication), and boot.ts
 * neutralises the sync channel before the first envelope lands — so the
 * ONLY thing that ever makes the drive visible is `hydrateDriveSnapshot`
 * writing the in-memory `ph.drives` snapshot. The sync manager persists
 * remote registrations and recreates them at startup ("recreates all
 * remotes from storage" — ISyncManager.startup), which means on every
 * warm start `adopt()` sees an already-neutralised channel. Returning
 * early from that branch — as the code originally did — skips hydration
 * and the drive vanishes from Connect until the user clears site data
 * and re-adds it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const DRIVE_ID = "c5893e1b-0000-4000-8000-000000000000";
const SENTINEL = "remote-first-sync-nothing";
const VAULT_APP = "knowledge-vault";

const enableRemoteFirstMock = vi.hoisted(() => vi.fn());
const resolveReactorEndpointMock = vi.hoisted(() =>
  vi.fn(() => "http://switchboard.test/graphql"),
);
const setDrivesMock = vi.hoisted(() => vi.fn());
const forDriveMock = vi.hoisted(() =>
  vi.fn((driveId: string, branch: string) => ({ driveId, branch })),
);

vi.mock("./remote-first.js", () => ({
  enableRemoteFirst: enableRemoteFirstMock,
}));
vi.mock("../hooks/subgraph-endpoint.js", () => ({
  resolveReactorEndpoint: resolveReactorEndpointMock,
}));
vi.mock("@powerhousedao/reactor-browser", () => ({
  setDrives: setDrivesMock,
  DriveCollectionId: { forDrive: forDriveMock },
}));

type FakeRemote = {
  meta: {
    id?: string;
    name: string;
    collectionId: { driveId?: string };
    filter: { documentId: string[]; scope?: string[]; branch?: string };
    channelConfig: unknown;
    options: unknown;
  };
};

function makeRemote(documentId: string[]): FakeRemote {
  return {
    meta: {
      name: "remote-1",
      collectionId: { driveId: DRIVE_ID },
      filter: { documentId, scope: ["global"], branch: "main" },
      channelConfig: { type: "gql" },
      options: undefined,
    },
  };
}

function makeSync(remote: FakeRemote) {
  return {
    list: vi.fn(() => [remote]),
    remove: vi.fn((..._args: unknown[]) => Promise.resolve()),
    add: vi.fn((..._args: unknown[]) => Promise.resolve()),
  };
}

function stubVaultLookup(preferredEditor: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            data: { document: { document: { preferredEditor } } },
          }),
      }),
    ),
  );
}

/**
 * The real setTimeout, captured before any test installs fake timers. The
 * channel id is derived with `crypto.subtle.digest`, which completes on Node's
 * thread pool in real time — a fake-timer flush alone does not wait for it.
 */
const realSetTimeout = globalThis.setTimeout;
const realTick = (ms: number) => new Promise((done) => realSetTimeout(done, ms));

/** A localStorage that outlives vi.resetModules(), as a real browser's does across reloads. */
const browserStore = new Map<string, string>();

async function bootWith(
  sync: ReturnType<typeof makeSync>,
  address: string | null = "0xabc",
) {
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => browserStore.get(k) ?? null,
    setItem: (k: string, v: string) => void browserStore.set(k, v),
    removeItem: (k: string) => void browserStore.delete(k),
  });
  vi.stubGlobal("ph", {
    renown: { user: address ? { address } : undefined },
    reactorClientModule: {
      reactorModule: { syncModule: { syncManager: sync } },
    },
  });
  const { startRemoteFirstBoot } = await import("./boot.js");
  startRemoteFirstBoot();
  // The immediate sweep kicks off adopt(); flush its promise chain, letting the
  // real-time digest inside it complete between flushes.
  for (let i = 0; i < 4; i++) {
    await vi.advanceTimersByTimeAsync(5);
    await realTick(5);
  }
}

describe("startRemoteFirstBoot / adopt", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    browserStore.clear();
    enableRemoteFirstMock.mockReturnValue({
      remoteClient: {
        get: vi.fn(() =>
          Promise.resolve({
            header: { id: DRIVE_ID, meta: { preferredEditor: VAULT_APP } },
          }),
        ),
      },
      restore: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("WARM START: hydrates the drive snapshot even when the channel is already neutralised", async () => {
    stubVaultLookup(VAULT_APP);
    const sync = makeSync(makeRemote([SENTINEL]));
    await bootWith(sync);

    // The channel is already scoped to the sentinel: it must NOT be
    // re-registered...
    expect(sync.remove).not.toHaveBeenCalled();
    expect(sync.add).not.toHaveBeenCalled();

    // ...but the drive snapshot MUST still be hydrated — nothing about
    // this drive is persisted locally, so skipping hydration here leaves
    // Connect with an empty sidebar (the disappearing-drive bug).
    expect(setDrivesMock).toHaveBeenCalled();
    const drives = setDrivesMock.mock.calls.at(-1)?.[0] as {
      header: { id: string; meta?: { preferredEditor?: string } };
    }[];
    expect(drives.map((d) => d.header.id)).toContain(DRIVE_ID);
    expect(
      drives.find((d) => d.header.id === DRIVE_ID)?.header.meta
        ?.preferredEditor,
    ).toBe(VAULT_APP);
  });

  it("COLD ADD: neutralises the channel under the sentinel filter, then hydrates", async () => {
    stubVaultLookup(VAULT_APP);
    const sync = makeSync(makeRemote(["*"]));
    await bootWith(sync);

    expect(sync.remove).toHaveBeenCalledWith("remote-1");
    expect(sync.add).toHaveBeenCalledTimes(1);
    const filter = sync.add.mock.calls[0]?.[3] as { documentId: string[] };
    expect(filter.documentId).toEqual([SENTINEL]);

    expect(setDrivesMock).toHaveBeenCalled();
    const drives = setDrivesMock.mock.calls.at(-1)?.[0] as {
      header: { id: string };
    }[];
    expect(drives.map((d) => d.header.id)).toContain(DRIVE_ID);
  });

  it("COLD ADD: re-adds under a stable channel id, so no new server remote leaks per session", async () => {
    stubVaultLookup(VAULT_APP);
    const sync = makeSync(makeRemote(["*"]));
    await bootWith(sync);
    const id = sync.add.mock.calls[0]?.[5];
    expect(typeof id).toBe("string");

    // A second page load in the same browser, same account: the same id.
    vi.resetModules();
    const again = makeSync(makeRemote(["*"]));
    await bootWith(again);
    expect(again.add.mock.calls[0]?.[5]).toBe(id);
  });

  it("CLEARED SITE DATA: re-adding the drive lands on the same channel id", async () => {
    stubVaultLookup(VAULT_APP);
    const sync = makeSync(makeRemote(["*"]));
    await bootWith(sync);
    const id = sync.add.mock.calls[0]?.[5];

    // The user clears app data (localStorage and all) and re-adds the drive.
    browserStore.clear();
    vi.resetModules();
    const readded = makeSync(makeRemote(["*"]));
    await bootWith(readded);
    expect(readded.add.mock.calls[0]?.[5]).toBe(id);
  });

  it("WARM START: adopts the working channel's id, so a later re-add reuses its server remote", async () => {
    stubVaultLookup(VAULT_APP);
    const scoped = makeRemote([SENTINEL]);
    scoped.meta.id = "server-remote-7";
    await bootWith(makeSync(scoped));

    vi.resetModules();
    const cold = makeSync(makeRemote(["*"]));
    await bootWith(cold);
    expect(cold.add.mock.calls[0]?.[5]).toBe("server-remote-7");
  });

  it("SIGNED OUT: passes no id, leaving sync.add's own behaviour unchanged", async () => {
    stubVaultLookup(VAULT_APP);
    const sync = makeSync(makeRemote(["*"]));
    await bootWith(sync, null);
    expect(sync.add).toHaveBeenCalledTimes(1);
    expect(sync.add.mock.calls[0]?.[5]).toBeUndefined();
  });

  it("NON-VAULT DRIVE: is left entirely alone", async () => {
    stubVaultLookup("some-other-app");
    const sync = makeSync(makeRemote(["*"]));
    await bootWith(sync);

    expect(enableRemoteFirstMock).not.toHaveBeenCalled();
    expect(sync.remove).not.toHaveBeenCalled();
    expect(sync.add).not.toHaveBeenCalled();
    expect(setDrivesMock).not.toHaveBeenCalled();
  });
  it("DESKTOP HOST: does nothing — no sync listing, no Switchboard probe", async () => {
    (globalThis as Record<string, unknown>).__knowledgeVaultHost = {
      kind: "desktop",
      switchboardOrigin: "http://127.0.0.1:4201",
    };
    try {
      stubVaultLookup(VAULT_APP);
      const sync = makeSync(makeRemote([]));
      await bootWith(sync);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(sync.list).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      expect(enableRemoteFirstMock).not.toHaveBeenCalled();
    } finally {
      delete (globalThis as Record<string, unknown>).__knowledgeVaultHost;
    }
  });

  it("BACKOFF: an unreachable Switchboard is probed with exponential delay, not every tick", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("ECONNREFUSED"))),
    );
    const sync = makeSync(makeRemote([]));
    await bootWith(sync);
    // 400 ms polling would make ~25 attempts in 10 s; backoff (0, 1, 3, 7 s) makes 4.
    await vi.advanceTimersByTimeAsync(10_000);
    const attempts = (fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    expect(attempts).toBeGreaterThanOrEqual(3);
    expect(attempts).toBeLessThanOrEqual(5);
  });
});
