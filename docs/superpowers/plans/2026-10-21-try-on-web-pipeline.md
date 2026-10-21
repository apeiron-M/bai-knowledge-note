# Try on web: Browser Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the browser vault (/try), a source the visitor adds is processed by their own AI through the queue's four phases, visibly; the guide is dated to the visit, links well enough to pass its health check, and the health report is written by the browser.

**Architecture:** A runner in `browser/pipeline/` (started by `browser/boot.ts`) watches the in-page queue and runs the desktop's pipeline stages from `pieces/knowledge-vault/lib/agent/` against the REST routes the page already serves, with the AI the visitor connected in the chat. Pure helpers do the guide's re-dating (`browser/seed-dates.ts`) and the health computation (`editors/knowledge-vault/lib/health-checks.ts`, shared with the dashboard). Editors learn the runner's state through the host config, never by importing `browser/*`.

**Tech Stack:** TypeScript (nodenext), React 19, PGlite reactor in the page, vitest (Node env), Playwright for the end-to-end check.

**Spec:** `docs/superpowers/specs/2026-10-21-try-on-web-pipeline-design.md`

## Global Constraints

- Work in a worktree outside the repo: `git worktree add ../bai-knowledge-note-pipeline -b feat/try-pipeline main`, then `bun install` there. The landing runs it with `KV_PACKAGE_DIR=../bai-knowledge-note-pipeline npm run dev:local-vault`.
- bun only: `bun install`, `bun run tsc`, `bunx oxlint <files>`, `bun run test <paths>`. Never npm/pnpm/yarn install or run.
- Per task: `bun run tsc` clean, `bunx oxlint` clean on changed files, the task's tests pass. Before the last commit: `bun run test`, `bun run test:coverage` (≥ 95 % on `pieces/**/lib/**`), `bun run build` (its `check-server-build` must pass).
- Code the browser runs never imports `node:*`. `editors/`, `subgraphs/`, `processors/`, `document-models/`, `index.ts` never import `browser/*`.
- Every option added to shared code defaults to today's behaviour: the desktop and Switchboard must not change.
- Limits: pickup ≤ 30 s (live feed + a 10 000 ms timer); one task at a time; ≤ 12 model calls per source (`CALL_BUDGET = 12`); the source text sent is capped to one window (`HOSTED_WINDOW_CHARS` / `LOCAL_WINDOW_CHARS` from `agent/windows.ts`); an unreachable AI is retried every 30 000 ms.
- Exact copy (simple, direct, few words):
  - `Waiting for your AI — connect one in Ask`
  - `Can't reach your AI — check it is running and allows this page`
  - `Queued — your AI starts in a moment`
  - `Processing — <phase words>` (existing `PHASE_WORDS`)
  - Failure reasons: `Your AI did not answer in time`, `Your AI's answer could not be used`, `Your AI refused the key`
  - Paste form (browser): `Paste the text. Once added, your AI turns it into notes.`
  - Intake review (browser): `Your AI turns these {n} sources into notes, one after another.` / `Your AI turns this source into notes.`
  - Failed source button: `Process again`
- The runner signs and assigns as `knowledge-vault-web`; health reports are `generatedBy: "knowledge-vault-web"`, `mode: "browser"`.

## Review Focus

1. A source with almost no text (one sentence, or a heading only) → the create phase archives it as "no knowledge" and the task still completes; nothing loops. *(Task 9 test)*
2. A local AI without CORS, or offline → "Failed to fetch" means *unreachable*: tasks wait, none is failed, it recovers when the AI comes back. *(Tasks 8 and 9 tests)*
3. The tab closed mid-phase → on the next visit the task assigned to `knowledge-vault-web` resumes at its phase, with no duplicate notes (flushes held per phase). *(Task 9 test)*
4. A very long source (60 000 characters) → one window is read, the handoff says only the first part was read, the call budget holds. *(Task 9 test)*
5. Reset while a task runs → the runner stops before the store closes; no write after stop. *(Task 9 test)*

---

### Task 1: Pipeline code the browser can run

**Files:**
- Modify: `pieces/knowledge-vault/lib/agent/write.ts`, `agent/verify.ts`, `agent/pipeline.ts` (the `randomUUID` import)
- Test: `pieces/knowledge-vault/test/browser-safe.test.ts`

