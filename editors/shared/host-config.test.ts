import { afterEach, describe, expect, it } from "vitest";
import {
  getHostConfig,
  isDesktopHost,
  setHostConfig,
  subscribeHostConfig,
} from "./host-config.js";

afterEach(() => setHostConfig(undefined));

describe("host-config", () => {
  it("is empty until a host declares itself", () => {
    expect(getHostConfig()).toBeUndefined();
    expect(isDesktopHost()).toBe(false);
  });

  it("round-trips a declaration through the global slot", () => {
    setHostConfig({ kind: "desktop", switchboardOrigin: "http://127.0.0.1:4201" });
    expect(getHostConfig()).toEqual({
      kind: "desktop",
      switchboardOrigin: "http://127.0.0.1:4201",
    });
    expect(isDesktopHost()).toBe(true);
  });

  it("reads the global at call time, so a late declaration is still seen", () => {
    (globalThis as Record<string, unknown>).__knowledgeVaultHost = {
      kind: "desktop",
      switchboardOrigin: "http://127.0.0.1:4300",
    };
    expect(getHostConfig()?.switchboardOrigin).toBe("http://127.0.0.1:4300");
  });

  it("rejects an origin that carries a path", () => {
    expect(() =>
      setHostConfig({ kind: "desktop", switchboardOrigin: "http://127.0.0.1:4201/graphql" }),
    ).toThrow(/origin without a path/);
    expect(getHostConfig()).toBeUndefined();
  });

  it("clears the slot when set to undefined", () => {
    setHostConfig({ kind: "connect", switchboardOrigin: "http://localhost:4001" });
    setHostConfig(undefined);
    expect(getHostConfig()).toBeUndefined();
  });
});

describe("host-config: identity and bearer (the desktop host holds the sign-in)", () => {
  it("stores the host's bearer provider and identity and notifies subscribers of every change", async () => {
    const seen: number[] = [];
    const unsubscribe = subscribeHostConfig(() => seen.push(seen.length));
    setHostConfig({
      kind: "desktop",
      switchboardOrigin: "https://switchboard.example.com",
      bearer: () => Promise.resolve("token-1"),
      identity: { address: "0xabc", did: "did:pkh:eip155:1:0xabc" },
    });
    expect(await getHostConfig()?.bearer?.()).toBe("token-1");
    expect(getHostConfig()?.identity).toEqual({ address: "0xabc", did: "did:pkh:eip155:1:0xabc" });
    setHostConfig(undefined);
    expect(seen).toEqual([0, 1]);
    unsubscribe();
    setHostConfig({ kind: "desktop", switchboardOrigin: "http://127.0.0.1:4201" });
    expect(seen).toEqual([0, 1]);
  });
});
