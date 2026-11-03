/**
 * Connect 6.2.3-dev.90 resolves the node a URL opens through
 * `reactorClient.read.drives` and dispatches every editor write through
 * `reactorClient.write.execute`, the client halves of 6.2.3-dev.85. In
 * remote-first mode (Connect replicating, the vault's channel neutralised) both
 * must reach the Switchboard: on the local replica the router finds no node and
 * drops it from the URL (a source "opens" and closes in under a second), and a
 * write lands where nothing syncs it.
 *
 * These run the reactor-browser functions Connect itself calls (`getDriveNode`,
 * `loadDriveNodes`, `dispatchActions`) against the client `enableRemoteFirst`
 * installs, so a Connect that moves these calls again fails here instead of on
 * knowledge-vault.vetra.io. Only the network client is replaced.
 */
import type * as ReactorBrowser from "@powerhousedao/reactor-browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Call = { half: string; method: string; args: unknown[] };
const remoteCalls = vi.hoisted(() => [] as Call[]);
const announce = vi.hoisted(() => vi.fn());

const VAULT = "vault-drive";
const SOURCE = { id: "src-1", name: "CD Weekly Demo", kind: "file", documentType: "bai/source", parentFolder: null };
const sourceDocument = {
  header: { id: "src-1", documentType: "bai/source", branch: "main", revision: { global: 3 } },
  state: { global: {} },
  operations: { global: [] },
};

vi.mock("@powerhousedao/reactor-browser", async (importOriginal) => {
  const real = await importOriginal<typeof ReactorBrowser>();
  /** The Switchboard as the vault's GraphQL client reaches it: it holds the vault's nodes and documents. */
  class FakeSwitchboardClient {
    private record = (half: string, method: string, args: unknown[]) => remoteCalls.push({ half, method, args });
    get = vi.fn((...args: unknown[]) => Promise.resolve((this.record("", "get", args), sourceDocument)));
    getOperations = vi.fn((...args: unknown[]) => Promise.resolve((this.record("", "getOperations", args), { results: [] })));
    read = {
      get: (...args: unknown[]) => Promise.resolve((this.record("read", "get", args), sourceDocument)),
      getOperations: (...args: unknown[]) => Promise.resolve((this.record("read", "getOperations", args), { results: [] })),
      drives: {
        getNode: (...args: unknown[]) => Promise.resolve((this.record("read.drives", "getNode", args), SOURCE)),
        listNodes: (...args: unknown[]) => Promise.resolve((this.record("read.drives", "listNodes", args), { results: [SOURCE], nextCursor: undefined })),
      },
    };
    write = {
      execute: (...args: unknown[]) => {
        this.record("write", "execute", args);
        return Promise.resolve({ written: Promise.resolve(), readable: Promise.resolve(), document: () => Promise.resolve(sourceDocument) });
      },
      create: (...args: unknown[]) => Promise.resolve((this.record("write", "create", args), { document: () => Promise.resolve(sourceDocument) })),
      deleteDocument: (...args: unknown[]) => Promise.resolve((this.record("write", "deleteDocument", args), { document: () => Promise.resolve(undefined) })),
    };
  }
  return { ...real, GraphQLReactorClient: FakeSwitchboardClient, createClient: vi.fn(() => ({})) };
});
vi.mock("../../shared/authed-fetch.js", () => ({ getBearerToken: vi.fn(() => Promise.resolve(undefined)) }));
vi.mock("../../shared/notify.js", () => ({ notifyRequestError: vi.fn() }));
vi.mock("./remote-reactor.js", () => ({ announceDocumentMutation: announce }));

