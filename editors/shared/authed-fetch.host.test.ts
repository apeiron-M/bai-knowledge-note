import { afterEach, describe, expect, it, vi } from "vitest";

const ambient = vi.hoisted(() => vi.fn(() => Promise.resolve("ambient-token")));
vi.mock("@powerhousedao/reactor-browser", () => ({ ambientRenownTokenProvider: ambient }));

import { getBearerToken } from "./authed-fetch.js";
import { setHostConfig } from "./host-config.js";

afterEach(() => {
  setHostConfig(undefined);
  vi.clearAllMocks();
});

describe("getBearerToken under a desktop host", () => {
  it("uses Connect's ambient session when no host declared itself", async () => {
    expect(await getBearerToken()).toBe("ambient-token");
  });
  it("uses the host's bearer, never the ambient session, once a desktop host declared itself", async () => {
    setHostConfig({ kind: "desktop", switchboardOrigin: "https://switchboard.example.com", bearer: () => Promise.resolve("host-token") });
    expect(await getBearerToken()).toBe("host-token");
    expect(ambient).not.toHaveBeenCalled();
  });
  it("sends no bearer at all for an open local engine (a desktop host without a bearer) — a missing header is anonymous, a bad one is a 401", async () => {
    setHostConfig({ kind: "desktop", switchboardOrigin: "http://127.0.0.1:4201" });
    expect(await getBearerToken()).toBeUndefined();
    expect(ambient).not.toHaveBeenCalled();
  });
  it("treats a failing host provider as no token", async () => {
    setHostConfig({ kind: "desktop", switchboardOrigin: "http://127.0.0.1:4201", bearer: () => Promise.reject(new Error("engine down")) });
    expect(await getBearerToken()).toBeUndefined();
  });
});
