import { describe, expect, it, vi } from "vitest";
import { SLOW_STEP_MS, timed, timedRoute } from "./slow.js";

describe("timed", () => {
  it("is silent on a fast step and returns its value", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const clock = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(10);
    await expect(timed("fast", async () => 42, clock)).resolves.toBe(42);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("names a slow step, even when it throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const clock = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(SLOW_STEP_MS + 5);
    await expect(
      timed("canWrite", async () => {
        throw new Error("denied");
      }, clock),
    ).rejects.toThrow("denied");
    expect(warn).toHaveBeenCalledWith(`[http] slow step: canWrite took ${SLOW_STEP_MS + 5} ms`);
    warn.mockRestore();
  });
});

describe("timedRoute", () => {
  it("reports time spent before the handler when the client stamps the request", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const clock = vi.fn().mockReturnValueOnce(50_000).mockReturnValueOnce(50_010);
    const route = timedRoute("POST actions", async () => new Response("ok"), clock);
    const res = await route(
      new Request("http://h/actions", { method: "POST", headers: { "x-client-sent-at": "10000" } }),
      {},
    );
    expect(await res.text()).toBe("ok");
    expect(warn).toHaveBeenCalledWith(
      "[http] slow step: POST actions reached handler 40000 ms after the client sent it",
    );
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("reports a slow handler and stays quiet without the header", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const clock = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(SLOW_STEP_MS);
    await timedRoute("POST sources", async () => new Response("ok"), clock)(
      new Request("http://h/sources", { method: "POST" }),
      {},
    );
    expect(warn).toHaveBeenCalledWith(`[http] slow step: POST sources handler took ${SLOW_STEP_MS} ms`);
    warn.mockRestore();
  });
});
