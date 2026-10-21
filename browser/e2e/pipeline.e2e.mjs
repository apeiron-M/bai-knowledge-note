#!/usr/bin/env node
/**
 * The browser pipeline (Try on web), end to end, against a running landing:
 *
 *   node browser/e2e/pipeline.e2e.mjs --origin http://localhost:3000 [--shots <dir>]
 *
 * The landing must serve this repository's build: `bun run dev:local-vault` in
 * knowledge-vault-landing (KV_PACKAGE_DIR=<this repo> when it is not ../bai-knowledge-note).
 * A stub stands in for OpenRouter (page.route): it answers each pipeline stage by its
 * system prompt, so the run needs no key and no network. Prints one PASS/FAIL line per
 * check and exits 1 on any FAIL.
 */
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const ORIGIN = option("--origin", "http://localhost:3000").replace(/\/$/, "");
const SHOTS = option("--shots", null);
/** The page's own REST routes (browser/local-origin.ts): reached with the page's fetch. */
const REST = "https://knowledge-vault.invalid/api/@powerhousedao/knowledge-note";
const STUB_MODEL = "stub/pipeline-model";
const TODAY = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });

// ── The stub AI ─────────────────────────────────────────────────────────────────────────────

const stub = { mode: "on", delayMs: 600, asked: 0 };
const LINK_REASON = "The stale-data problem is exactly what dropping entries on write is there to prevent.";

