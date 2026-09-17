import { describe, expect, it } from "vitest";
import { HttpError, OK_CACHE, jsonError } from "./respond.js";

/**
 * These existed without a test of their own, and the coverage report is what
 * said so: `jsonError` had 0 of 3 branches taken, because every route test hit
 * it with an `HttpError` and nothing else.
 */
describe("jsonError", () => {
  it("reports an HttpError with its own status and code", async () => {
    const response = jsonError(
      new HttpError(400, "FILENAME_REQUIRED", "Pass ?filename"),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Pass ?filename",
      code: "FILENAME_REQUIRED",
    });
  });

  it("includes details only when they were supplied", async () => {
    // The spread is conditional so an absent `details` does not become a null
    // key in the body — a client cannot distinguish "no details" from "details
    // that happen to be null" otherwise.
    const withDetails = jsonError(
      new HttpError(400, "BAD_INPUT", "nope", { field: "filename" }),
    );
    expect(await withDetails.json()).toEqual({
      error: "nope",
      code: "BAD_INPUT",
      details: { field: "filename" },
    });

    const without = jsonError(new HttpError(400, "BAD_INPUT", "nope"));
    expect("details" in (await without.json())).toBe(false);
  });

  it("turns an unexpected Error into a 500 rather than letting it escape", async () => {
    const response = jsonError(new Error("boom"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "boom",
      code: "INTERNAL",
    });
  });

  it("copes with a thrown non-Error, which is what a bare `throw` produces", async () => {
    // `throw "nope"` is legal JavaScript and reaches here as a string.
    const response = jsonError("just a string");

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "just a string",
      code: "INTERNAL",
    });
  });

  it("keeps an error response out of shared caches", () => {
    expect(OK_CACHE["Cache-Control"]).toContain("private");
  });
});
