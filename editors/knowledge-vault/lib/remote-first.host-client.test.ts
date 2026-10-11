/**
 * Under the desktop host, `window.ph.reactorClient` is already a
 * GraphQLReactorClient the host built (with its own auth and realtime). The
 * vault must reuse it rather than building a second client and routing one
 * through the other; the vault's own document cache is still installed.
 *
 * The contract is explicit: reuse happens only for a host that declared itself
 * (editors/shared/host-config.ts). A GraphQLReactorClient found in the slot
 * without a declaration keeps the Connect path — the vault's own client, with
 * its auth middleware and error reporting in front — so a future host cannot
 * lose both by installing a bare client.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ctor = vi.hoisted(() => vi.fn());
const setReactorClientMock = vi.hoisted(() => vi.fn());
const setDocumentCacheMock = vi.hoisted(() => vi.fn());

vi.mock("@powerhousedao/reactor-browser", () => ({
  GraphQLReactorClient: class {
    get = vi.fn();
    getOperations = vi.fn();
    constructor(options: unknown) {
      ctor(options);
    }
  },
  isGraphQLReactorClient: (c: unknown) =>
    !!c && (c as { __hostClient?: boolean }).__hostClient === true,
  setReactorClient: setReactorClientMock,
  setDocumentCache: setDocumentCacheMock,
  createClient: vi.fn(() => ({})),
  makeAuthMiddleware: vi.fn(() => (fn: unknown) => fn),
  addPromiseState: vi.fn((p: unknown) => p),
}));
vi.mock("../../shared/authed-fetch.js", () => ({
  getBearerToken: vi.fn(async () => undefined),
}));
vi.mock("../../shared/notify.js", () => ({ notifyRequestError: vi.fn() }));
vi.mock("./remote-reactor.js", () => ({ announceDocumentMutation: vi.fn() }));

const SLOT = "__knowledgeVaultHost";
function declareDesktopHost() {
  (globalThis as Record<string, unknown>)[SLOT] = {
    kind: "desktop",
    switchboardOrigin: "http://127.0.0.1:4201",
  };
}

function stubWindow(ph: Record<string, unknown>) {
  vi.stubGlobal("window", {
    ph,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  });
}

describe("enableRemoteFirst under a host-provided client", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    delete (globalThis as Record<string, unknown>)[SLOT];
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("reuses the declared desktop host's GraphQLReactorClient: no second client, no proxy, cache installed", async () => {
    declareDesktopHost();
    const hostClient = { __hostClient: true, get: vi.fn(), getOperations: vi.fn() };
    stubWindow({ reactorClient: hostClient });
    const { enableRemoteFirst } = await import("./remote-first.js");
    const handle = enableRemoteFirst({
      endpoint: "http://127.0.0.1:4201/graphql",
      driveId: "d1",
    });
    expect(ctor).not.toHaveBeenCalled();
    expect(setReactorClientMock).not.toHaveBeenCalled();
    expect(handle.remoteClient).toBe(hostClient);
    expect(setDocumentCacheMock).toHaveBeenCalledTimes(1);
  });

  it("does not reuse a GraphQLReactorClient when no host declared itself — the vault keeps its own auth in front", async () => {
    const bareClient = { __hostClient: true, get: vi.fn(), getOperations: vi.fn(), execute: vi.fn() };
    stubWindow({ reactorClient: bareClient });
    const { enableRemoteFirst } = await import("./remote-first.js");
    const handle = enableRemoteFirst({
      endpoint: "http://127.0.0.1:4201/graphql",
      driveId: "d1",
    });
    expect(ctor).toHaveBeenCalledTimes(1);
    expect(setReactorClientMock).toHaveBeenCalledTimes(1);
    expect(handle.remoteClient).not.toBe(bareClient);
  });

  it("still builds its own client and proxies a worker client under Connect", async () => {
    const workerClient = { get: vi.fn(), getOperations: vi.fn(), execute: vi.fn() };
    stubWindow({ reactorClient: workerClient });
    const { enableRemoteFirst } = await import("./remote-first.js");
    const handle = enableRemoteFirst({
      endpoint: "http://localhost:4001/graphql",
      driveId: "d1",
    });
    expect(ctor).toHaveBeenCalledTimes(1);
    expect(setReactorClientMock).toHaveBeenCalledTimes(1);
    expect(handle.remoteClient).not.toBe(workerClient);
  });

  describe("restore", () => {
    // The setters write the slots the way reactor-browser's event handlers do,
    // so restore can see what the window holds when it runs.
    function writeSlots() {
      const ph = (window as unknown as { ph: Record<string, unknown> }).ph;
      setReactorClientMock.mockImplementation((c: unknown) => {
        ph.reactorClient = c;
      });
      setDocumentCacheMock.mockImplementation((c: unknown) => {
        ph.documentCache = c;
      });
      return ph;
    }

    it("leaves the slots alone once the host moved the window to another server", async () => {
      declareDesktopHost();
      const serverClient = { __hostClient: true, get: vi.fn(), getOperations: vi.fn() };
      const serverCache = { name: "server cache" };
      stubWindow({ reactorClient: serverClient, documentCache: serverCache });
      const ph = writeSlots();
      const { enableRemoteFirst } = await import("./remote-first.js");
      const handle = enableRemoteFirst({ endpoint: "https://vault.example/graphql", driveId: "d1" });
      // Leaving a vault on a server: the host switches back to its local engine first…
      const localClient = { __hostClient: true, get: vi.fn() };
      const localCache = { name: "local cache" };
      ph.reactorClient = localClient;
      ph.documentCache = localCache;
      setReactorClientMock.mockClear();
      setDocumentCacheMock.mockClear();
      // …then the vault app unmounts.
      handle.restore();
      expect(setReactorClientMock).not.toHaveBeenCalled();
      expect(setDocumentCacheMock).not.toHaveBeenCalled();
      expect(ph.reactorClient).toBe(localClient);
      expect(ph.documentCache).toBe(localCache);
    });

    it("hands back the cache it still holds, and never touches the reused host client", async () => {
      declareDesktopHost();
      const hostClient = { __hostClient: true, get: vi.fn(), getOperations: vi.fn() };
      const hostCache = { name: "host cache" };
      stubWindow({ reactorClient: hostClient, documentCache: hostCache });
      const ph = writeSlots();
      const { enableRemoteFirst } = await import("./remote-first.js");
      const handle = enableRemoteFirst({ endpoint: "http://127.0.0.1:4201/graphql", driveId: "d1" });
      expect(ph.documentCache).not.toBe(hostCache);
      handle.restore();
      expect(setReactorClientMock).not.toHaveBeenCalled();
      expect(ph.documentCache).toBe(hostCache);
      expect(ph.reactorClient).toBe(hostClient);
    });

    it("under Connect, hands back both the worker client and the cache it replaced", async () => {
      const workerClient = { get: vi.fn(), getOperations: vi.fn(), execute: vi.fn() };
      const workerCache = { name: "worker cache" };
      stubWindow({ reactorClient: workerClient, documentCache: workerCache });
      const ph = writeSlots();
      const { enableRemoteFirst } = await import("./remote-first.js");
      const handle = enableRemoteFirst({ endpoint: "http://localhost:4001/graphql", driveId: "d1" });
      expect(ph.reactorClient).not.toBe(workerClient);
      handle.restore();
      expect(ph.reactorClient).toBe(workerClient);
      expect(ph.documentCache).toBe(workerCache);
    });
  });
});
