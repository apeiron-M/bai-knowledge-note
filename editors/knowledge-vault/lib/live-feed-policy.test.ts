import { describe, expect, it } from "vitest";
import {
  CLOSE_FORBIDDEN,
  CLOSE_INTERNAL_SERVER_ERROR,
  CLOSE_UNAUTHORIZED,
  closeCodeOf,
  refusedForMissingToken,
} from "./live-feed-policy.js";

describe("refusedForMissingToken", () => {
  it("reads 4500 as a credential refusal ONLY when no token was sent", () => {
    // What the current Switchboard actually emits for a tokenless connection.
    expect(refusedForMissingToken(CLOSE_INTERNAL_SERVER_ERROR, false)).toBe(true);
    // The same code with a token is a genuine server fault, not "sign in".
    expect(refusedForMissingToken(CLOSE_INTERNAL_SERVER_ERROR, true)).toBe(false);
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