**Interfaces:** Produces nothing new; `agent/*.ts`, `common/client.ts`, `common/errors.ts` become importable in a browser bundle.

- [ ] **Step 1: Write the failing test** — `it("agent and client code import no node: module")`: for each of `agent/{staged,write,connect,synthesize,pipeline,verify,windows,llm,extract}.ts`, `common/{client,errors}.ts`, `expect(readFileSync(path, "utf8")).not.toMatch(/from "node:/)`.
- [ ] **Step 2: Run** `bun run test pieces/knowledge-vault/test/browser-safe.test.ts` — expected FAIL naming write.ts, verify.ts, pipeline.ts.
- [ ] **Step 3: Replace** `randomUUID()` from `node:crypto` with `globalThis.crypto.randomUUID()` in the three files.
- [ ] **Step 4: Run** `bun run test pieces` — all PASS.
- [ ] **Step 5: Commit** `refactor(pieces): the pipeline's agent code uses Web Crypto, so a browser can run it`

### Task 2: A browser option for new maps

**Files:**
- Modify: `pieces/knowledge-vault/lib/agent/synthesize.ts` (`PLACE_SYSTEM`, `checkPlan`, the ≥ 3 filter near line 111, `planStage`)
- Test: `pieces/knowledge-vault/test/phases.test.ts` (extend the `planStage` / `checkPlan` blocks)

**Interfaces:** Produces `type PlaceOptions = { minNewTopic?: number; newTopicTitle?: string }`; `placeSystem(opts?: PlaceOptions): string`; `PLACE_SYSTEM` stays exported and equals `placeSystem()`; `checkPlan(value, notes, mocs, opts?: PlaceOptions)`; `planStage(llm, model, notes, mocs, fetchImpl?, opts?: PlaceOptions)`. Default `minNewTopic` is 3.

- [ ] **Step 1: Write the failing tests:**
  - `expect(placeSystem()).toBe(PLACE_SYSTEM)` and `PLACE_SYSTEM` still contains `three or more`.
  - `placeSystem({ minNewTopic: 1, newTopicTitle: "Reading group" })` contains `titled "Reading group"` and does not contain `three or more`.
  - `checkPlan` with one note in `new:1`: without options, a problem containing `needs 3 or more`; with `{ minNewTopic: 1 }`, no problem.
  - `planStage(..., { minNewTopic: 1, newTopicTitle: "Reading group" })` with the fake LLM answering one note in `new:1` → `newMocs.length === 1`.
- [ ] **Step 2: Run** `bun run test pieces/knowledge-vault/test/phases.test.ts` — expected FAIL (`placeSystem` not exported).
- [ ] **Step 3: Implement** — the prompt's "three or more" sentence comes from `minNewTopic`; with `newTopicTitle` the prompt adds: if no existing MoC fits a note, place it in one new TOPIC MoC titled `"<title>"`, whatever the count.
- [ ] **Step 4: Run** `bun run test pieces` and `bun run test:coverage` — PASS, pieces lib ≥ 95 %.
- [ ] **Step 5: Commit** `feat(pieces): placement can open a map for fewer notes, named by the caller (default unchanged)`

### Task 3: Health checks as one shared function

**Files:**
- Create: `editors/knowledge-vault/lib/health-checks.ts`
- Modify: `editors/knowledge-vault/components/HealthDashboard.tsx` (lines 84–298 call the function instead of computing inline)
- Test: `editors/knowledge-vault/lib/health-checks.test.ts`

**Interfaces:** Produces `computeHealth(input: HealthInput): HealthResult`, where:
- `HealthInput = { notes: HealthNote[]; mocs: { id: string; coreIdeas: string[] }[]; pendingObservations: { id: string; title: string }[]; openTensions: { id: string; title: string }[] }`
- `HealthNote = { id: string; title: string; description: string; noteType: string | null; topics: string[]; links: string[] /* target note ids */ }`
- `HealthResult = { overallStatus: "PASS" | "WARN" | "FAIL"; checks: { category: string; status: "PASS" | "WARN" | "FAIL"; message: string; affectedItems: string[] }[]; metrics: { noteCount; mocCount; connectionCount; density; orphanCount; danglingLinkCount; mocCoverage; averageLinksPerNote }; recommendations: string[] }`

