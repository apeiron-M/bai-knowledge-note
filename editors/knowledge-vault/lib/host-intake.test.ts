import { beforeEach, describe, expect, it, vi } from "vitest";

const { configure, get } = vi.hoisted(() => ({
  configure: vi.fn(),
  get: vi.fn(),
}));

vi.mock("./attachments.js", () => ({
  attachmentPort: () => ({ prepare: vi.fn(), upload: vi.fn() }),
}));
vi.mock("./intake-store.js", () => ({
  intakeStoreFor: () => ({
    configure,
    add: vi.fn(),
    publish: vi.fn(),
    subscribe: vi.fn(),
    getSnapshot: vi.fn(),
  }),
  pinnedVaultApi: () => ({ get }),
}));

import { hostIntake } from "./host-intake.js";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  configure.mockReset();
  get.mockReset();
});

/** The desktop app's setup guide has no view reading the health, so the intake reads it itself. */
describe("hostIntake — the converter's lanes", () => {
  it("tells the batch how many files the converter takes at once, per lane", async () => {
    get.mockResolvedValue({
      ok: true,
      slots: { models: 1, other: 2, busyModels: 0, busyOther: 0 },
      modelExtensions: ["pdf", "png"],
    });
    hostIntake("drive-1");
    await settle();
    expect(get).toHaveBeenCalledWith("/convert/health");
    expect(configure).toHaveBeenCalledWith({
      models: 1,
      other: 2,
      modelExtensions: ["pdf", "png"],
    });
  });

  it("leaves the batch at one file at a time when the service reports no lanes", async () => {
    get.mockResolvedValue({ ok: true, formats: ["pdf"] });
    hostIntake("drive-1");
    await settle();
    expect(configure).not.toHaveBeenCalled();
  });

  it("is best effort: an unreadable health changes nothing and throws nothing", async () => {
    get.mockRejectedValue(new Error("Could not reach the vault"));
    expect(() => hostIntake("drive-1")).not.toThrow();
    await settle();
    expect(configure).not.toHaveBeenCalled();
  });
});
