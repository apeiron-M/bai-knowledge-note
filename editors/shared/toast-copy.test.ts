import { describe, expect, it } from "vitest";
import { presentDetail } from "./toast-copy.js";

describe("presentDetail", () => {
  it("drops the verdict the headline already gave, and keeps the server's wording", () => {
    expect(
      presentDetail('Forbidden: insufficient permissions to execute operation "UPDATE_PROJECT" on this document'),
    ).toBe('Insufficient permissions to execute operation "UPDATE_PROJECT" on this document');
  });

  it("recognises the other verdicts the Switchboard prefixes with", () => {
    expect(presentDetail("Unauthorized: token expired")).toBe("Token expired");
    expect(presentDetail("Unauthenticated: no bearer")).toBe("No bearer");
    expect(presentDetail("Error: boom")).toBe("Boom");
  });

  it("leaves a sentence without a prefix alone apart from its first letter", () => {
    expect(presentDetail("the request was refused.")).toBe("The request was refused.");
    expect(presentDetail("Sign in again to keep working with this vault.")).toBe(
      "Sign in again to keep working with this vault.",
    );
  });

  it("never eats a word that merely starts like a verdict", () => {
    expect(presentDetail("Forbidden fruit tastes best")).toBe("Forbidden fruit tastes best");
    expect(presentDetail("Errors: 3")).toBe("Errors: 3");
  });

  it("collapses whitespace and survives an empty string", () => {
    expect(presentDetail("  a   b\n c ")).toBe("A b c");
    expect(presentDetail("Forbidden:   ")).toBe("");
  });
});
