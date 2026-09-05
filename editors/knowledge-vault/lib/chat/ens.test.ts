import { afterEach, describe, expect, it, vi } from "vitest";
import { looksResolvable, resolveEns } from "./ens.js";

afterEach(() => vi.restoreAllMocks());

const ADDRESS = "0xadbA7C2F82139031D7564D18aC22D09B12A0BcA4";

function respond(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe("looksResolvable", () => {
  it("accepts an address or a dotted name, and nothing else", () => {
    expect(looksResolvable(ADDRESS)).toBe(true);
    expect(looksResolvable("vitalik.eth")).toBe(true);
    expect(looksResolvable("sub.domain.eth")).toBe(true);
    expect(looksResolvable("liberuum")).toBe(false);
    expect(looksResolvable("0x1234")).toBe(false);
    expect(looksResolvable("who signed this?")).toBe(false);
  });
});

describe("resolveEns", () => {
  it("resolves an address to its primary name, through the same service the badges use", async () => {
    // Verbatim shape from api.ensdata.net (2026-09-05).
    const fetchMock = respond(200, {
      address: ADDRESS,
      avatar: "https://euc.li/liberuum.eth",
      avatar_url: "https://euc.li/liberuum.eth",
      ens: "liberuum.eth",
      ens_primary: "liberuum.eth",
    });
    const id = await resolveEns(ADDRESS);
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(`https://api.ensdata.net/${ADDRESS}`);
    expect(id).toEqual({
      query: ADDRESS,
      name: "liberuum.eth",
      address: ADDRESS,
      avatar: "https://euc.li/liberuum.eth",
      description: null,
    });
  });

  it("resolves the other direction too — a name to its address", async () => {
    respond(200, {
      address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      ens: "vitalik.eth",
      ens_primary: "vitalik.eth",
      description: "mi pinxe lo crino tcati",
    });
    const id = await resolveEns("vitalik.eth");
    expect(id.address).toBe("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
    expect(id.description).toBe("mi pinxe lo crino tcati");
  });

  it("treats 'no name registered' as an answer, not a failure, and keeps the service's words", async () => {
    respond(404, {
      error: true,
      status: 404,
      message: "Unable to resolve 0x…dead because it's not registered on the Ethereum Name Service.",
    });
    const id = await resolveEns("0x000000000000000000000000000000000000dEaD");
    expect(id.name).toBeNull();
    expect(id.address).toBe("0x000000000000000000000000000000000000dEaD");
    expect(id.reason).toMatch(/not registered/);
  });

  it("refuses input that is neither, without spending a request", async () => {
    const fetchMock = respond(200, {});
    await expect(resolveEns("who is this")).rejects.toThrow(/neither an Ethereum address/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws when the service itself is broken", async () => {
    respond(503, { oops: true });
    await expect(resolveEns(ADDRESS)).rejects.toThrow(/answered 503/);
  });
});
