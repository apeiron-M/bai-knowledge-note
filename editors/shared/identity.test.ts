import { describe, it, expect } from "vitest";
import {
  identityAvatar,
  identityLabel,
  isHexAddress,
  shortAddress,
  viaLabel,
} from "./identity.js";

const ADDR = "0xadbA7C2F82139031D7564D18aC22D09B12A0BcA4";

describe("identity helpers", () => {
  it("recognises only 20-byte hex addresses", () => {
    expect(isHexAddress(ADDR)).toBe(true);
    expect(isHexAddress(ADDR.toLowerCase())).toBe(true);
    expect(isHexAddress("0x123")).toBe(false);
    expect(isHexAddress("zDnaecHH…A6dD")).toBe(false);
    expect(isHexAddress(null)).toBe(false);
  });

  it("shortens addresses the way the vault always has", () => {
    expect(shortAddress(ADDR)).toBe("0xadbA…BcA4");
    expect(shortAddress("0xabc")).toBe("0xabc");
  });

  it("prefers the primary ENS name, then any ENS name, then the address", () => {
    expect(identityLabel(ADDR, { ens_primary: "liberuum.eth", ens: "other.eth" })).toBe("liberuum.eth");
    expect(identityLabel(ADDR, { ens: "other.eth" })).toBe("other.eth");
    expect(identityLabel(ADDR, { ens_primary: "  " })).toBe("0xadbA…BcA4");
    expect(identityLabel(ADDR, undefined)).toBe("0xadbA…BcA4");
    expect(identityLabel(null, { ens: "x.eth" })).toBeNull();
  });

  it("picks the smallest avatar ENS publishes", () => {
    expect(
      identityAvatar({ avatar_small: "s", avatar_url: "u", avatar: "a" }),
    ).toBe("s");
    expect(identityAvatar({ avatar_url: "u", avatar: "a" })).toBe("u");
    expect(identityAvatar({ avatar: "a" })).toBe("a");
    expect(identityAvatar({ avatar: null })).toBeNull();
    expect(identityAvatar(null)).toBeNull();
  });

  it("describes the signing app and key together", () => {
    const short = (k: string) => k.slice(0, 4);
    expect(viaLabel("switchboard", "zDna…", short)).toBe("switchboard · zDna");
    expect(viaLabel("switchboard", null, short)).toBe("switchboard");
    expect(viaLabel(null, "zDnaX", short)).toBe("zDna");
    expect(viaLabel(null, null, short)).toBeNull();
  });
});
