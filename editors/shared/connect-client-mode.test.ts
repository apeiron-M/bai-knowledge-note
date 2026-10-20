import { afterEach, describe, expect, it, vi } from "vitest";
import { connectRunsRemoteClient, connectSwitchboardOrigin } from "./connect-client-mode.js";

const router = { describeRouting: () => ({ backends: ["switchboard-remote"] }) };
const withPh = (ph: unknown) => vi.stubGlobal("window", { ph });
afterEach(() => vi.unstubAllGlobals());

describe("connectRunsRemoteClient", () => {
  it("is true for Connect's remote client: a router and no reactor in the tab", () => {
    withPh({ reactorClient: router });
    expect(connectRunsRemoteClient()).toBe(true);
  });

  it("is false when a reactor runs in the tab (in-process, worker or router mode)", () => {
    withPh({ reactorClient: router, reactorClientModule: {} });
    expect(connectRunsRemoteClient()).toBe(false);
    withPh({ reactorClient: {}, reactorClientModule: {} });
    expect(connectRunsRemoteClient()).toBe(false);
  });

  it("is false for a desktop host's plain GraphQL client", () => {
    withPh({ reactorClient: { get: () => undefined } });
    expect(connectRunsRemoteClient()).toBe(false);
  });

  it("is false before Connect has a client, and outside the browser", () => {
    withPh({});
    expect(connectRunsRemoteClient()).toBe(false);
    vi.unstubAllGlobals();
    vi.stubGlobal("window", undefined);
    expect(connectRunsRemoteClient()).toBe(false);
  });
});

describe("connectSwitchboardOrigin", () => {
  it("is the default drive's Switchboard in remote mode, path prefix included", () => {
    withPh({ reactorClient: router, defaultDrivesUrl: "https://switchboard.example.io/d/vault" });
    expect(connectSwitchboardOrigin()).toBe("https://switchboard.example.io");
    withPh({ reactorClient: router, defaultDrivesUrl: "http://localhost:4101/api/sb/d/liberuum/" });
    expect(connectSwitchboardOrigin()).toBe("http://localhost:4101/api/sb");
  });

  it("is null outside remote mode, or without a usable drive URL", () => {
    withPh({ reactorClient: router, reactorClientModule: {}, defaultDrivesUrl: "https://sb.example/d/vault" });
    expect(connectSwitchboardOrigin()).toBeNull();
    withPh({ reactorClient: router });
    expect(connectSwitchboardOrigin()).toBeNull();
    withPh({ reactorClient: router, defaultDrivesUrl: "not a url" });
    expect(connectSwitchboardOrigin()).toBeNull();
    withPh({ reactorClient: router, defaultDrivesUrl: "https://sb.example/graphql" });
    expect(connectSwitchboardOrigin()).toBeNull();
  });
});

describe("keepConnectRealtimeAlive", () => {
  it("holds one keeper subscription, renews it on a timer and on demand, and releases it on stop", async () => {
    vi.useFakeTimers();
    try {
      const released: number[] = []; let n = 0;
      const subscribe = vi.fn(() => { const id = ++n; return () => released.push(id); });
      withPh({ reactorClient: { ...router, subscribe } });
      const { keepConnectRealtimeAlive } = await import("./connect-client-mode.js");
      const keeper = keepConnectRealtimeAlive(1000);
      expect(subscribe).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(2500);
      expect(subscribe).toHaveBeenCalledTimes(3);
      expect(released).toEqual([1, 2]);
      keeper.renew();
      expect(subscribe).toHaveBeenCalledTimes(4);
      keeper.stop();
      expect(released).toEqual([1, 2, 3, 4]);
      vi.advanceTimersByTime(5000);
      expect(subscribe).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does nothing without a client that can subscribe", async () => {
    withPh({});
    const { keepConnectRealtimeAlive } = await import("./connect-client-mode.js");
    expect(() => keepConnectRealtimeAlive().stop()).not.toThrow();
  });
});