Checks, thresholds and messages are exactly the dashboard's today. The new metrics:
- `danglingLinkCount`: links whose target is not a note in the input.
- `mocCoverage`: notes in some map's `coreIdeas` ÷ notes.
- `density`: `connectionCount / (n·(n−1))`.

- [ ] **Step 1: Write the failing tests:**
  - orphans 0 / 3 / 4 → PASS / WARN / FAIL;
  - average links 2.0 / 1.5 / 0.9 → PASS / WARN / FAIL;
  - overall is FAIL if any check fails, else WARN if any warns, else PASS;
  - a link to an unknown id counts as dangling;
  - 2 of 4 notes in maps → `mocCoverage === 0.5`;
  - no observations and no tensions → those two checks are absent.
- [ ] **Step 2: Run** `bun run test editors/knowledge-vault/lib/health-checks.test.ts` — expected FAIL.
- [ ] **Step 3: Implement** by moving the dashboard's logic; the dashboard maps its notes to `HealthInput` and renders `computeHealth(...)`.
- [ ] **Step 4: Run** the new test and the dashboard's existing tests (`bun run test editors/knowledge-vault`) — PASS.
- [ ] **Step 5: Commit** `refactor(editors): health checks in one function the dashboard and the browser share`

### Task 4: The guide passes its health check

