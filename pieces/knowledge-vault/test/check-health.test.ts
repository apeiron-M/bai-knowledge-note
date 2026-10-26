import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { checkHealthAction, healthSummary, type HealthAnswer } from "../lib/actions/check-health.js";
import { VAULT_REST_PREFIX } from "../lib/common/client.js";

let server: Server | undefined;
afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

const answer: HealthAnswer = {
  reportId: "health-1",
  generatedAt: "2026-10-26T12:00:00.000Z",
  overallStatus: "WARN",
  metrics: { noteCount: 30, mocCount: 2, connectionCount: 54, orphanCount: 2, danglingLinkCount: 0, mocCoverage: 0.9, averageLinksPerNote: 1.8, density: 0.06 },
  checks: [
    { category: "ORPHAN_DETECTION", status: "WARN", message: "2 orphan note(s)" },
    { category: "LINK_HEALTH", status: "PASS", message: "Avg 1.8 links/note" },
  ],
  recommendations: ["Link the 2 orphan notes"],
  readBack: "confirmed",
};

/** The vault's REST surface, reduced to `POST health`: records what it was asked, answers with `status`. */
async function vault(status = 200, body: unknown = answer): Promise<{ base: string; asked: string[] }> {
  const asked: string[] = [];
  server = createServer((req, res) => {
    asked.push(`${req.method} ${req.url}`);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(status === 200 ? body : { error: { code: "NOT_FOUND", message: "No health report in this drive" } }));
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, asked };
}
const run = (base: string, when?: "idle" | "always") =>
  checkHealthAction.run({ auth: { type: "CUSTOM_AUTH", props: { base_url: base, token: "t" } }, propsValue: { drive: "drive-1", ...(when ? { when } : {}) } } as never) as Promise<Record<string, unknown>>;

describe("Check vault health (the pipeline's last step)", () => {
  it("asks the vault to grade itself and rewrite its report, and says what it found", async () => {
    const v = await vault();
    const out = await run(v.base);
    expect(v.asked).toEqual([`POST /${VAULT_REST_PREFIX}/health?drive=drive-1&by=vault-pipeline&when=idle`]);
    expect(out.overall_status).toBe("WARN");
    expect(out.summary).toBe("Health report rewritten: WARN (30 notes, 2 maps, 1.8 links per note). WARN ORPHAN_DETECTION: 2 orphan note(s)");
    expect(out.recommendations).toEqual(["Link the 2 orphan notes"]);
  });

  it("does not fail the pipeline on a vault that has no health report", async () => {
    const v = await vault(404);
    const out = await run(v.base);
    expect(out.overall_status).toBeNull();
    expect(String(out.summary)).toMatch(/no health report/);
  });

  it("says every check passes when nothing is open", () => {
    expect(healthSummary({ ...answer, overallStatus: "PASS", checks: [{ category: "LINK_HEALTH", status: "PASS", message: "ok" }] })).toMatch(/Every check passes\.$/);
  });

  it("leaves the report to the last source of a batch, and says so", async () => {
    const v = await vault(200, { reportId: "health-1", skipped: "busy", openTasks: 3 });
    const out = await run(v.base);
    expect(out).toMatchObject({ skipped: "busy", overall_status: null });
    expect(out.summary).toBe("Health report left for the last source in this batch: 3 other sources are still queued or being processed.");
  });

  it("says when the vault's health is what the report already says", async () => {
    const v = await vault(200, { reportId: "health-1", skipped: "unchanged", overallStatus: "PASS" });
    expect(await run(v.base)).toMatchObject({ skipped: "unchanged", overall_status: "PASS" });
  });

  it("set to every time, asks for a report on each run", async () => {
    const v = await vault();
    await run(v.base, "always");
    expect(v.asked).toEqual([`POST /${VAULT_REST_PREFIX}/health?drive=drive-1&by=vault-pipeline`]);
  });
});
