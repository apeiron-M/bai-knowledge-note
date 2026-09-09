import { beforeEach, describe, expect, it, vi } from "vitest";
import { authedGraphQLFetch } from "./authed-fetch.js";

function stubFetch() {
  const spy = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

function headersOf(spy: ReturnType<typeof stubFetch>): Record<string, string> {
  return (spy.mock.calls[0][1] as { headers: Record<string, string> }).headers;
}

describe("authedGraphQLFetch", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("attaches the bearer when a token is available", async () => {
    const spy = stubFetch();
    await authedGraphQLFetch(
      "http://x/graphql/r",
      { query: "{a}" },
      () => Promise.resolve("tok123"),
    );
    expect(headersOf(spy).Authorization).toBe("Bearer tok123");
    expect(headersOf(spy)["Content-Type"]).toBe("application/json");
  });

  it("omits the header entirely when no token is available", async () => {
    const spy = stubFetch();
    await authedGraphQLFetch(
      "http://x/graphql/r",
      { query: "{a}" },
      () => Promise.resolve(undefined),
    );
    expect("Authorization" in headersOf(spy)).toBe(false);
  });

  it("posts the body as JSON to the given endpoint", async () => {
    const spy = stubFetch();
    await authedGraphQLFetch(
      "http://x/graphql",
      { query: "{a}", variables: { b: 1 } },
      () => Promise.resolve(undefined),
    );
    expect(spy.mock.calls[0][0]).toBe("http://x/graphql");
    const init = spy.mock.calls[0][1] as { method: string; body: string };
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ query: "{a}", variables: { b: 1 } });
  });

  it("does not throw when the token provider rejects", async () => {
    const spy = stubFetch();
    await expect(
      authedGraphQLFetch("http://x/graphql", { query: "{a}" }, () =>
        Promise.reject(new Error("no session")),
      ),
    ).rejects.toThrow("no session");
    expect(spy).not.toHaveBeenCalled();
  });
});
