import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createKeptResults, KEEP_COUNT, KEEP_MS } from "./kept.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("kept conversion answers", () => {
  it("answers running, then the body, only to the owner, until it expires or is crowded out", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kept-"));
    dirs.push(dir);
    let clock = 1_000;
    const kept = createKeptResults({ dir, now: () => clock });

    expect(await kept.read("job-1", "0xa")).toBeNull();
    kept.begin("job-1", "0xa");
    expect(await kept.read("job-1", "0xa")).toEqual({ kind: "running" });
    // Someone else's job is not theirs to see, running or done.
    expect(await kept.read("job-1", "0xb")).toBeNull();

    await kept.keep("job-1", 200, '{"sections":[]}');
    expect(await kept.read("job-1", "0xa")).toEqual({ kind: "done", body: '{"sections":[]}' });
    expect(await kept.read("job-1", "0xb")).toBeNull();

    // A failure is kept by its status.
    kept.begin("job-2", "0xa");
    await kept.keep("job-2", 502, '{"code":"CONVERT_FAILED","error":"boom"}');
    expect(await kept.read("job-2", "0xa")).toEqual({
      kind: "failed",
      status: 502,
      body: '{"code":"CONVERT_FAILED","error":"boom"}',
    });

    // Only a job begun here is kept; ids a page would not mint are ignored.
    await kept.keep("never-begun", 200, "{}");
    expect(await kept.read("never-begun", "0xa")).toBeNull();
    kept.begin("../escape", "0xa");
    await kept.keep("../escape", 200, "{}");
    expect(await kept.read("../escape", "0xa")).toBeNull();

    // The oldest goes first past KEEP_COUNT.
    for (let i = 0; i < KEEP_COUNT; i++) {
      clock += 1;
      kept.begin(`more-${i}`, "0xa");
      await kept.keep(`more-${i}`, 200, "{}");
    }
    expect(await kept.read("job-1", "0xa")).toBeNull();
    expect((await readdir(dir)).length).toBe(KEEP_COUNT);

    // And everything goes after KEEP_MS.
    clock += KEEP_MS + 1;
    expect(await kept.read(`more-${KEEP_COUNT - 1}`, "0xa")).toBeNull();
  });
});
