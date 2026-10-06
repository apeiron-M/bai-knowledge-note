import { afterEach, describe, expect, it } from "vitest";
import {
  getHostConfig,
  isDesktopHost,
  setHostConfig,
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
