import { describe, expect, it } from "vitest";
import { plainError } from "./plain-error.js";

const dump401 =
  'GraphQL Error (Code: 401): {"response":{"status":401,"headers":{},"body":"{\\"error\\":\\"Credentials no longer valid\\"}"},"request":{"query":"query { x }","variables":{}}}';

describe("plainError", () => {
  it("turns a GraphQL client dump into a sentence, keeping the app's own lead", () => {
    expect(plainError(new Error(dump401))).toBe("Renown didn't confirm your sign-in. Try again in a moment; if it keeps happening, sign in again.");
    expect(plainError(`Could not save: ${dump401}`)).toMatch(/^Could not save: Renown didn't confirm/);
    const forbidden = 'Forbidden: insufficient permissions: {"response":{"status":200,"errors":[{"message":"Forbidden: insufficient permissions"}]},"request":{}}';
    expect(plainError(forbidden)).toBe("You don't have access to this. Ask the vault's administrator for access.");
  });

  it("names a network failure and unreadable JSON, and leaves sentences alone", () => {
    expect(plainError(new TypeError("Load failed"))).toMatch(/^Couldn't reach the vault's server/);
    expect(plainError(new SyntaxError("Unexpected token < in JSON at position 0"))).toMatch(/couldn't read/);
    expect(plainError("Enter a title first.")).toBe("Enter a title first.");
  });
});
