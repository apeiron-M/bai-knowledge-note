import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A conversion's answer, kept a while after it is made. The page that asked
 * may be gone by then — reloaded, its window restarted, closed by mistake —
 * while the service carried on to the end: the convert request cannot follow
 * its caller hanging up (routes/convert.ts says why). A page that remembers
 * its job asks again (`GET convert/result/:job`, routes/result.ts) and picks
 * the answer up instead of converting the file a second time — for a book,
 * a quarter of an hour saved.
 *
 * On disk, not in memory: a book's answer runs to tens of megabytes. Kept for
 * `KEEP_MS`, at most `KEEP_COUNT` answers, the oldest dropped first, and only
 * for the user who started the job. Lost with the process: after a restart the
 * page converts the file again from the bytes it kept.
 */
export const KEEP_MS = 30 * 60_000;
export const KEEP_COUNT = 4;

/** The ids a page mints (`crypto.randomUUID()`); anything else is never kept. */
const JOB = /^[A-Za-z0-9_-]{1,128}$/;

export type KeptAnswer =
  | { kind: "running" }
  | { kind: "done"; body: string }
  | { kind: "failed"; status: number; body: string };

export type KeptResults = {
  /** A conversion with this job has started for `owner`: asking for it answers "still running". */
  begin(job: string, owner: string): void;
  /** Its answer — or its failure, by status — kept for `KEEP_MS`. Only a job begun here is kept. */
  keep(job: string, status: number, body: string): Promise<void>;
  /** What is known of the job, for its owner; null when nothing is: never begun here, expired, or lost. */
  read(job: string, owner: string): Promise<KeptAnswer | null>;
};

export function createKeptResults(
  options: { dir?: string; now?: () => number } = {},
): KeptResults {
  const now = options.now ?? Date.now;
  const dir =
    options.dir ?? join(tmpdir(), "bai-convert-results", String(process.pid));
  const running = new Map<string, string>();
  const kept = new Map<
    string,
    { owner: string; status: number; path: string; at: number }
  >();
  let made: Promise<unknown> | null = null;

  async function drop(job: string) {
    const entry = kept.get(job);
    if (!entry) return;
    kept.delete(job);
    await rm(entry.path, { force: true }).catch(() => {});
  }

  async function sweep() {
    const cutoff = now() - KEEP_MS;
    for (const [job, entry] of [...kept]) {
      if (entry.at < cutoff) await drop(job);
    }
    const oldestFirst = [...kept].sort((a, b) => a[1].at - b[1].at);
    while (oldestFirst.length > KEEP_COUNT) {
      const oldest = oldestFirst.shift();
      if (oldest) await drop(oldest[0]);
    }
  }

  return {
    begin(job, owner) {
      if (!JOB.test(job)) return;
      void drop(job);
      running.set(job, owner);
    },
    async keep(job, status, body) {
      const owner = running.get(job);
      if (owner === undefined) return;
      running.delete(job);
      try {
        made ??= mkdir(dir, { recursive: true });
        await made;
        const path = join(dir, `${job}.json`);
        await writeFile(path, body);
        kept.set(job, { owner, status, path, at: now() });
        await sweep();
      } catch {
        // Not kept: a page that comes back for it converts the file again.
        made = null;
      }
    },
    async read(job, owner) {
      if (!JOB.test(job)) return null;
      const runningFor = running.get(job);
      if (runningFor !== undefined) {
        return runningFor === owner ? { kind: "running" } : null;
      }
      const entry = kept.get(job);
      if (!entry || entry.owner !== owner) return null;
      if (entry.at < now() - KEEP_MS) {
        await drop(job);
        return null;
      }
      try {
        const body = await readFile(entry.path, "utf8");
        return entry.status < 400
          ? { kind: "done", body }
          : { kind: "failed", status: entry.status, body };
      } catch {
        await drop(job);
        return null;
      }
    },
  };
}

let shared: KeptResults | null = null;

/** The process's answers: the convert route keeps them, the result route reads them. */
export function sharedKeptResults(): KeptResults {
  shared ??= createKeptResults();
  return shared;
}

/** Whose job it is: the caller's address, as the routes see it. */
export function ownerOf(user: { address: string }): string {
  return user.address.toLowerCase();
}
