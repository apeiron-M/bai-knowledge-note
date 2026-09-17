import type { ChildProcess } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { resolveServiceScript, startConversionService, stopStartedService } from "./autostart.js";

const healthy = (async () => new Response("{}", { status: 200 })) as typeof fetch;
const unhealthy = (async () => {
  throw new Error("ECONNREFUSED");
}) as typeof fetch;

/** A stand-in for the spawned service process. */
const fakeChild = () => {
  const kill = vi.fn(() => true);
  return { child: { kill } as unknown as ChildProcess, kill };
};

describe("resolveServiceScript", () => {
  it("finds the service script from the built output and from source", () => {
    // Both dist/node/ and subgraphs/convert/lib/ are two levels below the root,
    // so the same expression has to serve both. If this returns null in the
    // repo, autostart would silently never start anything.
    const script = resolveServiceScript();
    expect(script).not.toBeNull();
    expect(script?.endsWith("scripts/docling-serve/server.ts")).toBe(true);
  });

  it("takes the first candidate that exists and stops asking", () => {
    // Note `join()` normalises `..` away, so candidates cannot be identified by
    // the literal "../" they were built from — assert on the resolved order.
    const seen: string[] = [];
    const script = resolveServiceScript((path) => {
      seen.push(path);
      return true;
    });
    expect(script).toBe(seen[0]);
    expect(seen).toHaveLength(1);
    expect(script?.endsWith("scripts/docling-serve/server.ts")).toBe(true);
  });

  it("falls through to a later candidate when the first is absent", () => {
    // The differently-nested-bundle case, which no real checkout can produce.
    const seen: string[] = [];
    const script = resolveServiceScript((path) => {
      seen.push(path);
      return seen.length > 1;
    });
    expect(seen).toHaveLength(2);
    expect(script).toBe(seen[1]);
    expect(script).not.toBe(seen[0]);
  });

  it("returns null when no candidate exists, rather than a bogus path", () => {
    expect(resolveServiceScript(() => false)).toBeNull();
  });
});

describe("startConversionService", () => {
  it("reuses a service that already answers, and spawns nothing", async () => {
    // The property that keeps a reload, or an operator's own service, from
    // being fought over — and the reason autostart cannot leak a child per
    // `ph vetra` reload.
    const spawnImpl = vi.fn();
    const result = await startConversionService({
      url: "http://127.0.0.1:5099",
      fetchImpl: healthy,
      spawnImpl: spawnImpl as never,
    });

    expect(result.reused).toBe(true);
    expect(result.child).toBeUndefined();
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it("spawns when nothing answers, and waits for readiness", async () => {
    let probes = 0;
    const fetchImpl = (async () => {
      probes += 1;
      if (probes < 2) throw new Error("ECONNREFUSED");
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const { child, kill } = fakeChild();
    const spawnImpl = vi.fn(() => child);

    const result = await startConversionService({
      url: "http://127.0.0.1:5099",
      fetchImpl,
      spawnImpl: spawnImpl as never,
      waitMs: 3_000,
    });

    expect(result.reused).toBe(false);
    expect(result.child).toBe(child);
    expect(spawnImpl).toHaveBeenCalledTimes(1);
    // It asked the service rather than sleeping a fixed time.
    expect(probes).toBeGreaterThanOrEqual(2);

    stopStartedService();
    expect(kill).toHaveBeenCalled();
  });

  it("does not throw when the spawn itself fails", async () => {
    // A vault with no conversion capability is a state it supports; a failure
    // to start one must not fail setup.
    const result = await startConversionService({
      url: "http://127.0.0.1:5099",
      fetchImpl: unhealthy,
      spawnImpl: (() => {
        throw new Error("ENOENT");
      }) as never,
      waitMs: 300,
    });

    expect(result.reused).toBe(false);
    expect(result.child).toBeUndefined();
    expect(result.service).toBeDefined();
  });

  it("gives up after the wait, without pretending the service is up", async () => {
    const { child } = fakeChild();
    const result = await startConversionService({
      url: "http://127.0.0.1:5099",
      fetchImpl: unhealthy,
      spawnImpl: (() => child) as never,
      waitMs: 400,
    });

    expect(result.reused).toBe(false);
    // The handle is still returned so it can be cleaned up rather than leaked.
    expect(result.child).toBe(child);
    stopStartedService();
  });

  it("stops the process it started, and nothing when it started none", () => {
    stopStartedService();
    expect(() => stopStartedService()).not.toThrow();
  });

  it("treats a service that answers with a failure as not ready, and starts one anyway", async () => {
    // A 503 is "up but not usable" — the distinction matters, because treating it
    // as healthy would leave the vault reporting ready with no engine behind it.
    const notOk = (async () => new Response("nope", { status: 503 })) as typeof fetch;
    const { child } = fakeChild();
    const result = await startConversionService({
      url: "http://127.0.0.1:5099",
      fetchImpl: notOk,
      spawnImpl: (() => child) as never,
      waitMs: 400,
    });
    expect(result.reused).toBe(false);
    expect(result.child).toBe(child);
    stopStartedService();
  });

  it("falls back to the global fetch when none is injected", async () => {
    // Port 5098 has nothing on it, so the real fetch rejects and the spawn path
    // is taken with the injected spawn: no process is started by this test.
    const { child } = fakeChild();
    const result = await startConversionService({
      url: "http://127.0.0.1:5098",
      spawnImpl: (() => child) as never,
      waitMs: 400,
    });
    expect(result.reused).toBe(false);
    stopStartedService();
  });

  it("gives up without spawning when the service script cannot be found", async () => {
    // The published-package failure mode: autostart on, no script shipped. It
    // must degrade to unconfigured rather than throw or spawn something bogus.
    const spawnImpl = vi.fn();
    const result = await startConversionService({
      url: "http://127.0.0.1:5099",
      fetchImpl: unhealthy,
      spawnImpl: spawnImpl as never,
      resolveScript: () => null,
    });
    expect(result.reused).toBe(false);
    expect(result.child).toBeUndefined();
    expect(result.service).toBeDefined();
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it("works with no logger and no wait budget supplied", async () => {
    // Defaults are the production path; the tests must not be the only thing
    // that ever exercises the supplied-everything branch.
    const result = await startConversionService({
      url: "http://127.0.0.1:5099/",
      fetchImpl: healthy,
    });
    expect(result.reused).toBe(true);
    expect(result.child).toBeUndefined();
  });
});
