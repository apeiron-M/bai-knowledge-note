import { describe, expect, it } from "vitest";
import {
  CLOSE_FORBIDDEN,
  CLOSE_UNAUTHORIZED,
  closeCodeOf,
  refusedForMissingToken,
} from "./live-feed-policy.js";

describe("refusedForMissingToken", () => {
  it("does not read a 4500 as a credential refusal — that is a server fault", () => {
    // Before 6.2.3-dev.4 a tokenless handshake surfaced as a 4500; the server
    // now closes 4403, so a 4500 is a genuine fault with or without a token.
    expect(refusedForMissingToken(4500, false)).toBe(false);
    expect(refusedForMissingToken(4500, true)).toBe(false);
  });

  it("reads the explicit auth close codes as refusals when tokenless", () => {
    expect(refusedForMissingToken(CLOSE_UNAUTHORIZED, false)).toBe(true);
    expect(refusedForMissingToken(CLOSE_FORBIDDEN, false)).toBe(true);
  });

  it("never treats a close as a token refusal when a token was offered", () => {
    expect(refusedForMissingToken(CLOSE_UNAUTHORIZED, true)).toBe(false);
    expect(refusedForMissingToken(CLOSE_FORBIDDEN, true)).toBe(false);
  });

  it("does not mistake a normal close or a network failure for a refusal", () => {
    expect(refusedForMissingToken(1000, false)).toBe(false); // normal closure
    expect(refusedForMissingToken(1006, false)).toBe(false); // abnormal, e.g. server down
    expect(refusedForMissingToken(undefined, false)).toBe(false); // no code at all
  });
});

describe("closeCodeOf", () => {
  it("reads the code off a CloseEvent-like object", () => {
    expect(closeCodeOf({ code: 4500, reason: "x" })).toBe(4500);
  });

  it("is undefined for an Error, a string, null, or a non-numeric code", () => {
    expect(closeCodeOf(new Error("boom"))).toBeUndefined();
    expect(closeCodeOf("nope")).toBeUndefined();
    expect(closeCodeOf(null)).toBeUndefined();
    expect(closeCodeOf({ code: "4500" })).toBeUndefined();
  });
});
