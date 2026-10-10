import type { RouteContext } from "@powerhousedao/shared/processors";
import { describe, expect, it } from "vitest";
import type { ConversionService } from "../lib/service.js";
import { createHealthRoute } from "./health.js";

const ctx = (user = true) =>
  ({
    params: {},
    user: user ? { address: "0xabc" } : undefined,
    authEnabled: true,
  }) as RouteContext;

const stubService = (
  over: Partial<ConversionService> = {},
): ConversionService => ({
  convert: async () => ({ markdown: "", chunks: [] }),
  progress: async () => null,
  cancel: () => Promise.resolve(false),
  health: async () => ({
    ok: true,
    backend: "docling.rs",
    ready: true,
    missing: [],
    formats: ["md", "pdf"],
  }),
  ...over,
});

const GET = () => new Request("http://vault.test/x/convert/health");

describe("createHealthRoute", () => {
  it("passes the backend's readiness through, with configured: true", async () => {
    const handler = createHealthRoute({ service: stubService() });
    const body = (await (await handler(GET(), ctx())).json()) as Record<
      string,
      unknown
    >;
    expect(body.backend).toBe("docling.rs");
    expect(body.ready).toBe(true);
    expect(body.configured).toBe(true);
  });

  it("reports configured: false at 200 when no backend is configured", async () => {
    // Not a 503: the vault works without a conversion service, so a health
    // probe must not read a working deployment as broken.
    const handler = createHealthRoute({});
    const res = await handler(GET(), ctx());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.configured).toBe(false);
    expect(body.ok).toBe(false);
  });

  it("reports configured but not ok when the backend is unreachable", async () => {
    const handler = createHealthRoute({
      service: stubService({
        health: async () => {
          throw new Error("ECONNREFUSED");
        },
      }),
    });
    const res = await handler(GET(), ctx());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.configured).toBe(true);
    expect(body.ok).toBe(false);
  });

  it("reports the vault's upload cap in every state, so a client checks a file before sending it", async () => {
    type Cap = { configured: boolean; ok: boolean; maxUploadBytes: number };
    const read = async (res: Response) => (await res.json()) as Cap;
    const big = 100 * 1024 * 1024;
    const up = await read(await createHealthRoute({ service: stubService(), maxUploadBytes: big })(GET(), ctx()));
    expect(up.maxUploadBytes).toBe(big);
    const none = await read(await createHealthRoute({ maxUploadBytes: big })(GET(), ctx()));
    expect(none).toMatchObject({ configured: false, maxUploadBytes: big });
    const unreachable = stubService({ health: () => Promise.reject(new Error("ECONNREFUSED")) });
    const down = await read(await createHealthRoute({ service: unreachable })(GET(), ctx()));
    expect(down).toMatchObject({ configured: true, ok: false, maxUploadBytes: 30 * 1024 * 1024 });
  });

  it("requires a verified caller", async () => {
    const handler = createHealthRoute({ service: stubService() });
    const res = await handler(GET(), ctx(false));
    expect(res.status).toBe(401);
    expect(((await res.json()) as Record<string, unknown>).code).toBe(
      "UNAUTHENTICATED",
    );
  });

  it("includes the formats the backend supports, so the app can gate by format", async () => {
    const handler = createHealthRoute({ service: stubService() });
    const body = (await (await handler(GET(), ctx())).json()) as Record<
      string,
      unknown
    >;
    expect(body.formats).toEqual(["md", "pdf"]);
    expect(body.missing).toEqual([]);
  });
});
