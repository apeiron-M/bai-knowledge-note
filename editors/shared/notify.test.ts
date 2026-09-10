import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ERROR_TTL_MS,
  NOTICE_TTL_MS,
  SIGNED_OUT_DEDUPE_MS,
  notify,
  notifyRequestError,
  subscribeNotifications,
  type Notice,
} from "./notify.js";

/**
 * What graphql-request throws: a `ClientError` whose message is the status
 * line followed by the ENTIRE request and response serialised as JSON. The
 * body of a middleware refusal has no `errors[]` — only `error`.
 */
function clientError(response: Record<string, unknown>): Error {
  const request = {
    query: "query GetDocument($identifier: String!) { document(identifier: $identifier) { document { id } } }",
    variables: { identifier: "cf9b51d2-2915-45be-be2c-0ad939bfc1ae" },
  };
  const status = typeof response.status === "number" ? response.status : 200;
  const err = new Error(
    `GraphQL Error (Code: ${status}): ${JSON.stringify({ response, request })}`,
  );
  Object.assign(err, { response, request });
  return err;
}

let now = 1_700_000_000_000;
const seen: Notice[] = [];

beforeAll(() => {
  vi.useFakeTimers();
  subscribeNotifications((n) => seen.push(n));
});
afterAll(() => vi.useRealTimers());
beforeEach(() => {
  // The dedupe map is module state; step well past every window between cases.
  // Twice the longest window: a test may itself step the clock forward by one.
  now += 2 * SIGNED_OUT_DEDUPE_MS + 1_000;
  vi.setSystemTime(now);
  seen.length = 0;
});

describe("notifyRequestError — a 401 from middleware (no GraphQL errors array)", () => {
  const refusal = () =>
    clientError({ status: 401, headers: {}, error: "Authentication required" });

  it("says 'signed out' as a warning and never shows the request dump", () => {
    notifyRequestError(refusal());
    expect(seen).toHaveLength(1);
    const [n] = seen;
    expect(n.level).toBe("warning");
    expect(n.message).toBe("You are signed out");
    const text = `${n.message} ${n.detail ?? ""}`;
    expect(text).not.toMatch(/GraphQL Error|\{"response"|GetDocument|variables/);
  });

  it("collapses the burst of refusals a sign-out produces into one notice", () => {
    notifyRequestError(refusal());
    vi.setSystemTime(now + 5_000);
    notifyRequestError(refusal());
    vi.setSystemTime(now + 20_000);
    notifyRequestError(refusal());
    expect(seen).toHaveLength(1);
    // A later sign-out is a new event.
    vi.setSystemTime(now + SIGNED_OUT_DEDUPE_MS + 1);
    notifyRequestError(refusal());
    expect(seen).toHaveLength(2);
  });

  it("reads the same refusal from the body when the status is missing", () => {
    notifyRequestError(clientError({ error: "Authentication required" }));
    expect(seen[0]?.message).toBe("You are signed out");
  });
});

describe("notifyRequestError — other shapes", () => {
  it("treats an HTTP 403 without an errors array as a permissions refusal", () => {
    notifyRequestError(clientError({ status: 403, error: "Forbidden" }));
    expect(seen[0]?.level).toBe("error");
    expect(seen[0]?.message).toBe("You do not have permission to do that");
    expect(seen[0]?.detail).toBe("Forbidden");
  });

  it("keeps the server's wording for a GraphQL-level FORBIDDEN", () => {
    notifyRequestError(
      clientError({
        status: 200,
        errors: [
          { message: 'Forbidden: insufficient permissions to execute operation "UPDATE_ORIENTATION" on this document' },
        ],
      }),
    );
    expect(seen[0]?.message).toBe("You do not have permission to do that");
    expect(seen[0]?.detail).toMatch(/UPDATE_ORIENTATION/);
  });

  it("routes a GraphQL-level UNAUTHENTICATED to the same signed-out notice", () => {
    notifyRequestError(clientError({ status: 200, errors: [{ message: "Unauthenticated" }] }));
    expect(seen[0]?.message).toBe("You are signed out");
    expect(seen[0]?.level).toBe("warning");
  });

  it("reduces an unexplained ClientError to its status, never the JSON", () => {
    notifyRequestError(clientError({ status: 500, error: "Internal error" }));
    expect(seen[0]?.message).toBe("That did not work");
    expect(seen[0]?.detail).toBe("The Switchboard answered HTTP 500 — Internal error");
  });

  it("truncates a long plain error instead of dumping it", () => {
    notifyRequestError(new Error("x".repeat(1_000)));
    expect(seen[0]?.detail?.length).toBeLessThanOrEqual(240);
    expect(seen[0]?.detail?.endsWith("…")).toBe(true);
  });

  it("still reports a network failure as a warning", () => {
    notifyRequestError(new TypeError("fetch failed"));
    expect(seen[0]?.level).toBe("warning");
    expect(seen[0]?.message).toBe("Lost contact with the Switchboard");
  });

  it("survives a thrown null", () => {
    expect(() => notifyRequestError(null)).not.toThrow();
    expect(seen[0]?.message).toBe("That did not work");
  });
});

describe("every notice expires", () => {
  it("gives errors a longer lifetime than everything else, and never none", () => {
    notify("error", "e");
    notify("warning", "w");
    notify("info", "i");
    notify("success", "s");
    expect(seen.map((n) => n.ttlMs)).toEqual([ERROR_TTL_MS, NOTICE_TTL_MS, NOTICE_TTL_MS, NOTICE_TTL_MS]);
    for (const n of seen) expect(n.ttlMs).toBeGreaterThan(0);
  });

  it("lets a caller override the lifetime", () => {
    notify("info", "custom", undefined, { ttlMs: 1_234 });
    expect(seen[0]?.ttlMs).toBe(1_234);
  });
});