/** What a capable model answers each pipeline stage, keyed by the opening of its system prompt. */
function answerFor(system, user) {
  if (system.startsWith("You find atomic knowledge claims")) {
    const title = /Source title: (.+)/.exec(user)?.[1]?.trim() ?? "The source";
    const kept = [1, 2, 3].map((i) => ({ claim: `${title} holds that point ${i} changes how caches behave`, locus: `paragraph ${i}`, evidence: "e", disagreement: "someone would argue otherwise" }));
    return { source_kind: "knowledge", non_claims: 0, skipped: [], kept };
  }
  if (system.startsWith("You write atomic notes")) {
    const notes = [...user.matchAll(/^- (c\d+): (.+)$/gm)].map((m, i) => ({
      candidate_id: m[1],
      title: m[2].trim(),
      description: `Why claim ${i + 1} holds, and what changes when it does not`,
      note_type: "concept",
      content: "The mechanism, the evidence and the conditions under which the claim holds, in enough words to stand alone.",
      topics: ["caching"],
      confidence: "grounded",
      locus: `paragraph ${i + 1}`,
    }));
    return { notes, existing: [] };
  }
  if (system.startsWith("You compare drafted knowledge notes")) return { same: [] };
  if (system.startsWith("You link atomic notes")) {
    const ids = [...user.matchAll(/NEW (\S+): /g)].map((m) => m[1]);
    return { links: ids.slice(1).map((id, i) => ({ from: id, to: ids[i], type: "BUILDS_ON", reason: LINK_REASON, confidence: "grounded" })) };
  }
  if (system.startsWith("You place atomic notes")) {
    const notes = [...user.slice(user.indexOf("Notes to place:")).matchAll(/^- (\S+): /gm)].map((m) => m[1]);
    const parent = /^- (\S+) \[HUB/m.exec(user)?.[1] ?? "new:hub";
    return { placements: notes.map((note) => ({ note, moc: "new:1" })), new_mocs: [{ key: "new:1", title: "Caching", description: "How caches stay fast and right", orientation: "Start with expiry.", parent }] };
  }
  return null;
}

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,OPTIONS" };

async function openRouterStub(route) {
  const request = route.request();
  if (stub.mode === "abort") return route.abort("connectionrefused");
  if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
  const json = (body, status = 200) => route.fulfill({ status, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify(body) });
  const path = new URL(request.url()).pathname;
  if (path.endsWith("/models")) {
    return json({ data: [{ id: STUB_MODEL, name: "Stub", created: 2, context_length: 200000, pricing: { prompt: "0", completion: "0" }, supported_parameters: ["tools", "response_format"] }] });
  }
  if (path.endsWith("/chat/completions")) {
    const body = JSON.parse(request.postData() ?? "{}");
    const answer = answerFor(body.messages?.[0]?.content ?? "", body.messages?.[1]?.content ?? "");
    if (!answer) return json({ error: { message: "The stub does not know this prompt." } }, 500);
    stub.asked++;
    await new Promise((resolve) => setTimeout(resolve, stub.delayMs));
    return json({ choices: [{ message: { role: "assistant", content: JSON.stringify(answer) }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 } });
  }
  return json({});
}

// ── The page ────────────────────────────────────────────────────────────────────────────────

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.route("https://openrouter.ai/**", openRouterStub);
const page = await context.newPage();
const problems = [];
page.on("pageerror", (error) => problems.push(error.message));

const shot = async (name) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/pipeline-${name}.png` });
};
const text = async () => (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
const until = async (predicate, timeoutMs, everyMs = 1000) => {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > end) return null;
    await page.waitForTimeout(everyMs);
  }
};
const rest = (path, init) =>
  page.evaluate(
    async ({ url, init }) => {
      const response = await fetch(url, init);
      return response.json();
    },
    { url: `${REST}/${path}`, init },
  );

const connectStub = () =>
  page.evaluate((model) => {
    localStorage.setItem("bai-chat-providers:v1", JSON.stringify({ active: "openrouter", openrouter: { key: "stub-key" }, custom: null, connect: false }));
    localStorage.setItem("bai-chat-model:v1", model);
  }, STUB_MODEL);

const openPlace = async (place) => {
  // The sidebar's list, or its icon row while a folder or document is open.
  await page.locator(`[data-place="${place}"]:visible, [data-place-icon="${place}"]:visible`).first().click();
  await page.waitForTimeout(800);
};
const openSetting = async (name) => {
  await page.getByRole("button", { name: /^Vault settings$/ }).first().click();
  await page.getByText(name, { exact: false }).first().click();
  await page.waitForTimeout(1500);
};
const openQueueView = async (view) => {
  await openSetting("Processing queue");
  await page.getByRole("tab", { name: view }).first().click();
  await page.waitForTimeout(800);
};

/** Sources › Paste text: the way a visitor adds text. */
async function pasteSource(title, content) {
  await openPlace("sources");
  await page.locator("button:visible", { hasText: "Paste text" }).first().click();
  // The create dialog, from the Sources list or the Timeline: "Name your source…" / "Name your add source…".
  await page.locator('input[placeholder^="Name your"]:visible').first().fill(title);
  await page.getByRole("button", { name: /^Create$/ }).click();
  await page.locator("#in-title").waitFor({ timeout: 20000 });
  await page.locator("#in-title").fill(title);
  await page.locator("#in-content").fill(content);
  await page.getByRole("button", { name: "Add source", exact: true }).click();
}

const paragraphs = (topic) =>
  [
    `Teams that put a cache in front of ${topic} stop asking the network for the same key twice.`,
    `When nothing ever expires, the cache keeps answering with what ${topic} said last week.`,
    `Dropping an entry whenever its key is written keeps answers right, and reads never wait for it.`,
  ].join("\n\n");

// ── 1. First visit ─────────────────────────────────────────────────────────────────────────

await page.goto(`${ORIGIN}/try`);
await page.locator('[data-guide="written"]').first().waitFor({ timeout: 180000 });
const drives = await rest("drives");
const drive = (Array.isArray(drives) ? drives : drives.drives)[0].id;
const nodes = async () => (await rest(`notes/${drive}?drive=${drive}`)).state.global.nodes;
const queueId = (await nodes()).find((n) => n.documentType === "bai/pipeline-queue").id;
const taskFor = async (title) => (await rest(`notes/${queueId}?drive=${drive}`)).state.global.tasks.filter((t) => t.target === title).at(-1) ?? null;
const report = async () => {
  const id = (await nodes()).find((n) => n.documentType === "bai/health-report")?.id;
  return id ? (await rest(`notes/${id}?drive=${drive}`)).state.global : null;
};
const noteCount = async () => (await rest(`stats?drive=${drive}`)).noteCount;

await openSetting("Health check");
let seen = await text();
await shot("1-health");
check("first_visit_health_pass", /PASS/.test(seen) && /knowledge-vault-web/.test(seen) && !/No health report generated yet/.test(seen));

await openPlace("sources");
await page.getByText("Timeline", { exact: true }).first().click();
await page.waitForTimeout(1500);
seen = await text();
await shot("1-timeline");
check("first_visit_timeline_today", seen.includes(TODAY) || /Today/i.test(seen), TODAY);

await openQueueView(/Finished/);
const guideRow = page.locator("tr.pq-row", { hasText: "How Knowledge Vault works" }).first();
await guideRow.locator("button.pq-expand").click();
await page.waitForTimeout(500);
const guideSteps = await page.locator("ol.pq-handoffs > li").count();
seen = await text();
await shot("1-queue");
check("first_visit_queue_guide_four_steps_today", guideSteps === 4 && (seen.includes(TODAY) || /today|just now|min ago|minutes ago/i.test(seen)), `${guideSteps} steps`);

// ── 2. No AI: the source waits and says why; connected, it is processed ────────────────────

const notesAtStart = await noteCount();
const reportAtStart = await report();
const waiting = "Waiting source";
await pasteSource(waiting, paragraphs("the billing service"));
const waitLine = await until(async () => (await text()).includes("Waiting for your AI — connect one in Ask"), 30000);
await shot("2-waiting");
check("no_ai_says_waiting", !!waitLine);
check("no_ai_task_untouched", (await taskFor(waiting))?.status === "PENDING");

await connectStub();
const done = await until(async () => ((await taskFor(waiting))?.status === "DONE" ? await taskFor(waiting) : null), 40000);
check("connected_processed_within_30s", !!done, done ? "" : JSON.stringify(await taskFor(waiting)));
check("four_handoffs", done?.handoffs?.length === 4, (done?.handoffs ?? []).map((h) => `${h.phase}: ${h.workDone}`).join(" | "));
const waitingSource = (await nodes()).find((n) => n.documentType === "bai/source" && n.name === waiting);
const sourceState = waitingSource ? (await rest(`notes/${waitingSource.id}?drive=${drive}`)).state.global : null;
check("source_extracted", sourceState?.status === "EXTRACTED", sourceState?.status ?? "no source");
const notesNow = await noteCount();
check("notes_grew", notesNow > notesAtStart, `${notesAtStart} → ${notesNow}`);
const maps = (await rest(`graph.json?drive=${drive}`)).nodes.filter((n) => n.status === "MOC").map((n) => n.title);
check("map_named_after_source", maps.includes(waiting), maps.join("; "));
const reportNow = await until(async () => {
  const r = await report();
  return r && r.generatedAt !== reportAtStart?.generatedAt ? r : null;
}, 15000);
check("health_report_rewritten", !!reportNow, `${reportAtStart?.generatedAt} → ${reportNow?.generatedAt}`);

// ── 3. AI connected: the queue shows the work as it happens ────────────────────────────────

stub.delayMs = 2500;
const watched = "Watched source";
await pasteSource(watched, paragraphs("the search index"));
await openQueueView(/^Open/);
const working = await until(async () => {
  const row = page.locator("tr.pq-row", { hasText: watched }).first();
  return (await row.count()) > 0 && /Working/.test(await row.innerText());
}, 30000, 500);
await shot("3-working");
check("queue_shows_in_progress_within_30s", !!working);
const finished = await until(async () => ((await taskFor(watched))?.status === "DONE" ? true : null), 60000);
await openQueueView(/Finished/);
const watchedRow = page.locator("tr.pq-row", { hasText: watched }).first();
const listed = (await watchedRow.count()) > 0;
if (listed) await watchedRow.locator("button.pq-expand").click();
await page.waitForTimeout(500);
await shot("3-finished");
const watchedSteps = listed ? await watchedRow.locator("xpath=following-sibling::tr[1]").locator("ol.pq-handoffs > li").count() : 0;
check("queue_finished_four_steps", !!finished && watchedSteps === 4, `${watchedSteps} steps`);
stub.delayMs = 600;

// ── 4. The AI cannot be reached: the source waits, then is processed once it is back ───────

stub.mode = "abort";
const unreachable = "Unreachable source";
await pasteSource(unreachable, paragraphs("the sync engine"));
const cantReach = await until(async () => (await text()).includes("Can't reach your AI"), 30000);
await shot("4-unreachable");
check("unreachable_says_so", !!cantReach);
check("unreachable_task_still_waiting", (await taskFor(unreachable))?.status === "PENDING", (await taskFor(unreachable))?.status);
stub.mode = "on";
const back = await until(async () => ((await taskFor(unreachable))?.status === "DONE" ? true : null), 50000);
check("processed_after_ai_is_back", !!back, back ? "" : JSON.stringify(await taskFor(unreachable)));

check("no_page_errors", problems.length === 0, problems.slice(0, 3).join(" | "));
console.log(`${results.filter(Boolean).length}/${results.length} checks passed; the stub answered ${stub.asked} model calls.`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
