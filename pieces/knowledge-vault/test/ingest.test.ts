import { describe, expect, it } from "vitest";
import { ingestSourceAction } from "../lib/actions/ingest-source.js";
import { ingestSource, realLineBreaks, toUtcInstant } from "../lib/agent/ingest.js";
import type { KnowledgeVaultClient, RequestOptions } from "../lib/common/client.js";

function vault(task = true) {
  const requests: RequestOptions[] = [];
  let n = 0;
  const client = {
    request: async (o: RequestOptions) => {
      requests.push(o);
      if (o.path === "sources/folders") return { id: "fold-1", name: "Meeting notes", created: true };
      if (o.path === "sources") return { id: `src-${++n}`, status: "EXTRACTING", ...(task ? { task: { id: "t1", created: true } } : {}) };
      throw new Error(`no route ${o.path}`);
    },
  } as unknown as KnowledgeVaultClient;
  return { client, requests };
}
function memoryStore() {
  const m = new Map<string, unknown>();
  return { get: async (k: string) => m.get(k), put: async (k: string, v: unknown) => (m.set(k, v), v) };
}
const note = { drive: "d", title: "  BAI Weekly Demo - 2026/09/11  ", content: "Paperless NGX integration\n- Teep demonstrated…", sourceType: "CONVERSATION" as const, queue: true };

describe("ingesting a source", () => {
  it("creates it in its folder, queued, with a UTC date, and says so", async () => {
    const v = vault();
    const out = await ingestSource(v.client, memoryStore(), { ...note, folder: "Meeting notes", url: "https://docs.google.com/document/d/abc", author: "teep - Powerhouse", publishedAt: "2026-09-11T11:45:00-03:00", dedupeKey: "abc", tool: "google-apps-script", description: " Quick notes " });
    expect(out).toMatchObject({ skipped: false, source_id: "src-1", folder_id: "fold-1", queued: true, published_at: "2026-09-11T14:45:00.000Z" });
    expect(out.summary).toBe('Ingested "BAI Weekly Demo - 2026/09/11" as a conversation source in /sources/Meeting notes, queued for extraction.');
    expect(v.requests.map((r) => r.path)).toEqual(["sources/folders", "sources"]);
    expect(v.requests[1].json).toEqual({
      drive: "d", title: "BAI Weekly Demo - 2026/09/11", content: "Paperless NGX integration\n- Teep demonstrated…", sourceType: "CONVERSATION",
      description: "Quick notes", author: "teep - Powerhouse", url: "https://docs.google.com/document/d/abc", publishedAt: "2026-09-11T14:45:00.000Z",
      method: "workflow", tool: "google-apps-script", queue: true, parentFolder: "fold-1",
    });
  });

  it("skips a repeat of the same dedupe key, per vault", async () => {
    const v = vault();
    const store = memoryStore();
    await ingestSource(v.client, store, { ...note, dedupeKey: "doc-1" });
    const again = await ingestSource(v.client, store, { ...note, dedupeKey: "doc-1" });
    expect(again).toMatchObject({ skipped: true, source_id: "src-1", queued: false });
    expect(again.summary).toMatch(/Already ingested .* skipped/);
    expect(v.requests.filter((r) => r.path === "sources")).toHaveLength(1);
    expect((await ingestSource(v.client, store, { ...note, drive: "other", dedupeKey: "doc-1" })).skipped).toBe(false);
    // Without a key, or a store, every delivery is a new source.
    expect((await ingestSource(v.client, store, note)).skipped).toBe(false);
    expect((await ingestSource(v.client, undefined, { ...note, dedupeKey: "doc-1" })).skipped).toBe(false);
  });

  it("says when it could not queue, and when asked not to", async () => {
    expect((await ingestSource(vault(false).client, undefined, note)).summary).toMatch(/has no pipeline queue, so it is not queued/);
    const off = await ingestSource(vault().client, undefined, { ...note, queue: false });
    expect(off).toMatchObject({ queued: false });
    expect(off.summary).toMatch(/, not queued\.$/);
  });

  it("refuses a source without a title or content", async () => {
    await expect(ingestSource(vault().client, undefined, { ...note, title: " " })).rejects.toThrow("A source needs a title");
    await expect(ingestSource(vault().client, undefined, { ...note, content: "\n " })).rejects.toThrow(/has no content/);
  });

  it("reads dates the vault would refuse, and turns escaped line breaks into real ones", () => {
    expect(toUtcInstant("Mon, 28 Sep 2026 10:00:00 +0200")).toBe("2026-09-28T08:00:00.000Z");
    expect(toUtcInstant("2026-09-11")).toBe("2026-09-11T00:00:00.000Z");
    expect(toUtcInstant("soon")).toBeNull();
    expect(toUtcInstant(undefined)).toBeNull();
    expect(realLineBreaks("a\\nb\\r\\nc\\td")).toBe("a\nb\nc\td");
    expect(realLineBreaks("a\\rb")).toBe("a\nb");
    // Text that already has real breaks keeps a literal \n as written (code, LaTeX).
    expect(realLineBreaks("x = '\\n'\ny")).toBe("x = '\\n'\ny");
  });
});

describe("the Ingest source action", () => {
  it("maps its fields, defaulting to a queued conversation source", async () => {
    const real = globalThis.fetch;
    const bodies: unknown[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/sources")) bodies.push(JSON.parse(init?.body as string));
      return new Response(JSON.stringify({ id: "src-9", status: "EXTRACTING", task: { id: "t", created: true } }), { status: 201 });
    }) as typeof fetch;
    try {
      const store = memoryStore();
      const run = (propsValue: Record<string, unknown>) => (ingestSourceAction as unknown as { run(c: unknown): Promise<Record<string, unknown>> }).run({ auth: { props: { base_url: "https://v.test", token: "t" } }, store, propsValue });
      const out = await run({ drive: "d", title: "Notes", content: "text", source_type: "bogus", dedupe_key: 42 });
      expect(out).toMatchObject({ source_id: "src-9", queued: true });
      expect(bodies[0]).toMatchObject({ sourceType: "CONVERSATION", queue: true, tool: "knowledge-vault piece" });
      expect((await run({ drive: "d", title: "Notes", content: "text", dedupe_key: 42 })).skipped).toBe(true);
      await run({ drive: "d", title: "Paper", content: "text", source_type: "PAPER", queue: false });
      expect(bodies[1]).toMatchObject({ sourceType: "PAPER", queue: false });
    } finally {
      globalThis.fetch = real;
    }
  });
});
