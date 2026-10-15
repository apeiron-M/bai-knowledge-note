# Extraction Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make extraction keep real claims on a local model, then re-run the 48 sources the old extractor left empty. Four changes do it:
- read long sources in windows sized for the model;
- remove the undefined gate from the prompt;
- archive sources that hold no knowledge;
- link a claim found in two sources to both.

**Architecture:**
- **Extraction:** every change lives in the workflow piece's Extract claims step (`pieces/knowledge-vault/lib/agent/*`), so neither workflow template changes.
  - A new `windows.ts` cuts the text.
  - `LlmClient.active()` asks the desktop app's gateway which model is live, so window size, pace and call timeouts follow a model switch.
  - Connect, Place, Verify and the server's catch-up learn two things: an archived source is finished, and a listed note that came from another source is not theirs to work on.
- **The desktop app:** it gains `GET /llm/v1/active` on its gateway and a one-time rule in its queue watchdog.

**Tech Stack:**
- **Language:** TypeScript; node at runtime, bun locally.
- **Checks:** vitest and oxlint.
- **Runtime:** the Powerhouse workflow-piece framework, and the vault package's REST routes.

**Spec:** `docs/superpowers/specs/2026-10-15-extraction-quality-design.md`

**Repos and branches:**
- `bai-knowledge-note` (Tasks 1–11), on its current branch.
- `knowledge-vault-app` (Tasks 12–15), on `dev`.

## Global Constraints

- **Window sizes:**
  - 8,000 characters on a local model, 24,000 on a hosted one.
  - Capped at a quarter of a known context size, counting 3.5 characters per token.
  - Never below 2,000.
  - An optional "Window size" override, in characters.
- **Pace:** one window at a time on a local model, up to three on a hosted one.
- **Drafting:** at most 8 claims per call on a local model, 16 on a hosted one. Each call carries only its window's text.
- **Convergence** needs all three:
  - similarity ≥ 0.75;
  - the note is not archived;
  - the note has no incoming `SUPERSEDES`.
- **The extractor's mark:** extraction stats carry `extractedBy: "extract-claims 2 · <model>"`; the old mark is `extract-claims · <model>`. The provenance author and the handoff's `completedBy` stay `extract-claims · <model>`.
- **Untouched:** `templates/pipeline.json`, `templates/reweave.json`, and every document model.
- **The source model's rule:** stats are refused unless `claimCount` equals the length of the source's claim list (`ExtractionStatsMismatchError`), so claims are added before stats.
- **Toolchain:** bun locally (`bunx vitest run …`, `bun run tsc`, `bun run lint`), and no Bun APIs in shipped code.
- **Commits:** every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A source that is one long paragraph with no blank lines**, as PDF text layers often are. Every window must still be at most the size, cut at sentence ends. (Task 1)
2. **A model that leaves out `source_kind`** or spells it differently must never get a source archived. (Task 3)
3. **The gateway's `/active` disappearing mid-run**, for example while the engine restarts. Calls fall back to the connection's settings and carry on. (Task 2)
4. **The same claim found in two windows of one source** becomes one note, not two. (Task 5)
5. **A model naming an existing note it was never shown, or a superseded one,** gets the claim written as a new note instead of linked. (Task 5)

---

### Task 1: Windows — cutting a source and choosing the size

**Files:**
- Create: `pieces/knowledge-vault/lib/agent/windows.ts`
- Test: `pieces/knowledge-vault/test/windows.test.ts`

**Interfaces:**
- Produces:
  - `LOCAL_WINDOW_CHARS = 8000`, `HOSTED_WINDOW_CHARS = 24000`, `MIN_WINDOW_CHARS = 2000`
  - `type Locality = "local" | "hosted"`
  - `type TextWindow = { id: string; heading: string | null; text: string }`
  - `paceFor(locality): number` (1 or 3)
  - `draftBatchFor(locality): number` (8 or 16)
  - `windowSize(args: { locality: Locality; contextTokens?: number | null; override?: number | null }): number`
  - `splitLong(text: string, size: number): string[]`
  - `class WindowCursor { constructor(text: string, prefix?: string); get done(): boolean; next(size: number): TextWindow | null; rest(): TextWindow | null }`
  - `splitInHalf(w: TextWindow): [TextWindow, TextWindow] | null`

- [ ] **Step 1: Write the failing tests**

```ts
// pieces/knowledge-vault/test/windows.test.ts
import { describe, expect, it } from "vitest";
import { draftBatchFor, HOSTED_WINDOW_CHARS, LOCAL_WINDOW_CHARS, MIN_WINDOW_CHARS, paceFor, splitInHalf, splitLong, WindowCursor, windowSize, type TextWindow } from "../lib/agent/windows.js";

/** A paragraph of exactly `chars` characters: "Paragraph N " then x's, ending with a full stop. */
const para = (n: number, chars = 1001) => {
  const head = `Paragraph ${n} `;
  return `${head}${"x".repeat(chars - head.length - 1)}.`;
};
const all = (cursor: WindowCursor, size: number) => {
  const out: TextWindow[] = [];
  for (let w = cursor.next(size); w; w = cursor.next(size)) out.push(w);
  return out;
};

describe("window size", () => {
  it("is 8,000 characters on a local model and 24,000 on a hosted one", () => {
    expect(windowSize({ locality: "local" })).toBe(LOCAL_WINDOW_CHARS);
    expect(windowSize({ locality: "hosted" })).toBe(HOSTED_WINDOW_CHARS);
    expect([paceFor("local"), paceFor("hosted")]).toEqual([1, 3]);
    expect([draftBatchFor("local"), draftBatchFor("hosted")]).toEqual([8, 16]);
  });
  it("is capped at a quarter of a known context, counting 3.5 characters per token", () => {
    expect(windowSize({ locality: "hosted", contextTokens: 16_000 })).toBe(14_000);
    expect(windowSize({ locality: "local", contextTokens: 32_768 })).toBe(8_000);
    expect(windowSize({ locality: "local", contextTokens: 1_000 })).toBe(MIN_WINDOW_CHARS);
  });
  it("takes an override, never below the minimum, and ignores one that is not a number", () => {
    expect(windowSize({ locality: "local", override: 12_000 })).toBe(12_000);
    expect(windowSize({ locality: "hosted", override: 500 })).toBe(MIN_WINDOW_CHARS);
    expect(windowSize({ locality: "local", override: null })).toBe(LOCAL_WINDOW_CHARS);
    expect(windowSize({ locality: "local", override: Number.NaN })).toBe(LOCAL_WINDOW_CHARS);
  });
});

describe("cutting windows", () => {
  it("breaks at paragraphs and stays within the size", () => {
    const text = [1, 2, 3, 4, 5].map((n) => para(n)).join("\n\n");
    const cursor = new WindowCursor(text);
    const windows = all(cursor, 2_500);
    expect(windows.map((w) => w.text.split("\n\n").length)).toEqual([2, 2, 1]);
    expect(windows.every((w) => w.text.length <= 2_500)).toBe(true);
    expect(windows.map((w) => w.id)).toEqual(["w1", "w2", "w3"]);
    expect(cursor.done).toBe(true);
  });
  it("keeps a heading with the text under it, and gives each window the heading it falls under", () => {
    const text = ["# Hardware", para(1), para(2), "## Memory", para(3)].join("\n\n");
    const cursor = new WindowCursor(text);
    const first = cursor.next(2_100)!;
    expect(first.heading).toBe("Hardware");
    expect(first.text.startsWith("# Hardware")).toBe(true);
    expect(first.text).not.toContain("## Memory");
    const second = cursor.next(2_100)!;
    expect(second.heading).toBe("Memory");
    expect(second.text.startsWith("## Memory")).toBe(true);
  });
  it("cuts a paragraph longer than a window at sentence ends, losing no text", () => {
    const long = Array.from({ length: 40 }, (_, i) => `Sentence ${i} says something about inference costs.`).join(" ");
    const windows = all(new WindowCursor(long), MIN_WINDOW_CHARS);
    expect(windows.length).toBeGreaterThan(1);
    expect(windows.every((w) => w.text.length <= MIN_WINDOW_CHARS)).toBe(true);
    expect(windows.every((w) => w.text.endsWith("."))).toBe(true);
    expect(windows.map((w) => w.text).join(" ").replace(/\s+/g, " ")).toBe(long);
  });
  it("cuts a source with no blank lines at all, as a PDF text layer often is", () => {
    const flat = "A claim about GPUs. ".repeat(1_000).trim();
    const sizes = all(new WindowCursor(flat), LOCAL_WINDOW_CHARS).map((w) => w.text.length);
    expect(sizes).toHaveLength(3);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(LOCAL_WINDOW_CHARS);
  });
  it("cuts a sentence longer than a window where it must", () => {
    expect(splitLong("y".repeat(5_000), 2_000).map((s) => s.length)).toEqual([2_000, 2_000, 1_000]);
  });
  it("hands out what is left as one window", () => {
    const cursor = new WindowCursor([para(1), para(2), para(3)].join("\n\n"));
    cursor.next(1_100);
    expect(cursor.rest()!.text.split("\n\n")).toHaveLength(2);
    expect(cursor.rest()).toBeNull();
  });
  it("splits a window in two near its middle, and not below the minimum", () => {
    const text = [1, 2, 3, 4, 5, 6].map((n) => para(n)).join("\n\n");
    const halves = splitInHalf({ id: "w4", heading: "Models", text })!;
    expect(halves.map((h) => h.id)).toEqual(["w4.1", "w4.2"]);
    expect(halves.map((h) => h.heading)).toEqual(["Models", "Models"]);
    expect(halves[0].text.split("\n\n")).toHaveLength(3);
    expect(`${halves[0].text}\n\n${halves[1].text}`).toBe(text);
    expect(splitInHalf({ id: "w1", heading: null, text: "x".repeat(2 * MIN_WINDOW_CHARS - 1) })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `bunx vitest run pieces/knowledge-vault/test/windows.test.ts`
Expected: FAIL, "Failed to load url ../lib/agent/windows.js" (the module does not exist yet)

- [ ] **Step 3: Write the module**

```ts
// pieces/knowledge-vault/lib/agent/windows.ts
/**
 * Long sources are read in windows. A model on this computer keeps its attention on about 8,000
 * characters; a hosted one on far more. A window breaks at a paragraph, keeps a heading with the
 * text under it, and cuts a paragraph longer than itself at sentence ends.
 */

export const LOCAL_WINDOW_CHARS = 8_000;
export const HOSTED_WINDOW_CHARS = 24_000;
export const MIN_WINDOW_CHARS = 2_000;
/** Characters per token, to turn a context size into characters: a conservative average for prose. */
const CHARS_PER_TOKEN = 3.5;

export type Locality = "local" | "hosted";
export type TextWindow = { id: string; heading: string | null; text: string };

/** How many windows run at once: one on this computer's model, three on a hosted one. */
export const paceFor = (locality: Locality): number => (locality === "local" ? 1 : 3);
/** How many claims one drafting call writes. */
export const draftBatchFor = (locality: Locality): number => (locality === "local" ? 8 : 16);

/** Characters per window for this model: its kind sets the base, a known context caps it, an override wins. */
export function windowSize(args: { locality: Locality; contextTokens?: number | null; override?: number | null }): number {
  const override = Number(args.override);
  if (args.override !== null && args.override !== undefined && Number.isFinite(override) && override > 0) return Math.max(MIN_WINDOW_CHARS, Math.round(override));
  const base = args.locality === "local" ? LOCAL_WINDOW_CHARS : HOSTED_WINDOW_CHARS;
  const context = Number(args.contextTokens);
  const cap = args.contextTokens && Number.isFinite(context) && context > 0 ? Math.floor(context * 0.25 * CHARS_PER_TOKEN) : Number.POSITIVE_INFINITY;
  return Math.max(MIN_WINDOW_CHARS, Math.min(base, cap));
}

type Unit = { text: string; heading: boolean };
const HEADING = /^#{1,6}\s+\S/;
const headingText = (line: string) => line.replace(/^#{1,6}\s+/, "").trim();

/** The text's paragraphs, in order; a one-line `# heading` paragraph is marked as a heading. */
function units(text: string): Unit[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => ({ text: p, heading: HEADING.test(p) && !p.includes("\n") }));
}

