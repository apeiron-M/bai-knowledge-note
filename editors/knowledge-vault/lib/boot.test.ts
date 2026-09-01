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

async function bootWith(sync: ReturnType<typeof makeSync>) {
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("ph", {
    reactorClientModule: {
      reactorModule: { syncModule: { syncManager: sync } },
    },
  });
  const { startRemoteFirstBoot } = await import("./boot.js");
  startRemoteFirstBoot();
  // The immediate sweep kicks off adopt(); flush its promise chain.
  await vi.advanceTimersByTimeAsync(5);
}

describe("startRemoteFirstBoot / adopt", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
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

  it("NON-VAULT DRIVE: is left entirely alone", async () => {
    stubVaultLookup("some-other-app");
    const sync = makeSync(makeRemote(["*"]));
    await bootWith(sync);

    expect(enableRemoteFirstMock).not.toHaveBeenCalled();
    expect(sync.remove).not.toHaveBeenCalled();
    expect(sync.add).not.toHaveBeenCalled();
    expect(setDrivesMock).not.toHaveBeenCalled();
  });
});