**Files:**
- Modify: `browser/seed/guide-vault.json` (`relationships`; the queue task's reflect handoff text; `version`)
- Create: `scripts/seed-version.mjs` (recomputes `version` = `sha256(JSON.stringify(content)).slice(0, 12)` over `{ drive, documents, relationships }`, the same formula as `build-browser-seed.mjs`, and rewrites the file)
- Test: `browser/seed/guide-vault.test.ts`

**Interfaces:** Consumes `computeHealth` (Task 3).

- [ ] **Step 1: Write the failing test** — from the seed, build a `HealthInput`: notes, their note-to-note links, and maps' `CORE_IDEA` edges as `coreIdeas`. Then assert:
  - `computeHealth(...).overallStatus === "PASS"`;
  - every note-to-note link has a `metadata.reason` of ≥ 20 characters, and a `confidence` in `grounded | established | speculative`;
  - every link's ends are seed documents;
  - the reflect handoff's link count equals the number of note-to-note links;
  - `version` equals the recomputed hash.
- [ ] **Step 2: Run** `bun run test browser/seed` — expected FAIL (ORPHAN_DETECTION FAIL, LINK_HEALTH WARN).
- [ ] **Step 3: Add the links.** Write at least 15 new note-to-note links, so that every one of the 5 notes with no incoming link gets one, and the total reaches ≥ 60. Each link is `RELATES_TO` or `BUILDS_ON`, with a reason that names what connects the two notes and holds against both notes' text. Then update the handoff count and run `node scripts/seed-version.mjs browser/seed/guide-vault.json`.
- [ ] **Step 4: Run** `bun run test browser/seed` — PASS.
- [ ] **Step 5: Commit** `feat(browser): the guide links every note and passes its health check`

### Task 5: The guide dated to the visit

**Files:**
- Create: `browser/seed-dates.ts`
- Modify: `browser/boot.ts` (re-date before the skeleton; keep the id map in the seed stamp; expose it)
- Test: `browser/seed-dates.test.ts`

**Interfaces:**
- Produces `redateSeed(seed: VaultSeed, now: Date): { seed: VaultSeed; ids: Record<string, string> }`.
- `BootedVault.guideIds: Readonly<Record<string, string>>` maps seed id → this vault's id. It comes from the stamp on return visits, and is empty if the stamp predates this.
- The stamp becomes `{ version, driveId, ids? }`.

- [ ] **Step 1: Write the failing tests** (against the real `guide-vault.json`, `now = new Date("2030-01-02T03:04:05.000Z")`):
  - the latest timestamp in the result equals `now`;
  - every whole-string ISO timestamp moves by the same delta (check `extractionStats.extractedAt`, a handoff's `completedAt`, a note's `provenance.createdAt`);
  - each document's id equals `deriveDocumentId({ documentType, createdAtUtcIso, nonce, protocolVersions })` of its new `created`;
  - `JSON.stringify(result.seed)` contains no old id;
  - relationship ends and drive file node ids are new ids, and folder ids are unchanged;
  - note `content` strings are unchanged;
  - `Object.keys(ids).length === 36`.
- [ ] **Step 2: Run** `bun run test browser/seed-dates.test.ts` — expected FAIL.
- [ ] **Step 3: Implement.** Shift = `now − latest`. Replace ids by an exact-string substitution over the serialized seed: ids are unique 43-character strings.
- [ ] **Step 4: Run** — PASS. Then `bun run tsc`.
- [ ] **Step 5: Commit** `feat(browser): the guide is dated to the visit, every id following its new date`

### Task 6: The health report, written in the browser

**Files:**
- Create: `browser/health.ts`
- Modify: `browser/boot.ts` (after `seedContent` and before `flushes.release()`, `await writeHealthReport(...)`)
- Test: `browser/health.test.ts`

**Interfaces:**
- Consumes `computeHealth` (Task 3).
- Produces `healthInputFromGraph(graph: { nodes: GraphNode[]; edges: GraphEdge[] }): HealthInput`, which is pure and uses the shapes the knowledge-graph service returns for `knowledgeGraphNodes` / `knowledgeGraphEdges`.
- Produces `writeHealthReport(deps: { client: IReactorClient; knowledgeGraph: { execute(body): Promise<ExecutionResult> }; driveId: string; now?: () => Date }): Promise<HealthResult>`. It dispatches `GENERATE_REPORT` (`generatedBy: "knowledge-vault-web"`, `mode: "browser"`), then one `ADD_CHECK` per check (fresh `id` each), to the drive's `bai/health-report` document.

- [ ] **Step 1: Write the failing tests:**
  - `healthInputFromGraph` counts only note-to-note edges as links;
  - `CORE_IDEA` edges fill `coreIdeas`;
  - `DERIVED_FROM` is ignored;
  - archived notes are left out;
  - `writeHealthReport` with a fake client and graph sends one `GENERATE_REPORT`, then `checks.length` `ADD_CHECK`s with distinct ids, in that order.
- [ ] **Step 2: Run** `bun run test browser/health.test.ts` — expected FAIL.
- [ ] **Step 3: Implement** — find the report document from the drive's file nodes (`documentType === "bai/health-report"`).
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(browser): the browser writes the vault's health report once the guide is in`

### Task 7: What the browser says while a source waits

**Files:**
- Modify: `editors/shared/host-config.ts`
- Modify: `editors/source-editor/lib/queue-status.ts` and its callers
- Modify: the paste form's lede (`pasteLede`)
- Modify: the intake review panel (`editors/knowledge-vault/components/intake/`, where the ticked sections are confirmed)
- Modify: the source editor's queue area ("Process again")
- Test: `editors/source-editor/lib/queue-status.test.ts` (extend); a test for the review line and for the "Process again" decision.

**Interfaces:**
- Produces `type HostPipelineState = { kind: "ready" } | { kind: "no-ai" } | { kind: "unreachable" } | { kind: "working"; taskId: string }` and `type HostPipeline = { state(): HostPipelineState; subscribe(listener: () => void): () => void }`.
- Produces `KnowledgeVaultHostConfig.pipeline?: HostPipeline`.
- `queueStatusLine(task, opts: { host: "desktop" | "browser" | "server"; ai?: HostPipelineState["kind"]; now: number })` replaces `opts.desktop`. Update every caller.

- [ ] **Step 1: Write the failing tests:**
  - browser + PENDING at `create` + `no-ai` → `Waiting for your AI — connect one in Ask`;
  - with `unreachable` → `Can't reach your AI — check it is running and allows this page`;
  - with `ready` → `Queued — your AI starts in a moment`;
  - in `reflect` → `Processing — <PHASE_WORDS.reflect>`;
  - browser never returns the Claude Code hint, even after 10 minutes;
  - desktop and server lines are unchanged;
  - the review line for 3 sections → `Your AI turns these 3 sources into notes, one after another.`, for 1 → `Your AI turns this source into notes.`;
  - "Process again" shows only when the source's latest task is FAILED.
- [ ] **Step 2: Run** `bun run test editors/source-editor editors/knowledge-vault/components/intake` — expected FAIL.
- [ ] **Step 3: Implement.** "Process again" uses the same path as the source's existing queue action: `ADD_TASK` with a fresh id, then `SET_SOURCE_STATUS EXTRACTING`. The editor subscribes to `getHostConfig()?.pipeline`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(editors): in the browser, a waiting source says why and what to do`

### Task 8: The AI the pipeline uses

**Files:**
- Create: `browser/pipeline/ai.ts`
- Modify: `editors/knowledge-vault/hooks/use-openrouter.ts` (export `chatModel(): string | null`: the stored choice under `bai-chat-model:v1`, else the default the chat itself picks — no duplicated logic)
- Test: `browser/pipeline/ai.test.ts`

**Interfaces:**
- Produces `pipelineAi(): PipelineAi | null`, where `PipelineAi = { llm: LlmClient; model: string; local: boolean; label: string; fetchImpl: typeof fetch; calls(): number }`. Its `fetchImpl` must also be passed to `new LlmClient(credentials, fetchImpl)`.
- Produces the errors `AiUnreachableError`, `AiRefusedError` and `CallBudgetError`, and `CALL_BUDGET = 12`.
- Credentials are `{ baseUrl: endpoint.completionsUrl without "/chat/completions", apiKey, defaultModel: model }` from `activeProvider(readSavedProviders())` and `endpointFor()`.

- [ ] **Step 1: Write the failing tests:**
  - no saved provider → `null`;
  - OpenRouter → model from `bai-chat-model:v1`, `local === false`;
  - custom `http://localhost:11434/v1` → `local === true`, and requests carry no `HTTP-Referer` / `X-Title`;
  - the 13th completions call throws `CallBudgetError`;
  - a `TypeError("Failed to fetch")` becomes `AiUnreachableError`;
  - 401 becomes `AiRefusedError`.
- [ ] **Step 2: Run** `bun run test browser/pipeline/ai.test.ts` — expected FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(browser): the pipeline uses the AI connected in the chat`

### Task 9: The pipeline runner

**Files:**
- Create: `browser/pipeline/phases.ts`, `browser/pipeline/runner.ts`
- Test: `browser/pipeline/phases.test.ts` (against `pieces/knowledge-vault/test/vault-server.ts` and a fake LLM, as `phases.test.ts` in the piece does); `browser/pipeline/runner.test.ts` (fakes, vitest fake timers)

**Interfaces:**
- Consumes Tasks 1, 2, 6, 7, 8.
- Produces `runPhase(phase: PipelinePhase, ctx: PhaseContext): Promise<PhaseOutcome>`, where `PhaseContext = { client: KnowledgeVaultClient; drive: string; sourceId: string; ai: PipelineAi; mapTitle: string }` and `PhaseOutcome = { workDone: string; filesModified: string[]; incomplete?: string }`. Each phase mirrors the piece's action `run()`:
  - **create** — `readSourceStage`; the text is truncated to one window, and the handoff says when only the first part was read. Then `candidatesStage` → `checkVaultStage` → `draftStage` → `reportStage` → `writeStage`.
  - **reflect** — `sourceNotes` → `gatherCandidates` → `proposeLinksStage` → `writeLinksStage`.
  - **reweave** — `readMocs` → `planStage(..., { minNewTopic: 1, newTopicTitle: mapTitle })` → `writePlacementsStage`.
  - **verify** — local checks per note, with no model call; workDone is `Checked N notes`.
- Produces `startPipelineRunner(deps: RunnerDeps): PipelineRunner`, where `RunnerDeps = { client: KnowledgeVaultClient; driveId: string; flushes: FlushGate; ready: Promise<void>; onChange(listener: () => void): () => void; afterTask(): Promise<void> }` and `PipelineRunner = HostPipeline & { stop(): Promise<void> }`.
- **Pickup:** after `ready`, on every `onChange` and every 10 000 ms. Take the first `claim` task that is PENDING at `create`, or IN_PROGRESS and assigned to `knowledge-vault-web`.
- **Per phase:** `flushes.hold()` → `claimPhase` → `runPhase` → `advancePipeline` (`completedBy: "knowledge-vault-web · <model>"`) → `flushes.release()`.
- **Failures:**
  - `AiUnreachableError` → state `unreachable`, task untouched, retry after 30 000 ms.
  - Budget, refused, unreadable or timeout → `FAIL_TASK` with the exact reason.
  - **A phase whose writes partly land:** its `incomplete` text goes into `workDone` ("… — 2 links did not land"), and it is **not** passed as `advancePipeline`'s `incomplete`. That argument keeps the task at its phase, and the 10 s pickup would re-run it in a loop.
- **After a completed task:** `afterTask()`.
- **`mapTitle`:** the file name a section came from (see how the intake records it on the source), else the source title.

- [ ] **Step 1: Write the failing tests:**
  - **phases**, with a 3-claim source:
    - *create* writes 3 notes linked `DERIVED_FROM`;
    - *reflect* writes ≥ 1 link;
    - *reweave* with no fitting map opens a map titled `mapTitle`;
    - *verify* makes 0 model calls and returns `Checked 3 notes`.
  - **phases**, edge sources:
    - a one-sentence source completes as archived ("no knowledge"), with no loop;
    - a 60 000-character source calls candidates for one window only, and its handoff says the first part was read.
  - **runner:**
    - picks the PENDING `create` task;
    - with no AI → state `no-ai` and nothing claimed;
    - unreachable → state `unreachable`, no `FAIL_TASK`, and after 30 s it runs;
    - budget exceeded → `FAIL_TASK` `Your AI's answer could not be used`;
    - resumes an IN_PROGRESS task assigned to `knowledge-vault-web` at its phase;
    - `hold` / `release` exactly once per phase;
    - `stop()` during a phase → no further claim or write;
    - a provider changed between two tasks is used for the second;
    - a phase returning `incomplete` still advances, with the text in its handoff.
- [ ] **Step 2: Run** `bun run test browser/pipeline` — expected FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS. Then `bun run tsc`.
- [ ] **Step 5: Commit** `feat(browser): sources become notes in the browser, through the visitor's AI`

### Task 10: Wiring, and the end-to-end check

**Files:**
- Modify: `browser/boot.ts` — start the runner once `seeding` settles (at once on a return visit); `setHostConfig({ ..., pipeline: runner })`; `stop()` stops the runner first; `afterTask` → `writeHealthReport`.
- Create: `browser/e2e/pipeline.e2e.mjs` — Playwright, run against a landing URL. It stubs `https://openrouter.ai/api/v1/chat/completions` and `/models` with `page.route`, answering each stage by its system prompt; the provider and key are set in localStorage before load. Add `@playwright/test` as a devDependency with `bun add -d`.

- [ ] **Step 1: Write the e2e checks** (run `node browser/e2e/pipeline.e2e.mjs --origin http://localhost:3000` with the landing on `dev:local-vault`):
  1. **First visit:**
     - Health check shows the report, overall PASS, by `knowledge-vault-web`;
     - Sources › Timeline shows the guide under today's date;
     - Processing queue › Finished shows the guide's task with four steps dated today.
  2. **Stub AI connected, paste a 3-paragraph source:**
     - within 30 s the queue shows it in progress;
     - then Finished with four steps;
     - the source is EXTRACTED;
     - the Notes count grew;
     - a map named after the source exists;
     - the health report was rewritten.
  3. **No AI, paste a source:**
     - `Waiting for your AI — connect one in Ask`;
     - after connecting the stub, it is processed within 30 s.
  4. **Stub aborted (`route.abort()`):**
     - `Can't reach your AI — …`, and the task is still waiting;
     - after restoring the stub, it is processed.
- [ ] **Step 2: Run** — expected FAIL (the runner is not started).
- [ ] **Step 3: Wire `boot.ts`** as above.
- [ ] **Step 4: Run** the e2e, then the existing browser suites (regression 17, reload/Reset 5, PDF 4, dev mode 5) and `bun run test`, `bun run test:coverage`, `bun run build` — all PASS.
- [ ] **Step 5: Commit** `feat(browser): the pipeline runs in Try on web`
