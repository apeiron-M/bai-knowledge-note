import { describe, expect, it } from "vitest";
import { createVaultApi, VaultApiFailure } from "./vault-api.js";

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/** A fetch that records what it was asked and answers with `respond`. */
function recording(
  respond: (url: string, init: RequestInit) => Response | Promise<Response>,
) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(respond(url, init));
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const token = () => Promise.resolve("t0k3n");

/** Awaits a call that must fail and hands back the typed failure. */
async function failureOf(call: Promise<unknown>): Promise<VaultApiFailure> {
  try {
    await call;
  } catch (error) {
    return error as VaultApiFailure;
  }
  throw new Error("the call did not fail");
}
const noToken = () => Promise.resolve(undefined);

describe("createVaultApi", () => {
  it("posts JSON to the package-namespaced path on the switchboard origin, with the bearer", async () => {
    const { calls, fetchImpl } = recording(() => ok({ id: "abc" }));
    const api = createVaultApi({
      fetchImpl,
      origin: "http://localhost:4001",
      tokenProvider: token,
    });

    const result = await api.post<{ id: string }>("/sources/folders", {
      drive: "vetra-a933d854",
      name: "Design for How People Think",
    });

    expect(result.id).toBe("abc");
    expect(calls[0].url).toBe(
      "http://localhost:4001/api/@powerhousedao/knowledge-note/sources/folders",
    );
    expect(calls[0].init.method).toBe("POST");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer t0k3n");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      drive: "vetra-a933d854",
      name: "Design for How People Think",
    });
  });

  it("sends no Authorization header when there is no session", async () => {
    // A host with auth off serves anonymous callers; a `Bearer undefined`
    // header would be refused by one with auth on.
    const { calls, fetchImpl } = recording(() => ok({}));
    await createVaultApi({
      fetchImpl,
      origin: "http://localhost:4001",
      tokenProvider: noToken,
    }).post("/sources", {});
    expect(
      (calls[0].init.headers as Record<string, string>).Authorization,
    ).toBeUndefined();
  });

  it("does not double up slashes between the origin and the path", async () => {
    const { calls, fetchImpl } = recording(() => ok({}));
    const api = createVaultApi({
      fetchImpl,
      origin: "http://localhost:4001//",
      tokenProvider: token,
    });
    await api.post("sources", {});
    await api.get("/convert/health");
    expect(calls[0].url).toBe(
      "http://localhost:4001/api/@powerhousedao/knowledge-note/sources",
    );
    expect(calls[1].url).toBe(
      "http://localhost:4001/api/@powerhousedao/knowledge-note/convert/health",
    );
  });

  it("sends a GET with the bearer and no body", async () => {
    // `GET convert/health` is how the picker learns its formats.
    const { calls, fetchImpl } = recording(() =>
      ok({ configured: true, formats: ["pdf"] }),
    );
    const api = createVaultApi({
      fetchImpl,
      origin: "http://localhost:4001",
      tokenProvider: token,
    });
    const health = await api.get<{ formats: string[] }>("/convert/health");
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].init.body).toBeUndefined();
    expect(
      (calls[0].init.headers as Record<string, string>).Authorization,
    ).toBe("Bearer t0k3n");
    expect(health.formats).toEqual(["pdf"]);
  });

  it("turns a refusal into a VaultApiFailure carrying the server's code and message", async () => {
    // The routes answer `{ error, code }` — routes/sources.ts throws
    // BAD_REQUEST / CREATE_FAILED / CONTAINMENT_FAILED, source-folders.ts
    // BAD_REQUEST. The UI shows the code when there is one, so the caller must
    // not have to parse a Response.
    const { fetchImpl } = recording(
      () =>
        new Response(
          JSON.stringify({
            error: "name is one folder, not a path",
            code: "BAD_REQUEST",
          }),
          {
            status: 400,
            headers: { "content-type": "application/json" },
          },
        ),
    );
    const api = createVaultApi({
      fetchImpl,
      origin: "http://localhost:4001",
      tokenProvider: token,
    });
    const failure = await failureOf(api.post("/sources/folders", {}));
    expect(failure).toBeInstanceOf(VaultApiFailure);
    expect(failure).toMatchObject({ status: 400, code: "BAD_REQUEST" });
    expect(failure.message).toContain("one folder, not a path");
  });

  it("survives a refusal that is not JSON", async () => {
    // A proxy or a crashed Switchboard answers HTML or nothing at all.
    const { fetchImpl } = recording(
      () => new Response("<html>502</html>", { status: 502 }),
    );
    const api = createVaultApi({
      fetchImpl,
      origin: "http://localhost:4001",
      tokenProvider: token,
    });
    const failure = await failureOf(api.post("/sources", {}));
    expect(failure).toMatchObject({ status: 502, code: "UNKNOWN" });
    expect(failure.message).toContain("502");
  });

  it("turns a network failure into a typed failure rather than a raw TypeError", async () => {
    const fetchImpl = (() =>
      Promise.reject(new Error("fetch failed"))) as unknown as typeof fetch;
    const api = createVaultApi({
      fetchImpl,
      origin: "http://localhost:4001",
      tokenProvider: token,
    });
    const failure = await failureOf(api.post("/sources", {}));
    expect(failure).toMatchObject({ status: 0, code: "UNREACHABLE" });
    expect(failure.message).toContain("fetch failed");
  });

  it("refuses to call anywhere when the switchboard origin cannot be resolved", async () => {
    // `resolveSwitchboardOrigin()` returns null off a known host. A request to
    // "" would hit Connect's own origin and fail confusingly; say so instead.
    const { calls, fetchImpl } = recording(() => ok({}));
    const api = createVaultApi({
      fetchImpl,
      origin: null,
      tokenProvider: token,
    });
    await expect(api.get("/convert/health")).rejects.toMatchObject({
      status: 0,
      code: "NO_ORIGIN",
    });
    expect(calls).toHaveLength(0);
  });
});

describe("createVaultApi — raw bodies", () => {
  it("sends the bytes as the body with the given content type, and the bearer, but no JSON header", async () => {
    // `authHeaders()` sets `Content-Type: application/json`; a raw upload must
    // carry exactly one content-type, the caller's.
    const { calls, fetchImpl } = recording(() => ok({ ok: true }));
    const bytes = new Uint8Array([37, 80, 68, 70]);
    await createVaultApi({
      fetchImpl,
      origin: "http://localhost:4001",
      tokenProvider: token,
    }).postRaw("/convert?filename=Book%20chapter.pdf", bytes, {
      contentType: "application/octet-stream",
    });
    expect(calls[0].url).toBe(
      "http://localhost:4001/api/@powerhousedao/knowledge-note/convert?filename=Book%20chapter.pdf",
    );
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.body).toBe(bytes);
    const headers = calls[0].init.headers as Record<string, string>;
    const contentTypes = Object.entries(headers).filter(
      ([k]) => k.toLowerCase() === "content-type",
    );
    expect(contentTypes).toEqual([
      ["Content-Type", "application/octet-stream"],
    ]);
    expect(headers.Authorization).toBe("Bearer t0k3n");
  });

  it("defaults the content type to octet-stream", async () => {
    const { calls, fetchImpl } = recording(() => ok({}));
    await createVaultApi({
      fetchImpl,
      origin: "http://localhost:4001",
      tokenProvider: token,
    }).postRaw("/convert?filename=a.md", new Uint8Array([1]));
    expect(
      (calls[0].init.headers as Record<string, string>)["Content-Type"],
    ).toBe("application/octet-stream");
  });
});
