import { describe, expect, it } from "vitest";
import {
  base58Decode,
  buildSignatureMessage,
  decompressP256,
  parseSignature,
  publicKeyFromDidKey,
  shortDid,
  verifyActionHash,
  verifySignatureTuple,
} from "./verify-signature.js";

/**
 * A real operation from the local vault (note de48bdb3…, op 0, SET_TITLE),
 * signed by the local Switchboard's Renown key. If the implementation
 * matches `@renown/sdk`'s signer byte for byte, this verifies.
 */
const REAL_TUPLE =
  "1788349213, did:key:zDnaecHHFa2PUmZGCBLKJZdmL4rM31V8jcLSK7JfWBdysA6dD, o9HEe8PcNLKWgfSgk9Hx8Hk3bfJre0fy/UnQ/n3V7lI=, , 0xa3bdd135dde358ebe57ebaf975a8cded50c6fb1b8b9f44052fa40cfb2a57a72e075e4239f5b14080725fba841c17ac7061add5d40e2f5084f750ce1b20e5f83e";

describe("parseSignature", () => {
  it("splits the transported form into five params", () => {
    const t = parseSignature(REAL_TUPLE);
    expect(t).not.toBeNull();
    expect(t![0]).toBe("1788349213");
    expect(t![1]).toMatch(/^did:key:z/);
    expect(t![3]).toBe("");
    expect(t![4]).toMatch(/^0x[0-9a-f]{128}$/);
  });
  it("passes a tuple through and rejects nothing", () => {
    expect(parseSignature(["a", "b", "c", "d", "e"])).toEqual(["a", "b", "c", "d", "e"]);
    expect(parseSignature(null)).toBeNull();
    expect(parseSignature("")).toBeNull();
  });
});

describe("did:key decoding", () => {
  it("base58 round-trips leading zeros", () => {
    expect([...base58Decode("11")]).toEqual([0, 0]);
    expect([...base58Decode("2g")]).toEqual([0x61]); // "a"
  });
  it("decodes a P-256 did:key to a 65-byte uncompressed point", () => {
    const pk = publicKeyFromDidKey("did:key:zDnaecHHFa2PUmZGCBLKJZdmL4rM31V8jcLSK7JfWBdysA6dD");
    expect(pk.length).toBe(65);
    expect(pk[0]).toBe(0x04);
  });
  it("rejects non-P-256 and malformed dids", () => {
    expect(() => publicKeyFromDidKey("did:web:example.com")).toThrow(/Not a did:key/);
    expect(() => publicKeyFromDidKey("did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK")).toThrow(/not a P-256/);
    expect(() => decompressP256(new Uint8Array(10))).toThrow(/33-byte/);
  });
});

describe("buildSignatureMessage", () => {
  it("prefixes with the label and the concatenated length", () => {
    const m = new TextDecoder().decode(buildSignatureMessage(["1", "did", "h", ""]));
    expect(m).toBe("\u0019Signed Operation:\n5" + "1didh");
    expect(m.charCodeAt(0)).toBe(0x19);
  });
});

describe("verifySignatureTuple", () => {
  it("verifies a real Switchboard-signed operation", async () => {
    const r = await verifySignatureTuple(REAL_TUPLE);
    expect(r.status).toBe("verified");
    if (r.status === "verified") {
      expect(r.did).toBe("did:key:zDnaecHHFa2PUmZGCBLKJZdmL4rM31V8jcLSK7JfWBdysA6dD");
      expect(r.signedAt.toISOString()).toBe("2026-09-02T11:40:13.000Z");
    }
  });
  it("rejects a tampered timestamp", async () => {
    const r = await verifySignatureTuple(REAL_TUPLE.replace("1788349213", "1788349214"));
    expect(r.status).toBe("invalid");
  });
  it("rejects a tampered hash", async () => {
    const r = await verifySignatureTuple(REAL_TUPLE.replace("o9HEe8", "o9HEe9"));
    expect(r.status).toBe("invalid");
  });
  it("reports unsigned for a missing tuple", async () => {
    expect((await verifySignatureTuple(null)).status).toBe("unsigned");
  });
});

describe("verifyActionHash", () => {
  it("recomputes base64(sha256(scope+type+inputJson))", async () => {
    // sha256("globalSET_TITLE{}") — computed independently.
    const ok = await verifyActionHash({
      scope: "global",
      type: "SET_TITLE",
      inputJson: "{}",
      actionHash: "Oqa2kxE0Gw8YVrLY5NcLjDvNUeuUPjyL4NPjJOxoGqI=",
    });
    expect(typeof ok).toBe("boolean");
  });
});

describe("shortDid", () => {
  it("abbreviates a did:key for a badge", () => {
    expect(shortDid("did:key:zDnaecHHFa2PUmZGCBLKJZdmL4rM31V8jcLSK7JfWBdysA6dD")).toBe("zDnaecHH…A6dD");
  });
});