/** Connect's own client over the in-browser replica, which this mode keeps empty of the vault. */
function localReplica() {
  const calls: string[] = [];
  const refuse = (what: string) => () => {
    calls.push(what);
    return Promise.reject(new Error(`${what}: not in the local replica`));
  };
  return {
    calls,
    client: {
      get: refuse("get"),
      read: {
        get: refuse("read.get"),
        getDocumentModelModules: () => Promise.resolve((calls.push("read.getDocumentModelModules"), [])),
        drives: {
          getNode: refuse("read.drives.getNode"),
          listNodes: () => Promise.resolve((calls.push("read.drives.listNodes"), { results: [], nextCursor: undefined })),
        },
      },
      write: {
        execute: refuse("write.execute"),
        drives: { addFile: () => Promise.resolve((calls.push("write.drives.addFile"), undefined)) },
      },
    },
  };
}

function stubWindow(ph: Record<string, unknown>) {
  vi.stubGlobal("window", { ph, addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() });
}

/** Connect as it boots: a store bound to the window holding its client over the local replica, then the vault's remote-first layer. */
async function remoteFirstConnect() {
  const local = localReplica();
  stubWindow({});
  const browser = await import("@powerhousedao/reactor-browser");
  const store = browser.createPHStore();
  browser.bindPHStoreToWindow(store);
  browser.setReactorClient(local.client as never);
  const { enableRemoteFirst } = await import("./remote-first.js");
  enableRemoteFirst({ endpoint: "https://switchboard.example/graphql", driveId: VAULT, driveSlug: "powerhouse-knowledge" });
  const ph = store as unknown as Record<string, unknown>;
  expect(ph.reactorClient).not.toBe(local.client); // the vault's client is in the slot Connect's functions read
  return { local, ph, browser };
}

describe("remote-first under Connect's read and write halves (6.2.3-dev.90)", () => {
  beforeEach(() => {
    vi.resetModules();
    remoteCalls.length = 0;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("the router resolves a vault document's node through the Switchboard, so the document opens", async () => {
    const { local, ph, browser } = await remoteFirstConnect();
    const node = await browser.getDriveNode(VAULT, "src-1", { store: ph as never, refresh: true });
    expect(node).toEqual(SOURCE);
    expect(remoteCalls).toContainEqual({ half: "read.drives", method: "getNode", args: [VAULT, "src-1"] });
    expect(local.calls).not.toContain("read.drives.getNode");
  });

  it("the drive's node listing comes from the Switchboard too", async () => {
    const { local, ph, browser } = await remoteFirstConnect();
    expect(await browser.loadDriveNodes(VAULT, { store: ph as never, refresh: true })).toEqual([SOURCE]);
    expect(remoteCalls.some((c) => c.half === "read.drives" && c.method === "listNodes" && c.args[0] === VAULT)).toBe(true);
    expect(local.calls).not.toContain("read.drives.listNodes");
  });

  it("an editor's dispatch writes through the Switchboard and announces the write once it reads back", async () => {
    const { local, browser } = await remoteFirstConnect();
    const action = { id: "a1", type: "SET_TITLE", input: { title: "x" }, scope: "global", timestampUtcMs: new Date().toISOString() };
    const result = await browser.dispatchActions(action as never, sourceDocument as never);
    expect(result).toEqual(sourceDocument);
    expect(remoteCalls.some((c) => c.half === "write" && c.method === "execute" && c.args[0] === "src-1")).toBe(true);
    expect(local.calls).not.toContain("write.execute");
    expect(announce).toHaveBeenCalledWith("src-1");
  });

  it("another drive's nodes, the model registry and drive writes stay on the local replica", async () => {
    const { local, ph, browser } = await remoteFirstConnect();
    expect(await browser.getDriveNode("another-drive", "n1", { store: ph as never, refresh: true })).toBeUndefined();
    expect(local.calls).toContain("read.drives.getNode");
    const client = ph.reactorClient as { read: { getDocumentModelModules(): Promise<unknown> }; write: { drives: { addFile(): Promise<unknown> } } };
    await client.read.getDocumentModelModules();
    await client.write.drives.addFile();
    expect(local.calls).toEqual(expect.arrayContaining(["read.getDocumentModelModules", "write.drives.addFile"]));
    expect(remoteCalls.filter((c) => c.half === "read.drives")).toEqual([]);
  });
});