/** Text longer than `size`, cut at sentence ends; a sentence longer than `size` is cut where it must be. */
export function splitLong(text: string, size: number): string[] {
  const sentences = text.split(/(?<=[.!?]["')\]]*)\s+/).filter(Boolean);
  const out: string[] = [];
  let current = "";
  const push = () => {
    if (current) out.push(current);
    current = "";
  };
  for (const sentence of sentences) {
    if (sentence.length > size) {
      push();
      for (let i = 0; i < sentence.length; i += size) out.push(sentence.slice(i, i + size));
      continue;
    }
    if (current && current.length + 1 + sentence.length > size) push();
    current = current ? `${current} ${sentence}` : sentence;
  }
  push();
  return out;
}

/** Hands out a source's windows one at a time, so each is sized for the model answering when it is cut. */
export class WindowCursor {
  private queue: Unit[];
  private heading: string | null = null;
  private count = 0;

  constructor(text: string, private readonly prefix = "w") {
    this.queue = units(text);
  }

  get done(): boolean {
    return this.queue.length === 0;
  }

  /** The next window of at most `size` characters, or null when the text is used up. */
  next(size: number): TextWindow | null {
    if (this.queue.length === 0) return null;
    const taken: Unit[] = [];
    let length = 0;
    while (this.queue.length) {
      const unit = this.queue[0];
      const added = taken.length ? unit.text.length + 2 : unit.text.length;
      if (length + added <= size) {
        taken.push(unit);
        this.queue.shift();
        length += added;
        continue;
      }
      // Too long for what is left: cut it at sentences and take what fits, when the window is
      // empty or holds only the heading this text belongs under.
      const room = size - length - (taken.length ? 2 : 0);
      if (taken.length === 0 || (taken.length === 1 && taken[0].heading && room >= MIN_WINDOW_CHARS / 2)) {
        const [first, ...rest] = splitLong(unit.text, room);
        this.queue.splice(0, 1, ...rest.map((text) => ({ text, heading: false })));
        taken.push({ text: first, heading: false });
      }
      break;
    }
    // A heading never ends a window: it goes back to start the next one, with the text under it.
    while (taken.length > 1 && taken[taken.length - 1].heading) this.queue.unshift(taken.pop()!);
    const own = taken[0].heading ? headingText(taken[0].text) : this.heading;
    for (const u of taken) if (u.heading) this.heading = headingText(u.text);
    return { id: `${this.prefix}${++this.count}`, heading: own, text: taken.map((u) => u.text).join("\n\n") };
  }

  /** Everything not handed out yet, as one window. */
  rest(): TextWindow | null {
    if (this.queue.length === 0) return null;
    const own = this.queue[0].heading ? headingText(this.queue[0].text) : this.heading;
    const text = this.queue.map((u) => u.text).join("\n\n");
    this.queue = [];
    return { id: `${this.prefix}${++this.count}`, heading: own, text };
  }
}

/** A window cut in two near its middle, at a paragraph or a sentence; null when a half would be under the minimum. */
export function splitInHalf(w: TextWindow): [TextWindow, TextWindow] | null {
  if (w.text.length < 2 * MIN_WINDOW_CHARS) return null;
  const cursor = new WindowCursor(w.text, `${w.id}.`);
  const first = cursor.next(Math.ceil(w.text.length / 2));
  const second = cursor.rest();
  if (!first || !second) return null;
  return [
    { ...first, heading: first.heading ?? w.heading },
    { ...second, heading: second.heading ?? w.heading },
  ];
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `bunx vitest run pieces/knowledge-vault/test/windows.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add pieces/knowledge-vault/lib/agent/windows.ts pieces/knowledge-vault/test/windows.test.ts
git commit -m "feat(piece): cut long sources into windows sized for the model

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The model in charge — `LlmClient.active()` and per-call timeouts

**Files:**
- Modify: `pieces/knowledge-vault/lib/agent/llm.ts` (the `LlmClient` class at lines 69–142; `completeJson` at lines 150–229)
- Test: `pieces/knowledge-vault/test/staged.test.ts`. Add a `describe("the model in charge")` block, and update the `modelSays` helper.

**Interfaces:**
- Produces:
  - `type ActiveModel = { model: string | null; locality: "local" | "hosted"; contextTokens: number | null; fromGateway: boolean }`
  - `ACTIVE_TTL_MS = 5000`
  - `LlmClient.prototype.active(fetchImpl?: typeof fetch, fresh?: boolean): Promise<ActiveModel>`. Behind the desktop gateway it asks `/active`. On OpenRouter it reads the default model's `context_length` from the model list, once per run. Anywhere else it uses the connection's settings.
  - `completeJson`: same signature; each call now takes its timeout from `active()`.

- [ ] **Step 1: Make the test helper answer `/active` like a provider that has no gateway, then write the failing tests**

In `test/staged.test.ts`, in `modelSays`, add this as the first line inside `fetchImpl`, before `JSON.parse`:

```ts
    if (_u.endsWith("/active")) return new Response("no gateway", { status: 404 });
```

Then add `vi` to the vitest import and append:

```ts
describe("the model in charge", () => {
  const GATEWAY = { baseUrl: "http://127.0.0.1:4202/llm/v1", apiKey: "k", locality: "local" as const, defaultModel: "local-20b" };
  it("asks the desktop gateway which model is live, and keeps the answer for a few seconds", async () => {
    let asks = 0;
    const f = (async () => { asks++; return json({ model: "gpt-6.1-sol", locality: "hosted", contextTokens: null }); }) as unknown as typeof fetch;
    const llm = new LlmClient(GATEWAY, f);
    expect(await llm.active()).toEqual({ model: "gpt-6.1-sol", locality: "hosted", contextTokens: null, fromGateway: true });
    await llm.active();
    expect(asks).toBe(1);
    await llm.active(undefined, true);
    expect(asks).toBe(2);
  });
  it("uses the connection's settings without a gateway, and never asks for a connection the app did not set up", async () => {
    let asks = 0;
    const f = (async () => { asks++; return new Response("no", { status: 404 }); }) as unknown as typeof fetch;
    const llm = new LlmClient(GATEWAY, f);
    expect(await llm.active()).toEqual({ model: "local-20b", locality: "local", contextTokens: null, fromGateway: false });
    await llm.active(undefined, true);
    expect(asks).toBe(1); // a 404 means no gateway for the rest of the run
    const plain = new LlmClient({ baseUrl: "https://openrouter.ai/api/v1", apiKey: "k" }, f);
    expect((await plain.active()).locality).toBe("hosted");
    expect(asks).toBe(1);
  });
  it("reads a hosted model's context from OpenRouter's model list, once", async () => {
    let lists = 0;
    const f = (async (u: string) => {
      if (u.includes("/models")) { lists++; return json({ data: [{ id: "deepseek/v4", name: "DeepSeek V4", context_length: 16_000 }] }); }
      return new Response("no", { status: 404 });
    }) as unknown as typeof fetch;
    const llm = new LlmClient({ baseUrl: "https://openrouter.ai/api/v1", apiKey: "k", defaultModel: "deepseek/v4" }, f);
    expect(await llm.active()).toEqual({ model: "deepseek/v4", locality: "hosted", contextTokens: 16_000, fromGateway: false });
    await llm.active(undefined, true);
    expect(lists).toBe(1);
  });
  it("carries on with the connection's settings when the gateway stops answering", async () => {
    const llm = new LlmClient(GATEWAY, (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch);
    expect(await llm.active()).toMatchObject({ locality: "local", fromGateway: false });
  });
  it("gives each call the live model's timeout, and sends a call again once when the model changed while it hung", async () => {
    let live = { model: "gpt-6.1-sol", locality: "hosted" };
    let chats = 0;
    const timeouts = vi.spyOn(AbortSignal, "timeout");
    const f = (async (u: string) => {
      if (u.endsWith("/active")) return json({ ...live, contextTokens: null });
      chats++;
      if (chats === 1) {
        live = { model: "local-20b", locality: "local" };
        throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
      }
      return json({ choices: [{ message: { content: '{"ok":1}' } }] });
    }) as unknown as typeof fetch;
    const out = await completeJson(new LlmClient(GATEWAY, f), { model: "m", system: "s", user: "u" }, f);
    expect(out.value).toEqual({ ok: 1 });
    expect(chats).toBe(2);
    expect(timeouts.mock.calls.map((c) => c[0]).filter((ms) => ms !== 5_000)).toEqual([JSON_CALL_TIMEOUT_MS, LOCAL_CALL_TIMEOUT_MS]);
    timeouts.mockRestore();
  });
});
```

- [ ] **Step 2: Run the tests to see the new ones fail**

Run: `bunx vitest run pieces/knowledge-vault/test/staged.test.ts -t "the model in charge"`
Expected: FAIL with "llm.active is not a function"

- [ ] **Step 3: Implement `active()` and use it in `completeJson`**

In `llm.ts`, after `callTimeoutFor` (line 67), add:

```ts
/** The model a request will reach right now, where it runs, and its context size when known. */
export type ActiveModel = { model: string | null; locality: "local" | "hosted"; contextTokens: number | null; fromGateway: boolean };
/** How long the gateway's answer is trusted: windows and calls ask again after this. */
export const ACTIVE_TTL_MS = 5_000;
const timeoutForLocality = (locality: ActiveModel["locality"]) => (locality === "local" ? LOCAL_CALL_TIMEOUT_MS : JSON_CALL_TIMEOUT_MS);
```

In `class LlmClient`, add these fields and the method after `headers()`:

```ts
  private activeCache: { at: number; value: ActiveModel } | null = null;
  private noGateway = false;
  private providerContextCache: number | null | undefined;

  /** A hosted model's context size from OpenRouter's model list, read once per run; null for any other provider. */
  private async providerContext(fetchImpl?: typeof fetch): Promise<number | null> {
    if (this.providerContextCache !== undefined) return this.providerContextCache;
    this.providerContextCache = null;
    const model = this.credentials.defaultModel;
    if (!model || !/openrouter\.ai/i.test(this.credentials.baseUrl)) return null;
    try {
      const models = await new LlmClient(this.credentials, fetchImpl ?? this.fetchImpl).listModels(false);
      this.providerContextCache = models.find((m) => m.id === model)?.contextLength ?? null;
    } catch {
      this.providerContextCache = null;
    }
    return this.providerContextCache;
  }

  /**
   * The model the endpoint answers with now. The desktop app's gateway says so (GET /active) and
   * follows the user's model switches; only connections the app set up carry a locality, so only
   * they ask. Any other endpoint, or an ask that fails, gets the connection's own settings.
   */
  async active(fetchImpl?: typeof fetch, fresh = false): Promise<ActiveModel> {
    const fallback: ActiveModel = { model: this.credentials.defaultModel ?? null, locality: isLocalModel(this.credentials) ? "local" : "hosted", contextTokens: null, fromGateway: false };
    // A connection the desktop app did not set up has no gateway behind it; OpenRouter still says how big its model's context is.
    if (!this.credentials.locality) return { ...fallback, contextTokens: await this.providerContext(fetchImpl) };
    if (this.noGateway) return fallback;
    if (!fresh && this.activeCache && Date.now() - this.activeCache.at < ACTIVE_TTL_MS) return this.activeCache.value;
    try {
      const response = await (fetchImpl ?? this.fetchImpl)(`${this.credentials.baseUrl}/active`, { headers: this.headers(), signal: AbortSignal.timeout(5_000) });
      if (response.status >= 400 && response.status < 500) {
        // Not the desktop gateway, or one from before /active: its settings stand for the rest of the run.
        this.noGateway = true;
        return fallback;
      }
      if (!response.ok) return fallback;
      const body = (await response.json()) as { model?: unknown; locality?: unknown; contextTokens?: unknown };
      if (body.locality !== "local" && body.locality !== "hosted") return fallback;
      const value: ActiveModel = {
        model: typeof body.model === "string" && body.model.trim() ? body.model : fallback.model,
        locality: body.locality,
        contextTokens: typeof body.contextTokens === "number" && body.contextTokens > 0 ? body.contextTokens : null,
        fromGateway: true,
      };
      this.activeCache = { at: Date.now(), value };
      return value;
    } catch {
      return fallback;
    }
  }
```

Replace the body of `completeJson` from `let budget = …` down to the `let response: Response;` line, and both `catch` blocks that call `retryable`, with:

```ts
  let budget = request.maxTokens ?? 32_000;
  let resentAfterSwitch = false;
  for (let attempt = 1; ; attempt++) {
    // Asked before every call: a model switched mid-run gets its own timeout from the next call on.
    const sentWith = await client.active(fetchImpl);
    const timeoutMs = request.timeoutMs ?? timeoutForLocality(sentWith.locality);
    // A hang, or a connection dropped before or while the answer arrives, gets one more try.
    const retryable = (error: unknown) => attempt < 2 && (isTimeout(error) || isDroppedConnection(error));
    const fail = (error: unknown): never => {
      if (isTimeout(error)) throw new KnowledgeVaultApiError(`${request.model} did not answer within ${Math.round(timeoutMs / 1000)} s, twice. Run the step again, or choose a faster model.`, { category: "timeout", retryable: true });
      throw error;
    };
    // A call that timed out after the user switched models is sent once more under the new model's timeout.
    const resendAfterSwitch = async (error: unknown): Promise<boolean> => {
      if (resentAfterSwitch || !isTimeout(error)) return false;
      const now = await client.active(fetchImpl, true);
      if (now.model === sentWith.model && now.locality === sentWith.locality) return false;
      resentAfterSwitch = true;
      attempt--;
      return true;
    };
    let response: Response;
```

Then, in the request's `try/catch` and in the body-read `try/catch`, start each `catch` with:

```ts
      if (await resendAfterSwitch(error)) continue;
```

The two `catch` blocks then read:

```ts
    } catch (error) {
      if (await resendAfterSwitch(error)) continue;
      if (retryable(error)) continue;
      return fail(error);
    }
```

Leave the rest of `completeJson` as it is. It still uses `${baseUrl}` and `apiKey` from `client.credentials`.

- [ ] **Step 4: Run the whole staged suite**

Run: `bunx vitest run pieces/knowledge-vault/test/staged.test.ts`
Expected: PASS. The existing tests are unaffected: their credentials carry no `locality`, so `active()` never asks.

- [ ] **Step 5: Commit**

```bash
git add pieces/knowledge-vault/lib/agent/llm.ts pieces/knowledge-vault/test/staged.test.ts
git commit -m "feat(piece): ask the desktop gateway which model is live; time each call for it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The candidate prompt, read window by window

**Files:**
- Modify: `pieces/knowledge-vault/lib/agent/extract.ts:11,22` (the gates)
- Modify: `pieces/knowledge-vault/lib/agent/staged.ts:121-212` (the candidate prompt and stage)
- Test: `pieces/knowledge-vault/test/staged.test.ts` (the `describe("2. candidates")` block)

**Interfaces:**
- Consumes: Task 1's `WindowCursor`, `splitInHalf`, `windowSize`, `paceFor`, `MIN_WINDOW_CHARS` and `TextWindow`; Task 2's `LlmClient.active()`.
- Produces:
  - `GATES` (without `out_of_scope`) and `OTHER_GATE = "other"`.
  - `SkippedCandidate.gate: (typeof GATES)[number] | "other"`.
  - `candidatesForWindow(llm, model, title, window, wholeSource, fetchImpl?): Promise<WindowCandidates>`.
  - `candidatesStage(llm, model, bundle, fetchImpl?, opts?: { windowChars?: number | null })`, returning everything it returns today plus:
    - each `kept[]` item gains `window: string`;
    - `windows: TextWindow[]` (the windows that were read);
    - `window_count: number`;
    - `empty_parts: string[]` and `unreadable_parts: string[]`;
    - `other_gate_count: number`;
    - `source_kind: "knowledge" | "not_knowledge"` and `source_kind_reason: string`.

- [ ] **Step 1: Update the existing expectation and write the failing tests**

In `test/staged.test.ts`, in "keeps real claims and strikes what the model waved through", update three expectations: a kept claim now says which window it came from, and the unknown gate is now counted as "other":

```ts
    expect(out.kept).toEqual([{ id: "c1", claim: "Budget stops separating organizations once spend is routine", locus: "p1", evidence: "e", window: "w1" }]);
    expect(out.skipped.map((s) => s.gate)).toEqual(["falsifiability", "sentence", "other"]);
    …
    expect(out.summary).toBe("4 distinct claims: 1 kept, 3 rejected on a gate (1 for a reason outside the gates); 4 non-claims (headings, captions, bare statistics).");
```

Add, inside `describe("2. candidates")`:

```ts
  /** A gateway that says which model is live (`live`), and answers each chat call with the next answer. */
  function gateway(answers: string[], live: { locality: string; model: string; contextTokens?: number | null } = { locality: "local", model: "local-20b" }) {
    let i = 0;
    let running = 0;
    const seen: { user: string }[] = [];
    const peak = { n: 0 };
    const fetchImpl = (async (u: string, init?: RequestInit) => {
      if (u.endsWith("/active")) return json({ contextTokens: null, ...live });
      const body = JSON.parse(init?.body as string) as { messages: { content: string }[] };
      seen.push({ user: body.messages[1].content });
      peak.n = Math.max(peak.n, ++running);
      await new Promise((r) => setTimeout(r, 2));
      running--;
      return json({ choices: [{ message: { content: answers[Math.min(i++, answers.length - 1)] } }] });
    }) as unknown as typeof fetch;
    const llm = new LlmClient({ baseUrl: "http://127.0.0.1:4202/llm/v1", apiKey: "k", locality: "local" }, fetchImpl);
    return { llm, fetchImpl, seen, peak, live };
  }
  const claimAnswer = (claim: string) => JSON.stringify({ source_kind: "knowledge", non_claims: 0, kept: [{ claim, locus: "p", evidence: "e", disagreement: "someone would argue otherwise" }], skipped: [] });
  const section = (name: string, n: number) => [`# ${name}`, ...Array.from({ length: n }, (_, k) => `${name} paragraph ${k} ${"z".repeat(980)}.`)].join("\n\n");

  it("reads a long source window by window, with each window's heading, and numbers the claims across them", async () => {
    const text = [section("Hardware", 6), section("Memory", 6)].join("\n\n");
    const g = gateway([claimAnswer("GPUs set the cost of inference"), claimAnswer("Bandwidth limits decoding speed")]);
    const out = await candidatesStage(g.llm, "m", { title: "Book", text }, g.fetchImpl, { windowChars: 7_000 });
    expect(out.window_count).toBe(2);
    expect(out.kept.map((c) => [c.id, c.window])).toEqual([["c1", "w1"], ["c2", "w2"]]);
    expect(g.seen[0].user).toMatch(/^Source title: Book\nSection: Hardware\n\n# Hardware/);
    expect(g.seen[1].user).toMatch(/Section: Memory/);
    expect(out.summary).toMatch(/^2 distinct claims from 2 parts: 2 kept, 0 rejected on a gate\.$/);
  });
  it("runs one window at a time on a local model, and three at once on a hosted one", async () => {
    const text = section("A", 30);
    const local = gateway([claimAnswer("x claim one")]);
    await candidatesStage(local.llm, "m", { title: "T", text }, local.fetchImpl, { windowChars: 4_000 });
    expect(local.peak.n).toBe(1);
    const hosted = gateway([claimAnswer("x claim one")], { locality: "hosted", model: "gpt-6.1-sol" });
    await candidatesStage(hosted.llm, "m", { title: "T", text }, hosted.fetchImpl, { windowChars: 4_000 });
    expect(hosted.peak.n).toBe(3);
  });
  it("sizes the windows still to come for a model switched mid-source", async () => {
    const text = section("A", 120); // about 120,000 characters: three hosted windows, then more
    const g = gateway([claimAnswer("x claim one")], { locality: "hosted", model: "gpt-6.1-sol" });
    const sizes: number[] = [];
    const watching = (async (u: string, init?: RequestInit) => {
      const r = await g.fetchImpl(u, init);
      if (!u.endsWith("/active")) {
        sizes.push((JSON.parse(init?.body as string) as { messages: { content: string }[] }).messages[1].content.length);
        // After the first batch of three, the user switches to this computer's model.
        if (sizes.length === 3) Object.assign(g.live, { locality: "local", model: "local-20b" });
      }
      return r;
    }) as unknown as typeof fetch;
    const llm = new LlmClient({ baseUrl: "http://127.0.0.1:4202/llm/v1", apiKey: "k", locality: "local" }, watching);
    await candidatesStage(llm, "m", { title: "T", text }, watching);
    expect(sizes.length).toBeGreaterThan(3);
    expect(Math.max(...sizes.slice(0, 3))).toBeGreaterThan(9_000);
    expect(Math.max(...sizes.slice(3))).toBeLessThanOrEqual(8_100);
  });
  it("asks once more after an empty answer, then splits the window in two", async () => {
    const text = section("A", 6); // one window of about 6,000 characters
    const g = gateway(["{}", "{}", claimAnswer("first half claim"), claimAnswer("second half claim")]);
    const out = await candidatesStage(g.llm, "m", { title: "T", text }, g.fetchImpl);
    expect(g.seen).toHaveLength(4);
    expect(out.kept.map((c) => c.window)).toEqual(["w1.1", "w1.2"]);
    expect(out.empty_parts).toEqual([]);
  });
  it("reports a part that stays empty at the smallest size", async () => {
    const text = section("A", 3); // about 3,000 characters: too small to split
    const g = gateway(["{}", "{}"]);
    const out = await candidatesStage(g.llm, "m", { title: "T", text }, g.fetchImpl);
    expect(out.empty_parts).toEqual(['"A" (w1)']);
    expect(out.summary).toMatch(/1 part yielded nothing/);
  });
  it("splits a window the model cannot answer in JSON, and fails the stage when nothing could be read", async () => {
    const text = section("A", 6);
    const g = gateway(["not json", "not json", claimAnswer("half one"), claimAnswer("half two")]);
    expect((await candidatesStage(g.llm, "m", { title: "T", text }, g.fetchImpl)).kept).toHaveLength(2);
    const never = gateway(["not json"]);
    await expect(candidatesStage(never.llm, "m", { title: "T", text: section("A", 3) }, never.fetchImpl)).rejects.toThrow(/did not answer with JSON/);
  });
  it("says a source holds no knowledge only when every part says so, and never when the model leaves it out", async () => {
    const references = JSON.stringify({ source_kind: "not_knowledge", source_kind_reason: "a list of references", kept: [], skipped: [], non_claims: 0 });
    const g = gateway([references]);
    const out = await candidatesStage(g.llm, "m", { title: "T", text: section("Further reading", 3) }, g.fetchImpl);
    expect([out.source_kind, out.source_kind_reason]).toEqual(["not_knowledge", "a list of references"]);
    expect(g.seen).toHaveLength(1); // a not-knowledge answer is an answer, not an empty one
    const silent = gateway([JSON.stringify({ kept: [], skipped: [{ candidate: "A heading", gate: "sentence", reason: "label" }], non_claims: 0 })]);
    expect((await candidatesStage(silent.llm, "m", { title: "T", text: section("A", 3) }, silent.fetchImpl)).source_kind).toBe("knowledge");
    const mixed = gateway([references, claimAnswer("a real claim here")]);
    expect((await candidatesStage(mixed.llm, "m", { title: "T", text: [section("Refs", 6), section("Body", 6)].join("\n\n") }, mixed.fetchImpl, { windowChars: 7_000 })).source_kind).toBe("knowledge");
  });
  it("offers the model only the six gates and duplicate, and tells it every subject is in scope", () => {
    expect(CANDIDATES_SYSTEM).not.toMatch(/out_of_scope/);
    expect(CANDIDATES_SYSTEM).toMatch(/"gate":"sentence\|transclusion\|falsifiability\|coherence\|independence\|non_attribution\|duplicate"/);
    expect(CANDIDATES_SYSTEM).toMatch(/Every subject the source covers is in scope/);
    expect(CANDIDATES_SYSTEM).toMatch(/Never strike a statement only because it is descriptive, practical or technical/);
    expect(CANDIDATES_SYSTEM).toMatch(/"source_kind":"knowledge"/);
  });
```

Add `CANDIDATES_SYSTEM` to the import from `../lib/agent/staged.js`.

- [ ] **Step 2: Run the tests to see them fail**

Run: `bunx vitest run pieces/knowledge-vault/test/staged.test.ts -t "2. candidates"`
Expected: FAIL. The window tests fail because `window_count` is undefined, and the prompt test fails on `out_of_scope`.

- [ ] **Step 3: Change the gates**

In `extract.ts`, replace line 11 and line 22 with:

```ts
/** The gates the candidate prompt offers the model: its six, plus "duplicate" for a restatement of another candidate. */
export const GATES = ["sentence", "transclusion", "falsifiability", "coherence", "independence", "non_attribution", "duplicate"] as const;
/** A rejection that named a gate outside the list: still a rejection, reported apart. */
export const OTHER_GATE = "other" as const;
```

```ts
export type SkippedCandidate = { candidate: string; gate: (typeof GATES)[number] | typeof OTHER_GATE; reason: string };
```

- [ ] **Step 4: Replace the candidate prompt and stage**

In `staged.ts`:
- **Imports:** add `OTHER_GATE` to the import from `./extract.js`. Add `import { MIN_WINDOW_CHARS, paceFor, splitInHalf, windowSize, WindowCursor, type TextWindow } from "./windows.js";`.
- **Replace** `CANDIDATES_SYSTEM` and `candidatesStage`, lines 123–188, with the code below. Keep `BARE_STATISTIC`, `containsVerbatim`, `asRecord` and `classifySkips` as they are.

```ts
export const CANDIDATES_SYSTEM = `You find atomic knowledge claims in ONE part of a source (the whole source when it is short) for a knowledge vault. Answer with JSON only.

List every candidate claim in the text, in your own words, then run six gates on each. A claim passes only if all six hold:
1 sentence: completes "This note argues that ...". Not a label, heading or caption.
2 transclusion: works as a clause: "Since [claim], it follows that ...". Not a question.
3 falsifiability: a competent practitioner could disagree. "Quality matters" fails.
4 coherence: statable in 1-3 sentences without "and also"; bundles are several candidates.
5 independence: holds for a reader who never saw the source.
6 non_attribution: asserts what is TRUE, not what someone said.
Not claims: excerpts, summaries, headings, captions, anecdotes (they are evidence), bare numbers, restated structure, definitions with no stake.
Conditions travel inside the claim ("X improves Y only when Z").
A claim may describe how something works or what usually happens ("most inference runs on rented cloud GPUs", "memory bandwidth, not compute, limits decoding speed"): keep it when a practitioner could reasonably say otherwise. Never strike a statement only because it is descriptive, practical or technical.
Every subject the source covers is in scope, including subjects the vault has no notes on yet.
Two candidates that make the same assertion: keep one, strike the other as "duplicate".

Zero survivors is a valid answer for a foreword or glossary; a high skip rate is a finding.

A kept claim is the INFERENCE a finding supports, never the finding restated: "74% invest over $50m" is evidence; "once spend is that high, budget no longer separates organizations" is a claim. Never copy a source sentence as the claim.
For each kept claim, say what a competent practitioner who disagrees would argue. If you cannot, the claim fails falsifiability: strike it.

List only statements. Leave out headings, survey questions, figure captions and name credits entirely; count them in "non_claims".

Say what kind of text this is: "source_kind" is "not_knowledge" only when the text holds no claims by its nature (a list of references, an index, a glossary of terms, front matter, contact details), with the reason in a few words in "source_kind_reason"; otherwise "knowledge".

Answer: {"source_kind":"knowledge","source_kind_reason":"","non_claims":0,"kept":[{"claim":"...","locus":"section and paragraph","evidence":"the source's own words that support it","disagreement":"what a practitioner who disagrees would argue"}],"skipped":[{"candidate":"...","gate":"${GATES.join("|")}","reason":"..."}]}`;

export type WindowCandidates = {
  window: TextWindow;
  kept: (Candidate & { window: string })[];
  skipped: SkippedCandidate[];
  nonClaimsCounted: number;
  sourceKind: "knowledge" | "not_knowledge";
  sourceKindReason: string;
  /** Nothing kept, nothing struck, no non-claims, and not judged to hold no knowledge: no answer at all. */
  empty: boolean;
  usage: Usage;
};

/** One window through the candidate prompt: its claims, its rejections, and whether it holds knowledge at all. */
export async function candidatesForWindow(llm: LlmClient, model: string, title: string, window: TextWindow, wholeSource: string, fetchImpl?: typeof fetch): Promise<WindowCandidates> {
  const { value, usage } = await completeJson(llm, {
    model,
    system: CANDIDATES_SYSTEM,
    user: `Source title: ${title}${window.heading ? `\nSection: ${window.heading}` : ""}\n\n${window.text}`,
    // Listing candidates needs little deliberation; unbounded reasoning took 45-180 s here.
    reasoningEffort: "low",
  }, fetchImpl);
  const answer = asObject(value, "The model's answer");
  const kept: (Candidate & { window: string })[] = [];
  const skipped: SkippedCandidate[] = [];
  for (const c of arr(answer.kept).map((x) => asRecord(x))) {
    const claim = str(c.claim).trim();
    if (!claim) continue;
    // The gates the model tends to wave through, enforced here.
    if (BARE_STATISTIC.test(claim)) skipped.push({ candidate: claim, gate: "falsifiability", reason: "A bare statistic: evidence for a claim, not a claim (struck by the harness)" });
    else if (!str(c.disagreement).trim()) skipped.push({ candidate: claim, gate: "falsifiability", reason: "No position a practitioner could take against it (struck by the harness)" });
    else if (containsVerbatim(wholeSource, claim)) skipped.push({ candidate: claim, gate: "sentence", reason: "Copied from the source rather than stated as the inference it supports (struck by the harness)" });
    else kept.push({ id: "", claim, locus: str(c.locus), evidence: str(c.evidence), window: window.id });
  }
  skipped.push(...arr(answer.skipped)
    .map((c) => asRecord(c))
    .filter((c) => str(c.candidate).trim())
    .map((c) => ({ candidate: str(c.candidate), gate: (GATES as readonly string[]).includes(str(c.gate)) ? (str(c.gate) as SkippedCandidate["gate"]) : OTHER_GATE, reason: str(c.reason) })));
  const nonClaimsCounted = Math.max(0, Math.round(Number(answer.non_claims) || 0));
  const notKnowledge = str(answer.source_kind).trim().toLowerCase() === "not_knowledge";
  return {
    window,
    kept,
    skipped,
    nonClaimsCounted,
    sourceKind: notKnowledge ? "not_knowledge" : "knowledge",
    sourceKindReason: notKnowledge ? str(answer.source_kind_reason).trim() : "",
    empty: !notKnowledge && arr(answer.kept).length === 0 && arr(answer.skipped).length === 0 && nonClaimsCounted === 0,
    usage,
  };
}

/** An answer the model could not give in JSON, after completeJson's own second try. */
const isUnreadableAnswer = (error: unknown) => error instanceof KnowledgeVaultApiError && /did not answer with JSON|malformed JSON|gave no answer twice|empty response twice/.test(error.message);
const describePart = (w: TextWindow) => (w.heading ? `"${w.heading}" (${w.id})` : w.id);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export async function candidatesStage(llm: LlmClient, model: string, bundle: Record<string, unknown>, fetchImpl?: typeof fetch, opts: { windowChars?: number | null } = {}) {
  const text = str(bundle.text);
  const title = str(bundle.title);
  const cursor = new WindowCursor(text);
  const redo: TextWindow[] = [];
  const results: WindowCandidates[] = [];
  const emptyParts: TextWindow[] = [];
  const unreadable: TextWindow[] = [];
  let lastError: unknown = null;

  type Outcome = { kind: "read"; out: WindowCandidates } | { kind: "empty"; window: TextWindow } | { kind: "unreadable"; window: TextWindow; error: unknown };
  async function readWindow(w: TextWindow): Promise<Outcome> {
    for (let ask = 1; ask <= 2; ask++) {
      let out: WindowCandidates;
      try {
        out = await candidatesForWindow(llm, model, title, w, text, fetchImpl);
      } catch (error) {
        if (isUnreadableAnswer(error)) return { kind: "unreadable", window: w, error };
        throw error;
      }
      // An empty answer for a window this long is asked once more; a short one is taken as it is.
      if (!out.empty || w.text.length < MIN_WINDOW_CHARS) return { kind: "read", out };
    }
    return { kind: "empty", window: w };
  }

  while (redo.length || !cursor.done) {
    // Asked afresh before every batch (one local call): the windows still to come are sized and paced
    // for the model in charge now, even when the user switched a moment ago.
    const live = await llm.active(fetchImpl, true);
    const size = windowSize({ locality: live.locality, contextTokens: live.contextTokens, override: opts.windowChars });
    const batch: TextWindow[] = [];
    while (batch.length < paceFor(live.locality)) {
      const next = redo.shift() ?? cursor.next(size);
      if (!next) break;
      batch.push(next);
    }
    const outcomes = await mapLimit(batch, batch.length, readWindow);
    for (const o of outcomes) {
      if (o.kind === "read") {
        results.push(o.out);
        continue;
      }
      if (o.kind === "unreadable") lastError = o.error;
      const halves = splitInHalf(o.window);
      if (halves) redo.unshift(...halves);
      else (o.kind === "empty" ? emptyParts : unreadable).push(o.window);
    }
  }
  if (results.length === 0 && unreadable.length) throw lastError;

  let n = 0;
  const kept = results.flatMap((r) => r.kept).map((c) => ({ ...c, id: `c${++n}` }));
  const breakdown = classifySkips(results.flatMap((r) => r.skipped));
  const nonClaims = results.reduce((sum, r) => sum + r.nonClaimsCounted, 0) + breakdown.not_a_claim.length;
  const other = breakdown.rejected.filter((s) => s.gate === OTHER_GATE).length;
  const distinct = kept.length + breakdown.rejected.length;
  const parts = results.length + emptyParts.length + unreadable.length;
  const notKnowledge = results.length > 0 && results.every((r) => r.sourceKind === "not_knowledge");
  const usage = results.reduce((u, r) => ({ cost: u.cost + r.usage.cost, tokens: u.tokens + r.usage.prompt_tokens + r.usage.completion_tokens }), { cost: 0, tokens: 0 });
  return {
    summary:
      `${plural(distinct, "distinct claim")}${parts > 1 ? ` from ${parts} parts` : ""}: ${kept.length} kept, ${breakdown.rejected.length} rejected on a gate` +
      `${other ? ` (${other} for a reason outside the gates)` : ""}` +
      `${breakdown.restatement.length ? `; ${breakdown.restatement.length} restatements of kept claims` : ""}` +
      `${nonClaims ? `; ${nonClaims} non-claims (headings, captions, bare statistics)` : ""}` +
      `${emptyParts.length ? `; ${plural(emptyParts.length, "part")} yielded nothing` : ""}` +
      `${unreadable.length ? `; ${plural(unreadable.length, "part")} could not be read` : ""}.`,
    kept_count: kept.length,
    skipped_count: breakdown.rejected.length,
    restatement_count: breakdown.restatement.length,
    non_claim_count: nonClaims,
    other_gate_count: other,
    kept,
    skipped: breakdown.rejected,
    restatements: breakdown.restatement,
    non_claims: breakdown.not_a_claim,
    windows: results.map((r) => r.window),
    window_count: parts,
    empty_parts: emptyParts.map(describePart),
    unreadable_parts: unreadable.map(describePart),
    source_kind: notKnowledge ? ("not_knowledge" as const) : ("knowledge" as const),
    source_kind_reason: notKnowledge ? results.find((r) => r.sourceKindReason)?.sourceKindReason || "it holds no claims by its nature" : "",
    cost_usd: round4(usage.cost),
    tokens: usage.tokens,
  };
}
```

`KnowledgeVaultApiError` is already imported in `staged.ts`. The existing `Candidate` type stays `{ id; claim; locus; evidence }`.

- [ ] **Step 5: Run the candidate tests, then the whole file**

Run: `bunx vitest run pieces/knowledge-vault/test/staged.test.ts -t "2. candidates"`, then `bunx vitest run pieces/knowledge-vault/test/staged.test.ts`
Expected: PASS. "reports zero survivors plainly" still passes: an empty text gives no windows and the same summary.

- [ ] **Step 6: Commit**

```bash
git add pieces/knowledge-vault/lib/agent/extract.ts pieces/knowledge-vault/lib/agent/staged.ts pieces/knowledge-vault/test/staged.test.ts
git commit -m "feat(piece): find candidates window by window, without the undefined gate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The vault check marks which matches a claim may converge on

**Files:**
- Modify: `pieces/knowledge-vault/lib/agent/staged.ts:40-42` (the types) and `:214-235` (`checkVaultStage`)
- Test: `pieces/knowledge-vault/test/staged.test.ts` (the `describe("3. vault check")` block)

**Interfaces:**
- Produces:
  - `CONVERGE_FLOOR = 0.75`
  - `type VaultMatch = { id: string; title: string; similarity: number; eligible: boolean }`
  - `type CheckedCandidate = Candidate & { window: string | null; matches: VaultMatch[]; likely_duplicate: boolean }`

- [ ] **Step 1: Update the existing test and write the failing one**

In "flags candidates the vault already holds", answer the note read and expect the new field:

```ts
    const out = await checkVaultStage(vault({ search, "notes/n1": { edges: [] } }), "d", { kept: [{ id: "c1", claim: "dup claim" }, { id: "c2", claim: "new claim" }] });
    expect(out.candidates.map((c) => c.likely_duplicate)).toEqual([true, false]);
    expect(out.candidates[0].matches).toEqual([{ id: "n1", title: "Old", similarity: 0.934, eligible: true }]);
```

In the same test, change the next two calls to `vault({ search, "notes/n1": { edges: [] } })` as well. Then add:

```ts
  it("marks the matches a claim may converge on: close enough, live, and not replaced by another note", async () => {
    const search = () => ({ hits: [
      { node: { documentId: "live", title: "Live", status: "IN_REVIEW" }, similarity: 0.81 },
      { node: { documentId: "replaced", title: "Replaced", status: "CANONICAL" }, similarity: 0.9 },
      { node: { documentId: "far", title: "Far", status: "CANONICAL" }, similarity: 0.7 },
    ] });
    const reads: string[] = [];
    const v = vault({
      search,
      "notes/live": () => { reads.push("live"); return { edges: [{ direction: "out", linkType: "DERIVED_FROM" }] }; },
      "notes/replaced": () => { reads.push("replaced"); return { edges: [{ direction: "in", linkType: "SUPERSEDES" }] }; },
    });
    const out = await checkVaultStage(v, "d", { kept: [{ id: "c1", claim: "a claim", window: "w2" }] });
    expect(out.candidates[0].matches.map((m) => [m.id, m.eligible])).toEqual([["live", true], ["replaced", false], ["far", false]]);
    expect(out.candidates[0].window).toBe("w2");
    expect(reads.sort()).toEqual(["live", "replaced"]); // nothing is read for a match below the floor
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `bunx vitest run pieces/knowledge-vault/test/staged.test.ts -t "3. vault check"`
Expected: FAIL, because `eligible` is undefined.

- [ ] **Step 3: Implement**

Replace the two types at lines 41–42:

```ts
export type VaultMatch = { id: string; title: string; similarity: number; eligible: boolean };
export type CheckedCandidate = Candidate & { window: string | null; matches: VaultMatch[]; likely_duplicate: boolean };
```

Replace `checkVaultStage`'s body with the following. Its summary and return value stay the same apart from `candidates`.

```ts
/** A claim may converge on an existing note only when the match is this close, live, and not replaced. */
export const CONVERGE_FLOOR = 0.75;

/** True when another note supersedes this one, or when the vault cannot say: a failed read never makes a note eligible. */
async function isSuperseded(client: KnowledgeVaultClient, drive: string, id: string): Promise<boolean> {
  try {
    const doc = await client.request<{ edges?: { direction?: string; linkType?: string }[] }>({ path: `notes/${encodeURIComponent(id)}`, query: { drive } });
    return (doc.edges ?? []).some((e) => e.linkType === "SUPERSEDES" && e.direction === "in");
  } catch {
    return true;
  }
}

export async function checkVaultStage(client: KnowledgeVaultClient, drive: string, candidates: Record<string, unknown>, threshold = 0.9) {
  const kept = arr(candidates.kept).map(asRecord);
  // In parallel: a semantic search embeds its query, 3-4 s each on a remote vault.
  const checked: CheckedCandidate[] = await mapLimit(kept, 4, async (c) => {
    const body = await client.request<{ hits: { node: { documentId?: string; title?: string; status?: string }; similarity: number }[] }>({
      path: "search",
      query: { drive, q: str(c.claim), mode: "semantic", limit: 3, related: 0 },
    });
    const matches: VaultMatch[] = await Promise.all(
      body.hits
        .filter((h) => h.node.status !== "MOC")
        .map(async (h) => {
          const id = str(h.node.documentId);
          const similarity = Math.round(h.similarity * 1000) / 1000;
          const eligible = similarity >= CONVERGE_FLOOR && h.node.status !== "ARCHIVED" && !(await isSuperseded(client, drive, id));
          return { id, title: str(h.node.title), similarity, eligible };
        }),
    );
    return { id: str(c.id), claim: str(c.claim), locus: str(c.locus), evidence: str(c.evidence), window: str(c.window) || null, matches, likely_duplicate: (matches[0]?.similarity ?? 0) >= threshold };
  });
  const dups = checked.filter((c) => c.likely_duplicate);
  return {
    summary: `Searched the vault for ${checked.length} candidate${checked.length === 1 ? "" : "s"}: ${dups.length ? `${dups.length} likely already there (similarity ≥ ${threshold})` : "none already there"}${checked.length ? `; best match ${Math.max(0, ...checked.map((c) => c.matches[0]?.similarity ?? 0))}` : ""}.`,
    checked_count: checked.length,
    duplicate_count: dups.length,
    threshold,
    candidates: checked,
  };
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `bunx vitest run pieces/knowledge-vault/test/staged.test.ts -t "3. vault check"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add pieces/knowledge-vault/lib/agent/staged.ts pieces/knowledge-vault/test/staged.test.ts
git commit -m "feat(piece): mark which vault matches a claim may converge on

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Drafting window by window, and accepting only real convergence

**Files:**
- Modify: `pieces/knowledge-vault/lib/agent/staged.ts:270-378` (`draftStage`)
- Test: `pieces/knowledge-vault/test/staged.test.ts` (the `describe("4. draft")` block)

**Interfaces:**
- Consumes: Task 1's `draftBatchFor` and `TextWindow`; Task 2's `LlmClient.active()`; Task 4's `VaultMatch.eligible`.
- Produces:
  - `type ConvergedClaim = { candidate_id: string; note_id: string; title: string; reason: string; locus: string; evidence: string }`.
  - `draftStage(llm, model, bundle, checked, fetchImpl?, windows?: TextWindow[])`, with `existing: ConvergedClaim[]` and the other return fields unchanged.

- [ ] **Step 1: Update the existing fixture and write the failing tests**

In `describe("4. draft")`:
- In the `checked` fixture, make c1's match eligible: `matches: [{ id: "n9", title: "Old", similarity: 0.95, eligible: true }]`.
- In "writes notes, merges, points at existing ones…", expect the new fields:

```ts
    expect(out.existing).toEqual([{ candidate_id: "c1", note_id: "n9", title: "Old", reason: "same", locus: "p1", evidence: "e" }]);
```

Then add:

```ts
  it("drafts each window's claims from that window's text alone, at most 8 to a call on a local model", async () => {
    const m = modelSays(JSON.stringify({ notes: [] }), JSON.stringify({ notes: [] }), JSON.stringify({ notes: [] }));
    const local = new LlmClient({ ...LLM, locality: "local" }, m.fetchImpl);
    const windows = [{ id: "w1", heading: "Alpha", text: "ALPHA text about GPUs" }, { id: "w2", heading: null, text: "BETA text about memory" }];
    const many = { candidates: [...Array.from({ length: 10 }, (_, i) => ({ id: `c${i + 1}`, claim: `claim ${i}`, window: "w1" })), { id: "c11", claim: "beta claim", window: "w2" }] };
    await draftStage(local, "m", bundle, many, m.fetchImpl, windows);
    const drafts = m.calls.map((c) => c.user);
    expect(drafts.map((u) => (u.match(/^- c\d+:/gm) ?? []).length)).toEqual([8, 2, 1]);
    expect(drafts[0]).toMatch(/Section: Alpha\nALPHA text about GPUs$/);
    expect(drafts[0]).not.toMatch(/BETA/);
    expect(drafts[2]).toMatch(/BETA text about memory$/);
  });
  it("links a claim to an existing note only when that note was a close, live match; otherwise writes it", async () => {
    const m = modelSays(
      JSON.stringify({ existing: [
        { candidate_id: "c1", note_id: "n9", title: "Old", reason: "same" },
        { candidate_id: "c2", note_id: "n8", title: "Replaced", reason: "same" },
        { candidate_id: "c3", note_id: "invented", title: "?", reason: "same" },
      ] }),
      JSON.stringify({ notes: [note("c2", "Bandwidth limits decoding at small batches", { topics: ["operations"] }), note("c3", "Kernels decide throughput on one GPU", { topics: ["operations"] })] }),
      '{"same":[]}',
    );
    const out = await draftStage(m.llm, "m", bundle, { candidates: [
      { id: "c1", claim: "A", locus: "p1", evidence: "the passage", matches: [{ id: "n9", title: "Old", similarity: 0.82, eligible: true }] },
      { id: "c2", claim: "B", matches: [{ id: "n8", title: "Replaced", similarity: 0.95, eligible: false }] },
      { id: "c3", claim: "C", matches: [] },
    ] }, m.fetchImpl);
    expect(out.existing).toEqual([{ candidate_id: "c1", note_id: "n9", title: "Old", reason: "same", locus: "p1", evidence: "the passage" }]);
    expect(out.proposed.map((n) => n.candidate_id)).toEqual(["c2", "c3"]);
    expect(m.calls[1].user).toMatch(/c2: the note you named is not one of this claim's close matches/);
  });
  it("keeps one note when two windows found the same claim", async () => {
    const m = modelSays(
      JSON.stringify({ notes: [note("c1", "Memory bandwidth limits decoding speed", { topics: ["operations"] })] }),
      JSON.stringify({ notes: [note("c2", "Decoding speed is bound by memory bandwidth", { topics: ["operations"] })] }),
      JSON.stringify({ same: [{ keep: "c1", drop: "c2", reason: "one assertion" }] }),
    );
    const windows = [{ id: "w1", heading: null, text: "first part" }, { id: "w2", heading: null, text: "second part" }];
    const out = await draftStage(m.llm, "m", bundle, { candidates: [{ id: "c1", claim: "x", window: "w1" }, { id: "c2", claim: "y", window: "w2" }] }, m.fetchImpl, windows);
    expect(out.proposed.map((n) => n.candidate_id)).toEqual(["c1"]);
    expect(out.overlaps).toEqual([{ kept: "c1", dropped: "c2", reason: "one assertion" }]);
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `bunx vitest run pieces/knowledge-vault/test/staged.test.ts -t "4. draft"`
Expected: FAIL. The batches come out as `[11]` instead of `[8, 2, 1]`, `existing` lacks `locus`, and c2 is accepted as existing.

- [ ] **Step 3: Implement**

At the top of `staged.ts`, add `draftBatchFor` to the import from `./windows.js`. Replace `draftStage` (from `export type DraftedNote` through its closing brace) with:

```ts
export type DraftedNote = ProposedNote & { candidate_id: string; new_topics: string[] };
export type ConvergedClaim = { candidate_id: string; note_id: string; title: string; reason: string; locus: string; evidence: string };

const NOT_A_MATCH = "the note you named is not one of this claim's close matches in the vault (similarity at least 0.75, not archived, not replaced by another note): write the claim as a note";

export async function draftStage(llm: LlmClient, model: string, bundle: Record<string, unknown>, checked: Record<string, unknown>, fetchImpl?: typeof fetch, windows?: TextWindow[]) {
  const candidates = arr(checked.candidates).map(asRecord);
  const vocabulary = new Set(arr(bundle.topics).map(str));
  const usage: Usage = { prompt_tokens: 0, completion_tokens: 0, cost: 0 };
  const accepted: DraftedNote[] = [];
  const existing: ConvergedClaim[] = [];
  const rejected: { candidate_id: string; issues: string[] }[] = [];
  let rounds = 0;
  if (candidates.length === 0) {
    return { summary: "No candidates passed the gates, so no notes were drafted.", proposed_count: 0, existing_count: 0, rejected_count: 0, repair_rounds: 0, proposed: [], existing: [], rejected: [], overlaps: [], new_topics: [], cost_usd: 0, tokens: 0 };
  }

  /** One batch of claims from one window, drafted from that window's text, with one repair round. */
  async function draftBatch(batch: Record<string, unknown>[], w: TextWindow): Promise<void> {
    let pending = batch;
    let feedback = "";
    let batchRounds = 0;
    let failed: { candidate_id: string; issues: string[] }[] = [];
    const done = new Set<string>();
    while (pending.length && batchRounds < 2) {
      batchRounds++;
      const user = [
        `Source: ${str(bundle.title)}`,
        "Vault topics (name, notes, an example note):",
        ...topicLines(bundle),
        "",
        "Claims:",
        ...pending.map((c) => `- ${str(c.id)}: ${str(c.claim)}\n  locus: ${str(c.locus)}\n  evidence: ${str(c.evidence)}\n  vault matches: ${arr(c.matches).map(asRecord).map((m) => `${str(m.id)} "${str(m.title)}" (${str(m.similarity)})`).join("; ") || "none"}`),
        feedback,
        "",
        "Source text for evidence and conditions:",
        ...(w.heading ? [`Section: ${w.heading}`] : []),
        w.text,
      ].join("\n");
      const reply = await completeJson(llm, { model, system: DRAFT_SYSTEM, user, maxTokens: 24_000, reasoningEffort: "medium" }, fetchImpl);
      usage.prompt_tokens += reply.usage.prompt_tokens;
      usage.completion_tokens += reply.usage.completion_tokens;
      usage.cost += reply.usage.cost;
      const answer = asObject(reply.value, "The model's answer");
      failed = [];
      // "Already in the vault" holds only for a note this claim was actually matched with, live and not replaced.
      for (const e of arr(answer.existing).map(asRecord)) {
        const id = str(e.candidate_id);
        const candidate = pending.find((c) => str(c.id) === id);
        if (!candidate) continue;
        const match = arr(candidate.matches).map(asRecord).find((m) => str(m.id) === str(e.note_id));
        if (match?.eligible === true) {
          existing.push({ candidate_id: id, note_id: str(e.note_id), title: str(match.title) || str(e.title), reason: str(e.reason), locus: str(candidate.locus), evidence: str(candidate.evidence) });
          done.add(id);
        } else failed.push({ candidate_id: id, issues: [NOT_A_MATCH] });
      }
      for (const raw of arr(answer.notes).map(asRecord)) {
        const note: Record<string, unknown> = { ...raw, note_type: str(raw.note_type).toUpperCase().replace(/-/g, "_") };
        const issues = checkProposal(note, accepted);
        if (/\d\s*(%|percent)|us\$|\$\s?\d/i.test(str(note.title))) issues.push("the title carries a statistic; state the claim the numbers support, and put the numbers in the description and content");
        if (containsVerbatim(str(bundle.text), str(note.title))) issues.push("the title repeats a sentence from the source; state the inference it supports in your own words");
        if (issues.length) {
          failed.push({ candidate_id: str(raw.candidate_id), issues });
          continue;
        }
        const topics = arr(note.topics).map(str).filter(Boolean);
        accepted.push({
          candidate_id: str(raw.candidate_id), title: str(note.title).trim(), description: str(note.description).trim(),
          note_type: note.note_type as ProposedNote["note_type"], content: str(note.content), topics,
          confidence: str(note.confidence) as ProposedNote["confidence"], locus: str(note.locus),
          new_topics: topics.filter((t) => !vocabulary.has(t)),
        });
        done.add(str(raw.candidate_id));
        for (const merged of arr(raw.merged_ids).map(str)) done.add(merged);
      }
      const retry = new Set(failed.map((r) => r.candidate_id));
      pending = batch.filter((c) => retry.has(str(c.id)) && !done.has(str(c.id)));
      feedback = failed.length ? `\nYour previous drafts for these claims were rejected. Fix exactly these issues:\n${failed.map((r) => `- ${r.candidate_id}: ${r.issues.join("; ")}`).join("\n")}` : "";
    }
    rounds = Math.max(rounds, batchRounds);
    rejected.push(...failed.filter((r) => !done.has(r.candidate_id)));
  }

  // Each window's claims are drafted from that window's text alone, a batch at a time, so every call stays small.
  const byId = new Map((windows ?? []).map((w) => [w.id, w]));
  const whole: TextWindow = { id: "w0", heading: null, text: str(bundle.text) };
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const c of candidates) {
    const key = byId.has(str(c.window)) ? str(c.window) : whole.id;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  for (const [key, group] of groups) {
    const size = draftBatchFor((await llm.active(fetchImpl)).locality);
    for (let i = 0; i < group.length; i += size) await draftBatch(group.slice(i, i + size), byId.get(key) ?? whole);
  }

  // Two drafts can make one assertion in different words (from one window or two); one short model call compares them all.
  const overlaps: { kept: string; dropped: string; reason: string }[] = [];
  let overlapCheck: "done" | "skipped" | "failed" = "skipped";
  if (accepted.length > 1) {
    // Best effort: a failed check keeps every draft and says so.
    const reply = await completeJson(llm, {
      model,
      system: OVERLAP_SYSTEM,
      user: accepted.map((n) => `${n.candidate_id}: ${n.title}\n  ${n.description}`).join("\n"),
      maxTokens: 8000,
      reasoningEffort: "low",
    }, fetchImpl).catch(() => null);
    if (reply) {
      overlapCheck = "done";
      usage.prompt_tokens += reply.usage.prompt_tokens;
      usage.completion_tokens += reply.usage.completion_tokens;
      usage.cost += reply.usage.cost;
      const ids = new Set(accepted.map((n) => n.candidate_id));
      const gone = new Set<string>();
      for (const pair of arr(asObject(reply.value, "The overlap check").same).map(asRecord)) {
        const keep = str(pair.keep);
        const drop = str(pair.drop);
        if (!ids.has(keep) || !ids.has(drop) || keep === drop || gone.has(keep) || gone.has(drop)) continue;
        gone.add(drop);
        overlaps.push({ kept: keep, dropped: drop, reason: str(pair.reason) });
      }
      for (let i = accepted.length - 1; i >= 0; i--) if (gone.has(accepted[i].candidate_id)) accepted.splice(i, 1);
    } else overlapCheck = "failed";
  }
  const newTopics = [...new Set(accepted.flatMap((n) => n.new_topics))];
  const merged = candidates.length - accepted.length - existing.length - rejected.length - overlaps.length;
  return {
    summary: `Drafted ${accepted.length} note${accepted.length === 1 ? "" : "s"}${existing.length ? `, ${existing.length} already in the vault` : ""}${merged > 0 ? `, ${merged} merged into others` : ""}${overlaps.length ? `, ${overlaps.length} dropped as the same assertion as another` : ""}${overlapCheck === "failed" ? " (the duplicate check between drafts did not run)" : ""}${rejected.length ? `, ${rejected.length} still failing the vault's rules after ${rounds} rounds` : ""}${newTopics.length ? `; new topics: ${newTopics.join(", ")}` : ""}.`,
    proposed_count: accepted.length,
    existing_count: existing.length,
    rejected_count: rejected.length,
    repair_rounds: rounds - 1,
    proposed: accepted,
    existing,
    rejected,
    overlaps,
    overlap_check: overlapCheck,
    new_topics: newTopics,
    cost_usd: round4(usage.cost),
    tokens: usage.prompt_tokens + usage.completion_tokens,
  };
}
```

- [ ] **Step 4: Run the whole staged suite**

Run: `bunx vitest run pieces/knowledge-vault/test/staged.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add pieces/knowledge-vault/lib/agent/staged.ts pieces/knowledge-vault/test/staged.test.ts
git commit -m "feat(piece): draft window by window; accept 'already in the vault' only for a close, live match

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The report says what was read, what was empty, and whether the source holds knowledge

**Files:**
- Modify: `pieces/knowledge-vault/lib/agent/staged.ts` (`reportStage`, lines 382–426)
- Test: `pieces/knowledge-vault/test/staged.test.ts` (the `describe("5. report")` block)

**Interfaces:**
- Consumes: the output of Task 3's `candidatesStage` (`source_kind`, `source_kind_reason`, `window_count`, `empty_parts`, `unreadable_parts`, `other_gate_count`) and of Task 5's `draftStage` (`existing`).
- Produces: `reportStage` additionally returns:
  - `archive_reason: string | null`
  - `window_count: number`
  - `empty_parts: string[]`
  - `unreadable_parts: string[]`
  - `other_gate_count: number`

- [ ] **Step 1: Write the failing test**

```ts
  it("archives a source with no knowledge, and names the parts that yielded nothing or could not be read", () => {
    const out = reportStage("m", { title: "Reading list" }, {
      source_kind: "not_knowledge", source_kind_reason: "a list of references", window_count: 3,
      empty_parts: ['"Notes" (w2)'], unreadable_parts: ["w3"], other_gate_count: 2,
      skipped: [{ candidate: "x", gate: "other", reason: "?" }, { candidate: "y", gate: "other", reason: "?" }],
    }, {}, {});
    expect(out.archive_reason).toBe("a list of references");
    expect(out.summary).toMatch(/ Archived: a list of references\.$/);
    expect(out.report).toMatch(/\*\*Not knowledge:\*\* a list of references/);
    expect(out.report).toMatch(/2 rejected on a gate \(2 for a reason outside the gates\)/);
    expect(out.report).toMatch(/read in 3 parts/);
    expect(out.report).toMatch(/Parts that yielded nothing: "Notes" \(w2\)\./);
    expect(out.report).toMatch(/Parts the model could not read: w3\./);
    // A claim kept, or one found in the vault, means the source holds knowledge after all.
    expect(reportStage("m", {}, { source_kind: "not_knowledge" }, {}, { existing: [{ title: "Old", note_id: "n1" }] }).archive_reason).toBeNull();
    expect(reportStage("m", {}, {}, {}, {}).archive_reason).toBeNull();
  });
```

- [ ] **Step 2: Run the test to see it fail**

Run: `bunx vitest run pieces/knowledge-vault/test/staged.test.ts -t "5. report"`
Expected: FAIL, because `archive_reason` is undefined.

- [ ] **Step 3: Implement**

In `reportStage`, after `const newTopics = …;`, add:

```ts
  const otherGate = Number(candidates.other_gate_count ?? 0);
  const windowCount = Number(candidates.window_count ?? 0);
  const emptyParts = arr(candidates.empty_parts).map(str);
  const unreadableParts = arr(candidates.unreadable_parts).map(str);
  // Archived only when nothing survived, nothing was found in the vault, and every part said it holds no knowledge.
  const archiveReason = proposed.length === 0 && existing.length === 0 && str(candidates.source_kind) === "not_knowledge" ? str(candidates.source_kind_reason) || "it holds no claims by its nature" : null;
```

Replace the `lines` array and the `existing` heading with:

```ts
  const lines = [
    `## Extract — ${str(read.title)}`,
    "",
    `**${proposed.length} proposed** · ${skipped.length} rejected on a gate${otherGate ? ` (${otherGate} for a reason outside the gates)` : ""} · ${existing.length} already in the vault${rejected.length ? ` · ${rejected.length} failed the rules` : ""}${overlaps ? ` · ${overlaps} dropped as duplicates of another draft` : ""} · skip rate ${Math.round(skipRate * 100)}%`,
    `Also set aside: ${restatements} restatement${restatements === 1 ? "" : "s"} of kept claims, ${nonClaims} non-claim${nonClaims === 1 ? "" : "s"} (headings, captions, bare statistics). Neither counts in the skip rate.`,
    `Model \`${model}\` · $${cost.toFixed(4)} · ${Number(checked.checked_count ?? 0)} vault searches${windowCount > 1 ? ` · read in ${windowCount} parts` : ""}`,
    "",
  ];
  if (archiveReason) lines.push(`**Not knowledge:** ${archiveReason}. The source is archived rather than marked extracted.`, "");
  if (emptyParts.length) lines.push(`Parts that yielded nothing: ${emptyParts.join(", ")}.`, "");
  if (unreadableParts.length) lines.push(`Parts the model could not read: ${unreadableParts.join(", ")}.`, "");
```

```ts
  if (existing.length) lines.push("### Already in the vault (now also linked to this source)", "", ...existing.map((e) => `- ${str(e.title)} (\`${str(e.note_id)}\`) — ${str(e.reason)}`), "");
```

In the returned object, change `summary` and add the new fields:

```ts
    summary: `${proposed.length} notes proposed, ${skipped.length} rejected, ${existing.length} already in the vault, skip rate ${Math.round(skipRate * 100)}% (plus ${restatements} restatements and ${nonClaims} non-claims set aside), $${cost.toFixed(4)}.${archiveReason ? ` Archived: ${archiveReason}.` : ""}`,
```

```ts
    other_gate_count: otherGate,
    window_count: windowCount,
    empty_parts: emptyParts,
    unreadable_parts: unreadableParts,
    archive_reason: archiveReason,
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `bunx vitest run pieces/knowledge-vault/test/staged.test.ts -t "5. report"`
Expected: PASS (both report tests)

- [ ] **Step 5: Commit**

```bash
git add pieces/knowledge-vault/lib/agent/staged.ts pieces/knowledge-vault/test/staged.test.ts
git commit -m "feat(piece): report the parts read, the empty ones, and a source that holds no knowledge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Writing: link both sources, count both, archive when there is no knowledge

**Files:**
- Modify: `pieces/knowledge-vault/lib/agent/write.ts` (the args type at line 60, and lines 104–170)
- Test: `pieces/knowledge-vault/test/write.test.ts`

**Interfaces:**
- Produces:
  - `EXTRACTOR_MARK = "extract-claims 2"`
  - `type LinkedClaim = { note_id: string; title: string; locus: string; evidence: string }`
  - `writeStage` args gain `existing?: LinkedClaim[]` and `archiveReason?: string | null`.
  - It additionally returns `linked_existing: string[]`, `existing_problems: string[]` and `archived: boolean`.

- [ ] **Step 1: Update the stats expectation and write the failing tests**

If any test in `write.test.ts` expects `extractedBy: "extract-claims · m/x"` in `RECORD_EXTRACTION_STATS`, change it to `"extract-claims 2 · m/x"`. Then add:

```ts
describe("a claim from two sources, and a source with no knowledge", () => {
  type Sent = { actions: { type: string; input: Record<string, unknown> }[] };
  it("links a claim the vault already holds to this source, lists it, and counts it", async () => {
    const { client, requests } = recordingVault();
    const out = await writeStage(client, { ...args([note(1)]), existing: [{ note_id: "old7", title: "Old", locus: "p2", evidence: "the passage" }] });
    const links = requests.filter((r) => r.path === "relationships").map((r) => r.json);
    expect(links[1]).toEqual({ source: "old7", target: "src", type: "DERIVED_FROM", reason: 'Also argued in "Tech" (p2): "the passage"', confidence: "grounded" });
    const last = requests.at(-1)!.json as Sent;
    expect(last.actions.map((a) => [a.type, a.input.claimRef ?? a.input.status ?? a.input.claimCount])).toEqual([
      ["ADD_EXTRACTED_CLAIM", "n1"], ["ADD_EXTRACTED_CLAIM", "old7"], ["RECORD_EXTRACTION_STATS", 2], ["SET_SOURCE_STATUS", "EXTRACTED"],
    ]);
    expect(last.actions[2].input.extractedBy).toBe("extract-claims 2 · m/x");
    expect(out.linked_existing).toEqual(["old7"]);
    expect(out.summary).toBe("Wrote 1 note to /knowledge/notes, submitted for review, 1 linked to the source; 1 note already in the vault now also links to it; the source is marked EXTRACTED.");
  });
  it("archives a source that holds no knowledge, and only when no claim was found", async () => {
    const empty = recordingVault();
    const out = await writeStage(empty.client, { ...args([]), archiveReason: "a list of references" });
    const actions = (empty.requests.at(-1)!.json as Sent).actions;
    expect(actions.map((a) => a.type)).toEqual(["RECORD_EXTRACTION_STATS", "SET_SOURCE_STATUS"]);
    expect(actions[1].input).toEqual({ status: "ARCHIVED" });
    expect(out).toMatchObject({ archived: true, summary: 'Nothing in "Tech" is knowledge; the source is archived: a list of references.' });
    const linked = recordingVault();
    await writeStage(linked.client, { ...args([]), archiveReason: "a list of references", existing: [{ note_id: "old7", title: "Old", locus: "", evidence: "" }] });
    expect((linked.requests.at(-1)!.json as Sent).actions.at(-1)!.input).toEqual({ status: "EXTRACTED" });
    expect((linked.requests.find((r) => r.path === "relationships")!.json as { reason: string }).reason).toBe('Also argued in "Tech" (the source)');
  });
  it("leaves an existing note off the source's list when its link fails, and says so", async () => {
    const { client, requests } = recordingVault({ relationships: (i) => { if (i === 1) throw new KnowledgeVaultApiError("400: reason too short", { category: "validation" }); return { operations: [] }; } });
    const out = await writeStage(client, { ...args([note(1)]), existing: [{ note_id: "old7", title: "Old", locus: "p", evidence: "e" }] });
    const actions = (requests.at(-1)!.json as Sent).actions;
    expect(actions.filter((a) => a.type === "ADD_EXTRACTED_CLAIM").map((a) => a.input.claimRef)).toEqual(["n1"]);
    expect(out.existing_problems).toEqual(["Old: 400: reason too short"]);
    expect(out.summary).toMatch(/1 existing note could not be linked: Old: 400: reason too short\./);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `bunx vitest run pieces/knowledge-vault/test/write.test.ts`
Expected: FAIL, because no `old7` link is sent and `linked_existing` is undefined.

- [ ] **Step 3: Implement**

After the `BATCH` constant, add:

```ts
/** Stats this extractor writes carry its mark, so the desktop app's one-time re-run can tell them from the old extractor's. */
export const EXTRACTOR_MARK = "extract-claims 2";
/** A claim the vault already holds as a note: it is linked to this source too. */
export type LinkedClaim = { note_id: string; title: string; locus: string; evidence: string };
```

Extend `writeStage`'s `args` type with `existing?: LinkedClaim[]; archiveReason?: string | null;`. Replace everything from `// The source's side:` to the end of the function with:

```ts
  // A claim the vault already holds: the existing note gains this source too. Its text is not touched.
  const linkedExisting: string[] = [];
  const existingProblems: string[] = [];
  for (const e of args.existing ?? []) {
    try {
      await client.request({
        method: "POST",
        path: "relationships",
        json: { source: e.note_id, target: args.sourceId, type: "DERIVED_FROM", reason: `Also argued in "${args.sourceTitle}" (${e.locus || "the source"})${e.evidence ? `: "${e.evidence}"` : ""}`.slice(0, 900), confidence: "grounded" },
      });
      linkedExisting.push(e.note_id);
    } catch (error) {
      existingProblems.push(`${e.title || e.note_id}: ${errorMessage(error)}`);
    }
  }

  // The source's side: every claim it makes (new notes and linked ones), the stats, and its status.
  const claims = [...written.map((n) => n.id), ...linkedExisting];
  const archive = !!args.archiveReason && claims.length === 0;
  const at = now();
  let sourceUpdated = true;
  let sourceProblem: string | null = null;
  try {
    const result = await client.request<{ operations: Operation[] }>({
      method: "POST",
      path: "actions",
      timeoutMs: 60_000,
      json: {
        documentId: args.sourceId,
        actions: [
          // Listed before the stats: the source refuses a claim count its list does not match.
          ...claims.map((claimRef) => ({ type: "ADD_EXTRACTED_CLAIM", input: { claimRef } })),
          // A source that was never queued is still in INBOX, which cannot move straight to EXTRACTED.
          ...(args.sourceStatus === null || args.sourceStatus === "INBOX" ? [{ type: "SET_SOURCE_STATUS", input: { status: "EXTRACTING" } }] : []),
          { type: "RECORD_EXTRACTION_STATS", input: { claimCount: claims.length, skippedCount: args.rejectedCount, skipRate: args.skipRate, extractedAt: at, extractedBy: `${EXTRACTOR_MARK} · ${args.model}` } },
          { type: "SET_SOURCE_STATUS", input: { status: archive ? "ARCHIVED" : "EXTRACTED" } },
        ],
      },
    });
    const errors = result.operations.filter((o) => o.error);
    if (errors.length) {
      sourceUpdated = false;
      sourceProblem = errors.map((o) => `${o.type}: ${o.error}`).join("; ");
    }
  } catch (error) {
    sourceUpdated = false;
    sourceProblem = errorMessage(error);
  }

  const withProblems = written.filter((n) => n.problems.length);
  const linked = written.filter((n) => n.linked).length;
  // What must hold for the create phase to count as done.
  const incomplete = !sourceUpdated
    ? "the source was not updated"
    : linked < written.length
      ? `${written.length - linked} note${written.length - linked === 1 ? " is" : "s are"} not linked to the source`
      : null;
  const status = archive ? `the source is archived: ${args.archiveReason}` : "the source is marked EXTRACTED";
  const also = linkedExisting.length ? `; ${linkedExisting.length} note${linkedExisting.length === 1 ? "" : "s"} already in the vault now also link${linkedExisting.length === 1 ? "s" : ""} to it` : "";
  return {
    incomplete,
    summary:
      (archive ? `Nothing in "${args.sourceTitle}" is knowledge` : `Wrote ${written.length} note${written.length === 1 ? "" : "s"} to /knowledge/notes, submitted for review, ${linked} linked to the source${also}`) +
      (sourceUpdated ? `; ${status}.` : `; the source was NOT updated (${sourceProblem}).`) +
      (withProblems.length ? ` ${withProblems.length} note${withProblems.length === 1 ? " has" : "s have"} problems: see written.` : "") +
      (existingProblems.length ? ` ${existingProblems.length} existing note${existingProblems.length === 1 ? "" : "s"} could not be linked: ${existingProblems.join("; ")}.` : ""),
    written,
    note_ids: written.map((n) => n.id),
    linked_count: linked,
    linked_existing: linkedExisting,
    existing_problems: existingProblems,
    archived: archive && sourceUpdated,
    source_updated: sourceUpdated,
    source_problem: sourceProblem,
    problem_count: withProblems.length,
  };
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `bunx vitest run pieces/knowledge-vault/test/write.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add pieces/knowledge-vault/lib/agent/write.ts pieces/knowledge-vault/test/write.test.ts
git commit -m "feat(piece): link a claim found in two sources to both; archive a source with no knowledge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Wiring the Extract claims step

**Files:**
- Modify: `pieces/knowledge-vault/lib/actions/extract-claims.ts`
- Test: `pieces/knowledge-vault/test/staged.test.ts` (the `describe("the extract-claims action")` block)

**Interfaces:**
- Consumes: Tasks 3, 5, 6 and 7.
- Produces:
  - A new optional prop, `window_chars`.
  - New output fields: `linked_existing`, `archived` and `window_count`.

- [ ] **Step 1: Write the failing tests**

Inside `describe("the extract-claims action")`, add:

```ts
  it("archives a source the model finds holds no knowledge", async () => {
    const references = JSON.stringify({ source_kind: "not_knowledge", source_kind_reason: "a list of references", kept: [], skipped: [], non_claims: 0 });
    const sent: Record<string, unknown>[] = [];
    await withFetch((u, body) => {
      if (u.startsWith("https://llm.test")) return json({ choices: [{ message: { content: references } }] });
      if (u.includes("/actions") || u.includes("/relationships")) {
        sent.push(JSON.parse(body) as Record<string, unknown>);
        return json({ operations: [] });
      }
      return vaultAnswers(u);
    }, async () => {
      const out = await run({ auth: auth(), propsValue: { drive: "d", source: "s1", mode: "write" } });
      expect(out).toMatchObject({ archived: true, note_ids: [] });
      expect(String(out.summary)).toMatch(/^Nothing in "Src" is knowledge; the source is archived: a list of references\./);
      const sourceWrite = sent.find((b) => b.documentId === "s1" && JSON.stringify(b).includes("RECORD_EXTRACTION_STATS")) as { actions: { type: string; input: { status?: string } }[] };
      expect(sourceWrite.actions.at(-1)).toEqual({ type: "SET_SOURCE_STATUS", input: { status: "ARCHIVED" } });
    });
  });
  it("passes an archived source through like an extracted one, and refuses to extract it again by hand", async () => {
    let task: Record<string, unknown> = { id: "t1", taskType: "claim", status: "PENDING", documentRef: "s1", currentPhase: "reflect" };
    let queue = true;
    let modelCalls = 0;
    const source = { title: "Further reading", content: SOURCE, status: "ARCHIVED", extractedClaims: [], extractionStats: { claimCount: 0 } };
    const serve = (u: string) => {
      if (u.startsWith("https://llm.test")) { modelCalls++; return json({ choices: [{ message: { content: model } }] }); }
      if (u.includes("/tasks/reconcile")) { task = { ...task, status: "DONE", currentPhase: null }; return json({ advanced: [{ taskId: "t1", phases: ["reflect", "reweave", "verify"], to: "done", status: "DONE", phase: null }] }); }
      if (u.includes("/notes/d")) return json({ state: { global: { nodes: queue ? [{ id: "q1", documentType: "bai/pipeline-queue" }] : [] } } });
      if (u.includes("/notes/q1")) return json({ state: { global: { tasks: [task] } } });
      if (u.includes("/notes/s1")) return json({ name: "s1", state: { global: source } });
      if (u.includes("/relationships") || u.includes("/actions")) return json({ operations: [] });
      return vaultAnswers(u);
    };
    await withFetch(serve, async () => {
      const out = await run({ auth: auth(), propsValue: { drive: "d", source: "s1", mode: "write" } });
      expect(String(out.summary)).toMatch(/^"Further reading" is already extracted \(archived: no knowledge\); nothing was written\./);
      queue = false;
      await expect(run({ auth: auth(), propsValue: { drive: "d", source: "s1", mode: "write" } })).rejects.toThrow(/"Further reading" is archived/);
      expect(modelCalls).toBe(0);
    });
  });
  it("reads a long source in parts of the size asked for", async () => {
    const long = Array.from({ length: 12 }, (_, i) => `Paragraph ${i} ${"q".repeat(980)}.`).join("\n\n");
    await withFetch((u) => (u.startsWith("https://llm.test") ? json({ choices: [{ message: { content: model } }] }) : u.includes("/notes/s1") ? json({ name: "s1", state: { global: { title: "Long", content: long } } }) : vaultAnswers(u)), async () => {
      const out = await run({ auth: auth(), propsValue: { drive: "d", source: "s1", window_chars: 4_000 } });
      expect(out.window_count).toBe(3); // twelve ~993-character paragraphs, four to a part
    });
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `bunx vitest run pieces/knowledge-vault/test/staged.test.ts -t "the extract-claims action"`
Expected: FAIL, because `archived` is undefined, the archived source is not passed through, and `window_count` is undefined.

- [ ] **Step 3: Implement**

In `extract-claims.ts`:
- **Props:** add, after `threshold`:

```ts
    window_chars: Property.Number({
      displayName: "Window size",
      description: "Characters read at a time from a long source. Leave blank to fit the model: 8,000 for a model on this computer, 24,000 for a hosted one, less when the model's context is small.",
      required: false,
    }),
```

- **Description:** replace "About 1-2 minutes: set the step's timeout (under When it fails) to 300 s, or 600 s for a slow model." with "A long source is read in parts sized for the model: allow up to an hour for a long chapter on a model on this computer (the pipeline's steps do)."
- **Output schema:** add three `outputSchema.fields`:

```ts
      { key: "linked_existing", label: "Existing notes now also linked to this source" },
      { key: "archived", label: "Archived as holding no knowledge" },
      { key: "window_count", label: "Parts the source was read in" },
```

- **Window size:** in `run`, after `const threshold = …;`, add:

```ts
    const wc = Number(p.window_chars);
    const windowChars = Number.isFinite(wc) && wc > 0 ? wc : null;
```

- **The guard:** replace the `ranEmpty` line, the refusal line and the `what` line:

```ts
      const ranEmpty = existing === 0 && (read.status === "EXTRACTED" || read.status === "ARCHIVED") && read.stats_recorded === true;
```

```ts
          // Not past create: refused as before (an archived source is never extracted again by hand),
          // unless the earlier extraction found nothing (that may be tried again).
          if (!past && (existing > 0 || read.status === "ARCHIVED")) assertWritable(read);
```

```ts
          const what = existing > 0 ? `${existing} note${existing === 1 ? "" : "s"}` : read.status === "ARCHIVED" ? "archived: no knowledge" : "no claims found";
```

- **The stages:**

```ts
    const candidates = await stage("candidates", () => candidatesStage(llm, model, read, undefined, { windowChars }));
    const checked = await stage("check", () => checkVaultStage(client, drive, candidates, threshold));
    const draft = await stage("draft", () => draftStage(llm, model, read, checked, undefined, candidates.windows));
```

- **The write:** in the `writeStage` call, add `existing: draft.existing, archiveReason: report.archive_reason,`.
- **The handoff:** in `advancePipeline`'s arguments, use:

```ts
            workDone: written.archived
              ? `Found no knowledge in the source (${report.archive_reason}): archived it, with ${model}.`
              : `Extracted ${written.written.length} notes, submitted for review${written.linked_existing.length ? `, and linked ${written.linked_existing.length} notes already in the vault` : ""} (${report.skipped_count} candidates rejected on a gate, skip rate ${Math.round(report.skip_rate * 100)}%) with ${model}.`,
            filesModified: [...written.note_ids, ...written.linked_existing],
```

- **The result:** in the returned object, add:

```ts
      linked_existing: written?.linked_existing ?? [],
      archived: written?.archived ?? false,
      window_count: report.window_count,
```

- [ ] **Step 4: Run all of the piece's tests**

Run: `bunx vitest run pieces/knowledge-vault`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add pieces/knowledge-vault/lib/actions/extract-claims.ts pieces/knowledge-vault/test/staged.test.ts
git commit -m "feat(piece): Extract claims reads in windows, links both sources, archives no-knowledge sources

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Connect, Place and Verify work only on the notes a source made

**Files:**
- Modify: `pieces/knowledge-vault/lib/agent/connect.ts:26-44` (`sourceNotes`)
- Modify: `pieces/knowledge-vault/lib/agent/verify.ts:37-60` (`readVerifyNotes`)
- Test: `pieces/knowledge-vault/test/convergence.test.ts` (create)

**Interfaces:**
- Produces:
  - `madeBySource(edges: { direction?: string; documentId?: string; linkType?: string }[] | undefined, sourceId: string): boolean`, exported from `connect.ts`.
  - `sourceNotes` and `readVerifyNotes` skip listed notes that also derive from another source.
  - `sourceNotes` treats an archived source with no claims as finished.

- [ ] **Step 1: Write the failing tests**

```ts
// pieces/knowledge-vault/test/convergence.test.ts
import { describe, expect, it } from "vitest";
import { madeBySource, sourceNotes } from "../lib/agent/connect.js";
import { readVerifyNotes } from "../lib/agent/verify.js";
import type { KnowledgeVaultClient } from "../lib/common/client.js";

const vault = (docs: Record<string, unknown>) =>
  ({
    request: async ({ path }: { path: string }) => {
      const id = decodeURIComponent(path.replace(/^notes\//, ""));
      if (!(id in docs)) throw new Error(`no ${path}`);
      return docs[id];
    },
  }) as unknown as KnowledgeVaultClient;
const derived = (...from: string[]) => from.map((documentId) => ({ direction: "out", documentId, linkType: "DERIVED_FROM" }));
const note = (title: string, edges: ReturnType<typeof derived>, status = "IN_REVIEW") => ({ name: title, state: { global: { title, status, description: "d" } }, edges });

describe("the notes a source made", () => {
  const docs = {
    src: { name: "src", state: { global: { title: "Chapter 3", status: "EXTRACTED", extractedClaims: ["mine", "theirs", "gone"] } } },
    mine: note("Mine", derived("src")),
    theirs: note("Theirs", derived("older", "src")),
    gone: note("Gone", derived("src"), "ARCHIVED"),
    empty: { name: "empty", state: { global: { title: "Further reading", status: "ARCHIVED", extractedClaims: [] } } },
  };
  it("tells a note this source made from one it found already in the vault", () => {
    expect(madeBySource(docs.mine.edges, "src")).toBe(true);
    expect(madeBySource(docs.theirs.edges, "src")).toBe(false);
    expect(madeBySource(undefined, "src")).toBe(true);
  });
  it("gives Connect and Place only the notes this source made", async () => {
    expect((await sourceNotes(vault(docs), "d", "src")).notes.map((n) => n.id)).toEqual(["mine"]);
  });
  it("gives Verify only the notes this source made", async () => {
    expect((await readVerifyNotes(vault(docs), "d", "src")).notes.map((n) => n.id)).toEqual(["mine"]);
  });
  it("treats a source archived as holding no knowledge as finished, with no notes", async () => {
    expect((await sourceNotes(vault(docs), "d", "empty")).notes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `bunx vitest run pieces/knowledge-vault/test/convergence.test.ts`
Expected: FAIL, because `madeBySource` is not exported.

- [ ] **Step 3: Implement**

In `connect.ts`, above `sourceNotes`, add:

```ts
/**
 * True when every source this note derives from is `sourceId`. A note that also derives from another
 * source was linked, placed and checked when that source made it; a later source that finds the same
 * claim only lists it (convergence), so Connect, Place and Verify leave it alone.
 */
export function madeBySource(edges: { direction?: string; documentId?: string; linkType?: string }[] | undefined, sourceId: string): boolean {
  return !(edges ?? []).some((e) => e.linkType === "DERIVED_FROM" && e.direction === "out" && !!e.documentId && e.documentId !== sourceId);
}
```

In `sourceNotes`, replace the "Extracted with zero claims" check and the loop's archived check with:

```ts
  // Extracted, or archived as holding no knowledge, with zero claims: a finished source, not a missing step.
  const status = src.state?.global?.status;
  if (ids.length === 0 && (status === "EXTRACTED" || status === "ARCHIVED")) return { sourceTitle: title, notes: [] as (NoteSummary & { edges: NoteDoc["edges"] })[] };
```

```ts
    if (g.status === "ARCHIVED") continue;
    // A note the source found already in the vault was worked on when its own source made it.
    if (!madeBySource(doc.edges, sourceId)) continue;
```

In `verify.ts`, add `import { madeBySource } from "./connect.js";`. Then, in `readVerifyNotes`, after `if (g.status === "ARCHIVED") continue;`, add:

```ts
    if (!madeBySource(doc.edges, sourceId)) continue;
```

- [ ] **Step 4: Run all of the piece's tests**

Run: `bunx vitest run pieces/knowledge-vault`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add pieces/knowledge-vault/lib/agent/connect.ts pieces/knowledge-vault/lib/agent/verify.ts pieces/knowledge-vault/test/convergence.test.ts
git commit -m "feat(piece): Connect, Place and Verify work only on the notes a source made

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The server's catch-up counts an archived source as extracted; docs

**Files:**
- Modify: `subgraphs/http/lib/reconcile.ts:86-106` (`extraction`)
- Test: `subgraphs/http/lib/reconcile.test.ts`
- Modify: `docs/design/source-editor/README.md:114`

**Interfaces:** `planReconcile` keeps its signature; it now proves `create` for an `ARCHIVED` source that has recorded stats.

- [ ] **Step 1: Write the failing test**

Add to `describe("catching the queue up with the vault")`:

```ts
  it("counts a source archived as holding no knowledge as extracted, with nothing to connect, place or verify", () => {
    const out = plan([task()], source({ status: "ARCHIVED", statsRecorded: true, notes: [] }));
    expect(out.tasks[0]).toMatchObject({ from: "create", to: "done" });
    expect(out.tasks[0].handoffs[0].workDone).toBe("Found in the vault: the extraction archived the source as holding no knowledge.");
    // Archived by hand, with no extraction's stats, proves nothing.
    expect(plan([task()], source({ status: "ARCHIVED", statsRecorded: false })).tasks).toEqual([]);
  });
```

- [ ] **Step 2: Run the test to see it fail**

Run: `bunx vitest run subgraphs/http/lib/reconcile.test.ts`
Expected: FAIL, because `out.tasks` is empty.

- [ ] **Step 3: Implement**

In `extraction()`, after the `EXTRACTED` rule (the `if` ending at line 96), add:

```ts
  if (e.status === "ARCHIVED" && e.statsRecorded) {
    return { done: true, workDone: "Found in the vault: the extraction archived the source as holding no knowledge.", repair: null };
  }
```

In `docs/design/source-editor/README.md`, replace line 114 with:

```markdown
| `extractionStats.claimCount` (the claims the source makes: its new notes plus notes already in the vault it now also links to; equals the length of `extractedClaims`) | Details → Extraction, and the header's `12 notes` |
```

- [ ] **Step 4: Run the test to see it pass**

Run: `bunx vitest run subgraphs/http/lib/reconcile.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add subgraphs/http/lib/reconcile.ts subgraphs/http/lib/reconcile.test.ts docs/design/source-editor/README.md
git commit -m "feat(http): the catch-up counts an archived source with stats as extracted

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Check, build and publish the package

**Files:** `package.json` (version)

- [ ] **Step 1: Run the full checks**

Run: `bun run tsc && bun run lint && bun run test`
Expected: no type errors, no lint errors, all tests pass. Fix anything that fails before going on.

- [ ] **Step 2: Choose the next dev version**

Run: `npm view @powerhousedao/knowledge-note versions --json --registry https://registry.vetra.io | tail -4`
Expected: the highest is `1.0.54-dev.34`. Set `"version"` in `package.json` to the next one, `1.0.54-dev.35`.

- [ ] **Step 3: Build, and confirm the new code is in it**

Run: `bun run build && grep -rl "extract-claims 2" dist | head -3`
Expected: the build succeeds, and at least one file under `dist/` contains the new mark.

- [ ] **Step 4: Publish**

Check the login first: `npm whoami --registry https://registry.vetra.io`. If that fails, ask the user to log in to the registry, and wait.
Run: `ph publish --tag dev`
Then: `npm view @powerhousedao/knowledge-note dist-tags --registry https://registry.vetra.io`
Expected: `"dev": "1.0.54-dev.35"`

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "chore: 1.0.54-dev.35 — extraction in windows, convergence, no-knowledge sources archived

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

The remaining tasks are in **`knowledge-vault-app`** (`/home/beast/Documents/Powerhouse/knowledge-vault-app`, branch `dev`). Run their commands from that repo's root.

### Task 12: The gateway says which model answers now (`GET /llm/v1/active`)

**Files:**
- Create: `sidecar/src/gateway/context.ts`
- Test: `sidecar/src/gateway/context.test.ts`
- Modify: `sidecar/src/gateway/gateway.ts` (`GatewayDeps` at lines 19–26, `createGateway` at 35–46)
- Test: `sidecar/src/gateway/gateway.test.ts`

**Interfaces:**
- Consumes: `probeServer(port, f)` from `sidecar/src/model-discovery.ts`. It returns `{ models: { id, loaded, contextLength }[] } | null`.
- Produces:
  - `localContextProbe(f?: typeof fetch, now?: () => number): (endpoint: string, model: string) => Promise<number | null>`
  - `GatewayDeps.contextFor?: (endpoint: string, model: string) => Promise<number | null>`
  - `GET /llm/v1/active` returns `{ model: string | null; locality: "local" | "hosted"; contextTokens: number | null }`. The control server already forwards every path under `/llm/v1/` to the gateway after checking the key (`sidecar/src/control.ts:292-299`), so no change is needed there.

- [ ] **Step 1: Write the failing tests**

```ts
// sidecar/src/gateway/context.test.ts
import { describe, expect, it } from "vitest";
import { localContextProbe } from "./context.js";

/** A llama.cpp server on 8084: its model, and the context its slot runs with. */
const llamaCpp = (calls: string[]) =>
  (async (u: unknown) => {
    const url = String(u);
    calls.push(url);
    if (url === "http://127.0.0.1:8084/v1/models") return new Response(JSON.stringify({ data: [{ id: "gpt-oss-20b-vault" }] }), { status: 200 });
    if (url === "http://127.0.0.1:8084/props") return new Response(JSON.stringify({ default_generation_settings: { n_ctx: 32_768 }, total_slots: 1 }), { status: 200 });
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;

describe("the context a model on this computer runs with", () => {
  it("is read from its server, and kept for a minute", async () => {
    const calls: string[] = [];
    let now = 0;
    const probe = localContextProbe(llamaCpp(calls), () => now);
    expect(await probe("http://127.0.0.1:8084/v1", "gpt-oss-20b-vault")).toBe(32_768);
    const asked = calls.length;
    now = 30_000;
    expect(await probe("http://127.0.0.1:8084/v1", "gpt-oss-20b-vault")).toBe(32_768);
    expect(calls.length).toBe(asked);
    now = 61_000;
    await probe("http://127.0.0.1:8084/v1", "gpt-oss-20b-vault");
    expect(calls.length).toBeGreaterThan(asked);
  });
  it("is unknown for a server on another machine, or one that does not say", async () => {
    const calls: string[] = [];
    const probe = localContextProbe(llamaCpp(calls));
    expect(await probe("http://192.168.1.20:8084/v1", "m")).toBeNull();
    expect(calls).toEqual([]);
    expect(await probe("http://127.0.0.1:9999/v1", "m")).toBeNull();
  });
});
```

Append to `gateway.test.ts`:

```ts
describe("which model answers now", () => {
  const mount = (gw: ReturnType<typeof createGateway>) =>
    listen(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      await gw.handle(req, res, Buffer.concat(chunks), {});
    });
  it("says the model, where it runs, and the context its local server reports", async () => {
    const asked: string[] = [];
    const gw = createGateway({
      readSettings: () => settingsFor("http://127.0.0.1:8084/v1", "gpt-oss-20b-vault", "local"),
      readModelKey: () => undefined,
      contextFor: async (endpoint, model) => { asked.push(`${endpoint} ${model}`); return 32_768; },
    });
    const base = await mount(gw);
    expect(await (await fetch(`${base}${GATEWAY_PATH}/active`)).json()).toEqual({ model: "gpt-oss-20b-vault", locality: "local", contextTokens: 32_768 });
    expect(asked).toEqual(["http://127.0.0.1:8084/v1 gpt-oss-20b-vault"]);
  });
  it("leaves the context unknown for a hosted model, and the model empty when none is set up", async () => {
    let asked = 0;
    const hosted = await mount(createGateway({ readSettings: () => settingsFor("https://api.openai.com/v1", "gpt-6.1-sol", "chatgpt"), readModelKey: () => "k", contextFor: async () => { asked++; return 1; } }));
    expect(await (await fetch(`${hosted}${GATEWAY_PATH}/active`)).json()).toEqual({ model: "gpt-6.1-sol", locality: "hosted", contextTokens: null });
    expect(asked).toBe(0);
    const none = await mount(createGateway({ readSettings: () => settingsFor("http://127.0.0.1:8084/v1", " ", "local"), readModelKey: () => undefined, contextFor: async () => 1 }));
    expect(await (await fetch(`${none}${GATEWAY_PATH}/active`)).json()).toEqual({ model: null, locality: "local", contextTokens: null });
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `bunx vitest run sidecar/src/gateway/context.test.ts sidecar/src/gateway/gateway.test.ts`
Expected: FAIL. `context.js` does not exist yet, and `/active` answers 404 ("No such gateway route.").

- [ ] **Step 3: Write `context.ts`**

```ts
// sidecar/src/gateway/context.ts
import { probeServer } from "../model-discovery.js";

/** How long a model server's reported context is trusted: it changes only when the server restarts. */
const TTL_MS = 60_000;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * The context size a model on this computer runs with, read from its server (llama.cpp's n_ctx,
 * Ollama, LM Studio, vLLM), so the pipeline can size what it sends. Loopback only; null when the
 * server does not say.
 */
export function localContextProbe(f: typeof fetch = fetch, now: () => number = Date.now) {
  const cache = new Map<string, { at: number; value: number | null }>();
  return async (endpoint: string, model: string): Promise<number | null> => {
    const key = `${endpoint}#${model}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < TTL_MS) return hit.value;
    let value: number | null = null;
    try {
      const url = new URL(endpoint);
      if (LOOPBACK.has(url.hostname)) {
        const server = await probeServer(Number(url.port || (url.protocol === "https:" ? 443 : 80)), f);
        const models = server?.models ?? [];
        value = (models.find((m) => m.id === model) ?? models.find((m) => m.loaded) ?? models[0])?.contextLength ?? null;
      }
    } catch {
      value = null;
    }
    cache.set(key, { at: now(), value });
    return value;
  };
}
```

- [ ] **Step 4: Answer `/active` in the gateway**

In `gateway.ts`:
- Add `import { localContextProbe } from "./context.js";`.
- Add to `GatewayDeps`:

```ts
  /** The context size of the model set up on this computer (context.ts); tests pass their own. */
  contextFor?: (endpoint: string, model: string) => Promise<number | null>;
```

- In `createGateway`, after `const f = …`, add `const contextFor = deps.contextFor ?? localContextProbe(f);`.
- In `handle`, insert this right after the `const path = …` line, before the `isChat` and `isModels` checks:

```ts
    // Which model answers now: the pipeline sizes and times its calls by it, and follows a switch mid-run.
    if (req.method === "GET" && path === "/active") {
      let settings: AppSettings;
      try {
        settings = deps.readSettings();
      } catch {
        return sendJson(res, 500, openAiError(500, "The model gateway could not read its settings.", "gateway_error"), cors);
      }
      const model = settings.models.model.trim() || null;
      const contextTokens = settings.models.local && model ? await contextFor(settings.models.endpoint, model).catch(() => null) : null;
      return sendJson(res, 200, { model, locality: settings.models.local ? "local" : "hosted", contextTokens }, cors);
    }
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `bunx vitest run sidecar/src/gateway`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add sidecar/src/gateway/context.ts sidecar/src/gateway/context.test.ts sidecar/src/gateway/gateway.ts sidecar/src/gateway/gateway.test.ts
git commit -m "feat(gateway): say which model answers now, and the context a local one runs with

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: The watchdog re-queues, once, what the old extractor left empty

**Files:**
- Modify: `sidecar/src/queue-watchdog.ts`. That means `SourceState` and `planSourceRepairs` (lines 62–92), the start-up source read (lines 180–196), and the log line in `startQueueWatchdog` (line ~246).
- Test: `sidecar/src/queue-watchdog.test.ts`

**Interfaces:**
- Consumes: the extractor's mark from Task 7: new stats say `extract-claims 2 · …`, old ones `extract-claims · …`.
- Produces:
  - `SourceState` gains `extractedBy?: string | null` and `derivedNotes?: number`.
  - `OLD_EXTRACTOR: RegExp`
  - `isOldEmptyExtraction(s: SourceState): boolean`

- [ ] **Step 1: Write the failing tests**

In `describe("planSourceRepairs")`, add:

```ts
  it("reopens and queues, once, a source the old extractor ran to the end and found nothing in", () => {
    const old = { status: "EXTRACTED", claims: 0, statsRecorded: true, extractedBy: "extract-claims · gpt-oss-20b-vault" };
    const sources = [
      { id: "s1", name: "Chapter 3", ...old, derivedNotes: 0 },
      { id: "s2", name: "Re-run already", ...old, extractedBy: "extract-claims 2 · gpt-oss-20b-vault", derivedNotes: 0 },
      { id: "s3", name: "Has notes", ...old, derivedNotes: 2 },
      { id: "s4", name: "Not counted", ...old },
      { id: "s5", name: "By the plugin", ...old, extractedBy: "knowledge-agent", derivedNotes: 0 },
      { id: "s6", name: "Queued", ...old, derivedNotes: 0 },
    ];
    const tasks = [t({ id: "q", documentRef: "s6", status: "PENDING" })];
    expect(planSourceRepairs(sources, tasks).map((r) => [r.kind, r.source.name])).toEqual([
      ["reopen", "Chapter 3"],
      ["queue", "Chapter 3"],
      ["reopen", "Queued"],
    ]);
  });
```

In `describe("repairQueue")`, give `engine` two more parameters and two more answers:

```ts
  function engine(tasks: QueueTask[], runStatus = "SUCCEEDED", sourceStatus = "EXTRACTING", catchUp: { status: number; body?: unknown } = { status: 404 }, sourceExtra: Record<string, unknown> = {}, backlinks: { linkType: string }[] = []) {
```

```ts
      if (body.query.includes("knowledgeGraphBacklinks")) return { ok: true, json: async () => ({ data: { knowledgeGraphBacklinks: backlinks } }) };
```

In the `document { name state }` answer, change `{ status: sourceStatus, extractedClaims: [] }` to `{ status: sourceStatus, extractedClaims: [], ...sourceExtra }`. Then add:

```ts
  it("on start-up, reopens and queues a source the old extractor found nothing in, after counting its notes in the graph", async () => {
    const stats = { extractionStats: { claimCount: 0, extractedBy: "extract-claims · gpt-oss-20b-vault" } };
    const e = engine([], "SUCCEEDED", "EXTRACTED", { status: 404 }, stats);
    const r = await repairQueue(deps(e.fetchImpl), "vault1", "wf-1", { startup: true, engineStartedAt: "2026-10-08T10:25:00.000Z" });
    expect(r).toEqual({ requeued: [], dropped: [], reopened: ["Foreword"], queued: ["Foreword"] });
    expect(e.calls.some((c) => c.query.includes("knowledgeGraphBacklinks") && c.variables.d === "vault1" && c.variables.id === "src1")).toBe(true);
    // A source with notes derived from it is the queue's business, not a re-run.
    const withNotes = engine([], "SUCCEEDED", "EXTRACTED", { status: 404 }, stats, [{ linkType: "DERIVED_FROM" }]);
    expect(await repairQueue(deps(withNotes.fetchImpl), "vault1", "wf-1", { startup: true, engineStartedAt: "2026-10-08T10:25:00.000Z" })).toEqual({ requeued: [], dropped: [], reopened: [], queued: [] });
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `bunx vitest run sidecar/src/queue-watchdog.test.ts`
Expected: FAIL. Nothing is reopened, and the start-up test sees no backlinks query.

- [ ] **Step 3: Implement**

Extend `SourceState`, and add the rule after it:

```ts
export type SourceState = {
  id: string;
  name: string;
  status: string;
  claims: number;
  /** An extraction ran to the end and recorded its stats: "extracted, no claims" is then its result, not a loss. */
  statsRecorded?: boolean;
  /** Who recorded the stats: the old extractor wrote "extract-claims · <model>", the current one "extract-claims 2 · <model>". */
  extractedBy?: string | null;
  /** Notes derived from the source, by the graph; counted only for a source the old extractor left empty. */
  derivedNotes?: number;
};

/** Stats written by the extractor from before windows and the revised prompt. */
export const OLD_EXTRACTOR = /^extract-claims · /;
/** A source the old extractor ran to the end and found nothing in: it gets one more go with the new one. */
export const isOldEmptyExtraction = (s: SourceState): boolean => s.status === "EXTRACTED" && s.claims === 0 && s.statsRecorded === true && OLD_EXTRACTOR.test(s.extractedBy ?? "");
```

In `planSourceRepairs`, make the new rule the first branch in the loop:

```ts
    if (isOldEmptyExtraction(s) && s.derivedNotes === 0) {
      out.push({ kind: "reopen", source: s, reason: "the old extractor found nothing in it; extracting it again with the new one" });
      if (!open.has(s.id)) out.push({ kind: "queue", source: s, reason: "queued again" });
    } else if (s.status === "EXTRACTED" && s.claims === 0 && !s.statsRecorded) {
```

The rest of the loop stays as it is.

In the start-up pass, replace the source read loop with:

```ts
    const sources: SourceState[] = [];
    for (const id of sourceIds) {
      const doc = await gql<{ document: { document: { name: string; state: { global: { status?: string; extractedClaims?: unknown[]; extractionStats?: { extractedBy?: string | null } | null } } } } }>(
        deps.origin,
        `query($id: String!) { document(idOrSlug: $id) { document { name state } } }`,
        { id },
        f,
      );
      const g = doc.document.document.state.global;
      const state: SourceState = { id, name: doc.document.document.name, status: g.status ?? "", claims: g.extractedClaims?.length ?? 0, statsRecorded: !!g.extractionStats, extractedBy: g.extractionStats?.extractedBy ?? null };
      if (isOldEmptyExtraction(state)) state.derivedNotes = await derivedNoteCount(deps, vaultId, id, f);
      sources.push(state);
    }
```

Add this helper next to `repairQueue`:

```ts
/** Notes that derive from the source, by the graph's backlinks; Infinity when the graph cannot say, so nothing is reopened on a guess. */
async function derivedNoteCount(deps: WatchdogDeps, vaultId: string, sourceId: string, f: typeof fetch): Promise<number> {
  try {
    const data = await gql<{ knowledgeGraphBacklinks: { linkType: string }[] | null }>(
      deps.origin,
      `query($d: ID!, $id: String!) { knowledgeGraphBacklinks(driveId: $d, documentId: $id) { linkType } }`,
      { d: vaultId, id: sourceId },
      f,
    );
    return (data.knowledgeGraphBacklinks ?? []).filter((l) => l.linkType === "DERIVED_FROM").length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
```

In `startQueueWatchdog`'s log line, change `reopened ${r.reopened?.length ?? 0} marked extracted without claims` to:

```ts
reopened ${r.reopened?.length ?? 0} to extract again (${(r.reopened ?? []).join(", ")})
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `bunx vitest run sidecar/src/queue-watchdog.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add sidecar/src/queue-watchdog.ts sidecar/src/queue-watchdog.test.ts
git commit -m "feat(watchdog): re-run, once, the sources the old extractor left empty

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Move the app to the new vault package

**Files:** `sidecar/package.json:14`, `host/package.json:16`, `bun.lock`

- [ ] **Step 1: Point both packages at the version published in Task 11**

In both files, change `"@powerhousedao/knowledge-note": "1.0.54-dev.33"` to `"@powerhousedao/knowledge-note": "1.0.54-dev.35"`.

- [ ] **Step 2: Install, and confirm the installed piece has the new extractor**

Run: `bun install && grep -rl "extract-claims 2" sidecar/node_modules/@powerhousedao/knowledge-note/dist | head -2`
Expected: the install succeeds, and at least one file matches.

- [ ] **Step 3: Run the app's checks**

Run: `bun run tsc && bun run test`
Expected: no type errors, and all tests pass.

- [ ] **Step 4: Commit**

```bash
git add sidecar/package.json host/package.json bun.lock
git commit -m "chore: vault package 1.0.54-dev.35 — extraction in windows, convergence, a one-time re-run

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Live measurement on Liberuum with the local model

**Files:** the scripts live in the session scratchpad and are not committed.

- [ ] **Step 1: Record the baseline before the app restarts with the new version**

Save as `measure.py` in a scratch folder:

```python
#!/usr/bin/env python3
"""The sources the old extractor left empty in a vault, before the re-run and after it."""
import json, sys, urllib.request

ENGINE = "http://127.0.0.1:4201"
DRIVE = sys.argv[2] if len(sys.argv) > 2 else "t2lgNDhnAWzjVppfZ72J0d0NoBbFeEpj4f7KCIS0_iM"  # Liberuum

def gql(query, variables=None):
    req = urllib.request.Request(ENGINE + "/graphql", data=json.dumps({"query": query, "variables": variables or {}}).encode(), headers={"content-type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=60))["data"]

def state(doc_id):
    return gql("query($i:String!){ document(identifier:$i){ document { state } } }", {"i": doc_id})["document"]["document"]["state"]["global"]

def sources():
    for node in state(DRIVE)["nodes"]:
        if node.get("documentType") == "bai/source":
            g = state(node["id"])
            stats = g.get("extractionStats") or {}
            yield node["id"], {"title": g.get("title"), "status": g.get("status"), "claims": len(g.get("extractedClaims") or []),
                               "by": stats.get("extractedBy") or "", "skipped": stats.get("skippedCount"), "chars": len(g.get("content") or "")}

if sys.argv[1] == "before":
    empty = {i: s for i, s in sources() if s["status"] == "EXTRACTED" and s["claims"] == 0 and s["by"].startswith("extract-claims · ")}
    json.dump(empty, open("empty-before.json", "w"), indent=1)
    print(f"{len(empty)} sources the old extractor left empty")
else:
    before = json.load(open("empty-before.json"))
    now = dict(sources())
    done = [i for i in before if now.get(i, {}).get("by", "").startswith("extract-claims 2 · ")]
    print(f"re-run so far: {len(done)} of {len(before)}")
    for i in sorted(before, key=lambda k: -before[k]["chars"]):
        n = now.get(i, {})
        print(f"  {before[i]['chars']:>6} chars  {n.get('status', 'GONE'):<9} {n.get('claims', 0):>3} claims  {before[i]['title'][:60]}")
    made = sum(now[i]["claims"] for i in done)
    archived = sum(1 for i in done if now[i]["status"] == "ARCHIVED")
    zero = sum(1 for i in done if now[i]["status"] == "EXTRACTED" and now[i]["claims"] == 0)
    edges = gql("query($d:ID!){ knowledgeGraphEdges(driveId:$d){ linkType reason sourceDocumentId targetDocumentId } }", {"d": DRIVE})["knowledgeGraphEdges"]
    converged = [e for e in edges if e["linkType"] == "DERIVED_FROM" and (e.get("reason") or "").startswith("Also argued in ") and e["targetDocumentId"] in before]
    print(f"claims made: {made} · archived as no knowledge: {archived} · honest zeros: {zero} · links to notes already in the vault: {len(converged)}")
```

Ask the user to switch Settings › Models to the model on this computer (`gpt-oss-20b-vault`) and save. Then run:
- `curl -s -H "Authorization: Bearer $(cat .dev-data/secrets/gateway.key)" http://127.0.0.1:4202/llm/v1/active` (from the app repo) to confirm the locality. This works only once the new engine runs; before that, check Settings instead.
- `python3 measure.py before`

Expected: `48 sources the old extractor left empty` (a few fewer if any were deleted since 2026-10-15).

- [ ] **Step 2: Restart the dev app with the new version**

Ask the user to stop the dev app. Then start it with `bun run dev:vault` from the app repo.
Run: `grep -h "start-up" .dev-data/logs/*.log | tail -3`
Expected: a line `queue watchdog (…, start-up): queued again 48 (…); …; reopened 48 to extract again (…)`.

- [ ] **Step 3: Let the pipeline work through them**

The local model takes them one at a time. Check progress every few minutes with `python3 measure.py after`. If a run fails, read it in Workflow Studio's run history and decide whether to stop. The watchdog re-queues a held task after 10 minutes on its own.

- [ ] **Step 4: Measure, spot-check and report**

When `re-run so far` reaches the total, record the final `python3 measure.py after`. Then read 10 of the new notes (titles and descriptions), and every "Also argued in" link.

Report to the user:
- the per-source table, and the totals: claims made, archived, honest zeros, and links to existing notes;
- how long the run took;
- the spot-check findings;
- anything that failed.

Compare with the baseline: 0 notes from these 48 sources, and the probe's 17 for "Chapter 3 Hardware" and 10 for "Chapter 1 Prerequisites".
