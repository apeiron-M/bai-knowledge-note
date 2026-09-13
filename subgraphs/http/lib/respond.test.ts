import { describe, expect, it } from "vitest";
import { HttpError, jsonError } from "./respond.js";

async function body(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("jsonError", () => {
  it("shapes an HttpError with status, code and details", async () => {
    const res = jsonError(
      new HttpError(400, "LINT_REACTOR", "2 findings", [
        { path: "actions[0].input.content" },
      ]),
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await body(res)).toEqual({
      error: "2 findings",
      code: "LINT_REACTOR",
      details: [{ path: "actions[0].input.content" }],
    });
  });

  it("maps a document-not-found error to 404", async () => {
    const err = new Error("missing");
    err.name = "CanonicalDocumentIdResolutionError";
    const res = jsonError(err);
    expect(res.status).toBe(404);
    expect((await body(res)).code).toBe("NOT_FOUND");
  });

  it("maps a permission refusal to 403", async () => {
    const err = new Error(
      "insufficient permissions to execute operation on this document",
    );
    err.name = "ForbiddenError";
    const res = jsonError(err);
    expect(res.status).toBe(403);
    expect((await body(res)).code).toBe("FORBIDDEN");
  });

  it("maps anything else to 500 without echoing the message", async () => {
    const res = jsonError(new Error("secret token abc123 leaked here"));
    expect(res.status).toBe(500);
    const payload = await body(res);
    expect(payload.code).toBe("INTERNAL");
    expect(JSON.stringify(payload)).not.toContain("abc123");
  });
});
