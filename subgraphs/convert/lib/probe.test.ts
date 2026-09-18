import { describe, expect, it, vi } from "vitest";
import { connectConversionService } from "./probe.js";

const ok = () =>
  vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
const status = (code: number) =>
  vi.fn(async () => new Response("", { status: code })) as unknown as typeof fetch;
const throws = () =>
  vi.fn(async () => {
    throw new Error("ECONNREFUSED");
  }) as unknown as typeof fetch;

describe("connectConversionService", () => {
  it("reports reachable when /health answers", async () => {
    const result = await connectConversionService({
      url: "http://127.0.0.1:5011",
      fetchImpl: ok(),
    });

    expect(result.reachable).toBe(true);
    expect(result.service).toBeDefined();
  });

  it("probes /health at the configured URL", async () => {
    const fetchImpl = ok();
    await connectConversionService({ url: "http://svc:5011", fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://svc:5011/health",
      expect.anything(),
    );
  });

  it("does not double the slash when the URL has a trailing one", async () => {
    const fetchImpl = ok();
    await connectConversionService({ url: "http://svc:5011///", fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://svc:5011/health",
      expect.anything(),
    );
  });

  // The service is returned even when nothing answers, so a converter that is
  // merely restarting starts working again without restarting the Switchboard.
  it("still returns a usable service when nothing answers", async () => {
    const result = await connectConversionService({
      url: "http://127.0.0.1:5011",
      fetchImpl: throws(),
    });

    expect(result.reachable).toBe(false);
    expect(result.service).toBeDefined();
  });

  it("treats a non-ok status as unreachable", async () => {
    const result = await connectConversionService({
      url: "http://127.0.0.1:5011",
      fetchImpl: status(503),
    });

    expect(result.reachable).toBe(false);
  });

  it("warns with actionable guidance when unreachable", async () => {
    const log = vi.fn();
    await connectConversionService({
      url: "http://127.0.0.1:5011",
      fetchImpl: throws(),
      log,
    });

    expect(log).toHaveBeenCalledTimes(1);
    const message = log.mock.calls[0]?.[0] as string;
    expect(message).toContain("http://127.0.0.1:5011");
    expect(message).toContain("CONVERT_SERVICE_URL");
  });

  it("stays quiet when the service is there", async () => {
    const log = vi.fn();
    await connectConversionService({
      url: "http://127.0.0.1:5011",
      fetchImpl: ok(),
      log,
    });

    expect(log).not.toHaveBeenCalled();
  });

  // Spawning is what this module deliberately no longer does: the engine has no
  // musl build, and 1.36 GB of models per replica contradicts scaling out. This
  // is asserted against the source rather than by spying, because a spy only
  // proves the one path exercised — the point is that the capability is absent.
  it("does not reach for child_process at all", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("./probe.ts", import.meta.url),
      "utf8",
    );

    // Imports and calls only — the file's own docstring explains *why* it does
    // not spawn, so a bare word match would fail on the explanation.
    expect(source).not.toMatch(/from\s+["']node:child_process["']/);
    expect(source).not.toMatch(/\bspawn\s*\(/);
  });
});
