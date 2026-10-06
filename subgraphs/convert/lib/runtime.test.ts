import type { RouteContext } from "@powerhousedao/shared/processors";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHealthRoute } from "../routes/health.js";
import type { ConvertRouteDeps } from "./deps.js";
import {
  bindRuntimeDeps,
  CONVERT_REGISTRY,
  type ConvertRegistry,
  getConversionServiceUrl,
  resetConversionRuntime,
  setConversionServiceUrl,
} from "./runtime.js";
import type { ConversionService } from "./service.js";

const ctx = {
  params: {},
  user: { address: "0xabc" },
  authEnabled: true,
} as RouteContext;
const health = (deps: ConvertRouteDeps) =>
  createHealthRoute(deps)(new Request("http://vault.test/x/convert/health"), ctx).then(
    (res) => res.json() as Promise<Record<string, unknown>>,
  );
const envService = (): ConversionService => ({
  convert: async () => ({ markdown: "", chunks: [] }),
  progress: async () => null,
  health: async () => ({
    ok: true,
    backend: "docling.rs",
    ready: true,
    missing: [],
    formats: ["md"],
  }),
});

/**
 * A same-process host (the desktop app's sidecar) points the vault at a
 * conversion service while the engine runs — no restart, no environment.
 */
describe("runtime conversion service", () => {
  afterEach(() => {
    resetConversionRuntime();
    vi.unstubAllGlobals();
  });

  it("swaps the service the routes read per request, and health follows", async () => {
    const deps: ConvertRouteDeps = {};
    bindRuntimeDeps(deps);
    expect(await health(deps)).toMatchObject({ configured: false, source: null });

    setConversionServiceUrl("http://127.0.0.1:5011/");
    expect(getConversionServiceUrl()).toBe("http://127.0.0.1:5011");
    expect(deps.service).toBeDefined();
    expect(deps.source).toBe("runtime");

    setConversionServiceUrl(null);
    expect(deps.service).toBeUndefined();
    expect(await health(deps)).toMatchObject({ configured: false });
  });

  it("sends requests to the runtime URL", async () => {
    const deps: ConvertRouteDeps = {};
    bindRuntimeDeps(deps);
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string | URL) => {
      calls.push(String(url));
      return Response.json({
        ok: true,
        backend: "pdfjs",
        ready: false,
        missing: ["binding"],
        formats: ["pdf"],
      });
    });
    setConversionServiceUrl("http://127.0.0.1:5011");
    await deps.service!.health();
    expect(calls[0]).toBe("http://127.0.0.1:5011/health");
  });

  it("applies a URL set before setup when the subgraph binds its deps — a reload keeps the runtime choice", () => {
    setConversionServiceUrl("http://127.0.0.1:6000");
    const deps: ConvertRouteDeps = { service: envService(), source: "env" };
    bindRuntimeDeps(deps);
    expect(deps.source).toBe("runtime");
    expect(deps.service).toBeDefined();
    expect(deps.service).not.toBe(envService());
  });

  it("publishes a same-process registry for the host", () => {
    const deps: ConvertRouteDeps = {};
    bindRuntimeDeps(deps);
    const registry = (globalThis as Record<symbol, unknown>)[CONVERT_REGISTRY] as ConvertRegistry;
    registry.setServiceUrl("http://127.0.0.1:7000");
    expect(deps.source).toBe("runtime");
    expect(registry.getServiceUrl()).toBe("http://127.0.0.1:7000");
  });

  it("reports source: env for a service configured from the environment", async () => {
    const deps: ConvertRouteDeps = { service: envService(), source: "env" };
    expect(await health(deps)).toMatchObject({ configured: true, source: "env" });
  });
});
