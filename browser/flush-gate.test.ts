import { describe, expect, it, vi } from "vitest";
import { gateFlushes } from "./flush-gate.js";

const store = () => {
  const flush = vi.fn(() => Promise.resolve());
  return { pg: { syncToFs: flush }, flush };
};

describe("the store's flush gate", () => {
  it("writes everything held in one flush on release", async () => {
    const { pg, flush } = store();
    const gate = gateFlushes(pg, false);
    gate.hold();
    await pg.syncToFs();
    await pg.syncToFs();
    expect(flush).not.toHaveBeenCalled();
    await gate.release();
    expect(flush).toHaveBeenCalledTimes(1);
    await pg.syncToFs();
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it("once frozen — another tab owns the store — drops what it held and never writes again", async () => {
    const { pg, flush } = store();
    const gate = gateFlushes(pg, true);
    await pg.syncToFs();
    gate.freeze();
    await gate.release();
    await pg.syncToFs();
    gate.hold();
    await gate.release();
    expect(flush).not.toHaveBeenCalled();
    expect(gate.held).toBe(true);
  });
});
