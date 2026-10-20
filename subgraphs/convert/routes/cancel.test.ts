import type { RouteContext } from "@powerhousedao/shared/processors";
import { describe, expect, it, vi } from "vitest";
import { HttpError } from "../lib/respond.js";
import type { ConversionService } from "../lib/service.js";
import { createCancelRoute } from "./cancel.js";

const ctx = (job: string | undefined, user = true) =>
  ({
    params: job === undefined ? {} : { job },
    user: user ? { address: "0xabc" } : undefined,
    authEnabled: true,
  }) as unknown as RouteContext;

const service = (cancel: ConversionService["cancel"]): ConversionService => ({
  convert: () => Promise.resolve({ markdown: "", chunks: [] }),
  progress: () => Promise.resolve(null),
  cancel,
  health: () =>
    Promise.resolve({
      ok: true,
      backend: "docling.rs",
      ready: true,
      missing: [],
      formats: [],
    }),
});

const DELETE = () =>
  new Request("http://vault.test/x/convert/abc", { method: "DELETE" });

const read = async (res: Response) =>
  (await res.json()) as { cancelled?: boolean; code?: string };

describe("createCancelRoute", () => {
  it("passes the service's 200 { cancelled: true } through for a running job", async () => {
    const cancel = vi.fn(() => Promise.resolve(true));
    const res = await createCancelRoute({ service: service(cancel) })(
      DELETE(),
      ctx("4f0c2a1e-9b7d-4c1a-8e2f-0a1b2c3d4e5f"),
    );
    expect(res.status).toBe(200);
    expect(await read(res)).toEqual({ cancelled: true });
    expect(cancel).toHaveBeenCalledWith("4f0c2a1e-9b7d-4c1a-8e2f-0a1b2c3d4e5f");
  });

  it("answers 404 { cancelled: false } for a job that is not running", async () => {
    const res = await createCancelRoute({
      service: service(() => Promise.resolve(false)),
    })(DELETE(), ctx("job_1"));
    expect(res.status).toBe(404);
    expect(await read(res)).toEqual({ cancelled: false });
  });

  it("requires a verified caller", async () => {
    const cancel = vi.fn(() => Promise.resolve(true));
    const res = await createCancelRoute({ service: service(cancel) })(
      DELETE(),
      ctx("abc", false),
    );
    expect(res.status).toBe(401);
    expect((await read(res)).code).toBe("UNAUTHENTICATED");
    expect(cancel).not.toHaveBeenCalled();
  });

  it("refuses a job id the service would not accept, without asking it", async () => {
    const cancel = vi.fn(() => Promise.resolve(true));
    const handler = createCancelRoute({ service: service(cancel) });
    for (const bad of ["a b", "../etc", "x".repeat(81), "", undefined]) {
      const res = await handler(DELETE(), ctx(bad));
      expect(res.status).toBe(400);
      expect((await read(res)).code).toBe("INVALID_JOB");
    }
    expect(cancel).not.toHaveBeenCalled();
  });

  it("answers 503 CONVERT_NOT_CONFIGURED when no service is configured", async () => {
    const res = await createCancelRoute({})(DELETE(), ctx("abc"));
    expect(res.status).toBe(503);
    expect((await read(res)).code).toBe("CONVERT_NOT_CONFIGURED");
  });

  it("reports a service that cannot be reached as the service's error", async () => {
    const res = await createCancelRoute({
      service: service(() =>
        Promise.reject(
          new HttpError(
            502,
            "CONVERT_UNAVAILABLE",
            "Conversion service unreachable",
          ),
        ),
      ),
    })(DELETE(), ctx("abc"));
    expect(res.status).toBe(502);
    expect((await read(res)).code).toBe("CONVERT_UNAVAILABLE");
  });
});
