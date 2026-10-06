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
});
