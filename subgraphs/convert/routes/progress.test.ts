import type { RouteContext } from "@powerhousedao/shared/processors";
import { describe, expect, it } from "vitest";
import type { ConversionService } from "../lib/service.js";
import { createProgressRoute } from "./progress.js";

const ctx = (job: string, user = true) =>
  ({
    params: { job },
    user: user ? { address: "0xabc" } : undefined,
    authEnabled: true,
  }) as unknown as RouteContext;

const service = (
  progress: ConversionService["progress"],
): ConversionService => ({
  convert: async () => ({ markdown: "", chunks: [] }),
  health: async () => ({
    ok: true,
    backend: "docling.rs",
    ready: true,
    missing: [],
    formats: [],
  }),
  progress,
});

const GET = () => new Request("http://vault.test/x/convert/progress/abc");

describe("createProgressRoute", () => {
  it("passes the service's measured progress through", async () => {
    const handler = createProgressRoute({
      service: service(async () => ({
        phase: "reading",
        pages: 23,
        pagesDone: 12,
        elapsedMs: 6000,
      })),
    });
    const res = await handler(GET(), ctx("abc"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      phase: "reading",
      pages: 23,
      pagesDone: 12,
      elapsedMs: 6000,
    });
  });

  it("answers 404 for a job the service no longer knows, so the poller stops", async () => {
    const handler = createProgressRoute({ service: service(async () => null) });
    const res = await handler(GET(), ctx("gone"));
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe("JOB_NOT_FOUND");
  });

  it("requires a verified caller and a configured service", async () => {
    expect(
      (await createProgressRoute({})(GET(), ctx("abc", false))).status,
    ).toBe(401);
    expect((await createProgressRoute({})(GET(), ctx("abc"))).status).toBe(503);
  });
});
