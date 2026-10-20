# App Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The desktop app and the vault say what the work is doing and keep what people have: a processing status that reads the work, an Update that keeps a pipeline's runs, copy and guides that describe the app as it is, Activity filters that match, links that always have a real target and a reason, scope deletion that leaves nothing dangling, and find and filter in the graph.

**Architecture:**
- **Vault package** (`bai-knowledge-note`, Tasks 1–26): editor and view changes, one graph-indexer change (link activity rows), and wording in the workflow piece. Released as one dev version (Task 26).
- **Desktop app** (`knowledge-vault-app`, Tasks 27–40): the sidecar's pipeline manager (Update in place, status) and its control API, the host's chip and onboarding, comments and the built-in guide source. It then moves to the released package (Task 40).
- **Task 41** deletes Liberuum's two left-over work breakdowns through the new list, once the app runs the new package.

**Tech Stack:** TypeScript, React, vitest, oxlint; bun locally; node at runtime; the Powerhouse workflow runtime (stack 6.2.3-dev.60).

**Spec:** `docs/superpowers/specs/2026-10-15-app-polish-design.md` (approved 2026-10-16: every recommended option; decision 7 — checkbox checked by default, the chat only unlinks, the "outside any scope" list ships, Liberuum's two left-over breakdowns deleted).

## Global Constraints

- No document-model change.
- No change to `pieces/knowledge-vault/templates/pipeline.json` or `reweave.json`. The template's stale description (`pipeline.json:73`) waits for the next template change made for another reason (spec §8).
- User-facing copy is the spec's, verbatim, in plain words and sentence case.
- Toolchain: bun locally (`bunx vitest run …`, `bun run tsc`, `bun run lint` in the vault repo; `bun run check` and `bun run test` in the app), and no Bun APIs in shipped code.
- A subgraph or processor change reaches a running engine only after `bun run build`, a release, and an engine restart.
- The app's host and sidecar ship together, so a field the sidecar stops sending has no older reader.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (an implementer subagent may use its own model's name).
- Both checkouts may hold another session's uncommitted work: stage only the task's files; build and publish from a clean worktree.

## Review Focus

1. **An Update whose template edit the engine rejects halfway.** Nothing half-made is published, the workflow's id and runs remain, and the chip still offers Update. (Tasks 27–30: the edits and the publish go in two batches; a rejection sends `REVERT_TO_PUBLISHED`.)
2. **A failed run whose source was deleted, re-queued, or cut off by an app restart.** It stops showing, or reads "interrupted — it resumes on its own". It never sticks on screen with an empty queue, and an unreadable queue keeps failures visible rather than hiding them. (Tasks 32–35.)
3. **Changing a link's target, then cancelling, or picking a note already linked with the same kind.** Cancel changes nothing, and the picker leaves such notes out. A pasted id from another drive matches nothing. (Tasks 9–12.)
4. **Hiding a kind in the graph that holds the selected node, then finding a node of a hidden kind.** The selection clears, finding shows the kind again, and one toggle is one pass at 100,000 nodes. (Tasks 18–23.)
5. **Deleting a scope whose breakdown holds recorded work, unchecked, in a vault with no other scope.** The breakdowns are unlinked and listed under "Work breakdowns outside any scope", and the dialog said what would stay. (Tasks 13–17.)

## Order and shared files

- Tasks run in number order. Shared files are sequenced:
  - `editors/source-editor/editor.tsx`: Tasks 1 → 2.
  - `DriveExplorer.tsx`: Task 23 (graph state), then Task 24 (guide lists).
  - The app's `sidecar/src/pipelines.ts`: Tasks 27–30 (Update), then 32 (status), then 38 (a comment, found by its text).
  - `PipelineChip.tsx`: Task 31 (button), then 33 (tooltip).
- **Test fake:** Task 27 replaces `fakeEngine` in `sidecar/src/pipelines.test.ts`. Task 32 was drafted against the old fake: add its run-page and queue answers to the new one, and leave its assertions unchanged.
- **Draft labels:** each part was drafted separately, and its notes and cross-references use its own labels (e.g. "F2", "F7d"). The table at the end maps them to task numbers.

## Decisions made while planning (each to be confirmed in review)

1. **Update publishes in a second batch.** The engine applies the rest of a batch after a rejected operation, so the spec's single batch could publish a broken draft. (Part 2.)
2. **`workflowStatus()` returns "gone" only for the engine's not-found or deleted answers.** Any other error throws, so an engine hiccup never turns Update into a re-create that loses runs. (Part 2.)
3. **The model settings travel in the connection's replayed `SET_CONFIG`.** If writing them fails, the secret refs are restored before the new secrets are deleted. This corrects the spec's step 4. (Part 2.)
4. **The onboarding overview also shows an interrupted run's own message**, so it never says "failed" while the chip says "resumes on its own". To follow the spec literally, drop it from Task 34. (Part 1.)
5. **Singular forms** "1 source to go" and "1 source waiting". Failures with no waiting count read "Processing… · 1 failed". (Part 1.)
6. **The "queued" run state from 010e7bf counts as running.** "Processing: waiting its turn…" gives way to the spec's rows. (Part 1.)
7. **The 10-minute "nothing has started it" hint counts from the task's `createdAt`**, because the queue records no "queued at". (Part 3.)
8. **The graph legend lists exactly the spec's six link kinds.** The colour maps keep `CITES` and `DELIVERED_BY`, which the editor's graph never draws. (Part 7.)
9. **The guide shows `switchboard init --url <endpoint>` without appending `/graphql` again**, because `resolveReactorEndpoint()` already ends in it. (Part 4.)
10. **"Work breakdowns outside any scope" shows even when the vault has no scope**, which is Liberuum's case. (Part 6.)

## Part 3: Copy, wording and the guide source (§3, §8, §11)

# Part 3: copy (spec §3, §8, §11)

## Notes for the assembler

- **Line drift (all verified against current code).**
  - Source editor: the "Queued — run /pipeline…" span is `editor.tsx:403-407`; the `queued` flag is `:215`, set at `:322` and `:337`; `existingTask` is `:306-315`; `canQueue` is `:340`; `IngestForm` is `:938-1053`, its button label "Ingest Source" is `:1044`, the lede is `:947-960` region (`:956-961` in the JSX). These match the spec.
  - Desktop app: the "its 15 s queue check" comment is now `sidecar/src/main.ts:540` (spec said `:527`). The "15 s interval" comment is `sidecar/src/pipelines.ts:412`, inside the doc comment of `followTemplate()` (`:407-413`). The ChatGPT comment is `main.ts:297-301` (spec said `:296-300`).
  - Piece: trigger option `new-pipeline-task.ts:209` (spec `:203`); place-in-mocs description `:17`, handoffs `:53` and `:66`; verify.ts header `:12-16` (spec `:12-15`, the cited sentence is on `:15-16`).
- **Another part also edits `pipelines.ts`** (ensure()/status()). My only change there is a comment: **line 412**, the words `one made before the 15 s interval checks the queue every 60 s.` (inside the JSDoc above `async followTemplate()`). No code line moves, but if the other part adds/removes lines above it, re-find the line by that text.
- **Other parts that also touch files I touch.**
  - `editors/source-editor/editor.tsx`: F1 and F2 here both edit it (F2 depends on F1, which removes the `queued` flag). Any other part editing this file (the review list / failed work in §C, the Add sources work) must be sequenced with them.
  - `editors/pipeline-queue-editor/*`: spec says failed work and its retry button are C's. If C adds a retry button to `components/task-table.tsx` or counts in `editor.tsx`, F4 only removes the review group/tab/summary clause and the phase hint; it does not touch the failed group.
- **Spec vs. code.**
  - `PipelineTask.createdAt` is the "queued at" time; there is no separate queued timestamp. The 10-minute rule uses `createdAt`.
  - ADD_TASK sets `currentPhase` to the first phase of the queue's `phaseOrder` (or null when the queue has none), so "PENDING at create" is treated as `currentPhase` null or `"create"`.
  - The paste form's lede has no wording for a vault with no processing queue; the spec gives only the desktop and web variants, so both are shown whether or not a queue exists. The "Add source" button still only queues when a queue exists.
  - `isDesktopHost()` reads module state at call time, not a hook. The editor calls it at render, as the spec says; it is not reactive to a later host declaration (the host declares before import, so this is fine).
- **Decisions I made.**
  - The pure logic (open-task choice, status line, lede, the ingest-then-queue order) goes in a new `editors/source-editor/lib/queue-status.ts`, with a tiny component `components/queue-status-line.tsx`, so it is testable without mounting the editor (the editor has no component tests and needs Connect's toolbar).
  - The existing "queue it again" path (`handleQueueForProcessing`) now uses the same open-claim-task choice, so an old failed task can no longer hide a newer open one (and no duplicate is added).
  - Pieces, comment-only and sample-source copy are guarded by wording tests that read the source file (vitest, node `fs`); comment-only app changes (F6) have no behaviour to test and are verified by grep.
  - `templates/pipeline.json` is not touched (its stale description at `:73` waits for the next template change).
- **Only new vaults get the new guide text (§11).** No migration; existing vaults keep their copy.

---

### Task 1: The source editor shows the queue status from the source's own task (part 3, draft label F1)

**Files:** (repo: bai-knowledge-note)
- Create: `editors/source-editor/lib/queue-status.ts`
- Create: `editors/source-editor/lib/queue-status.test.ts`
- Create: `editors/source-editor/components/queue-status-line.tsx`
- Create: `editors/source-editor/components/queue-status-line.test.tsx`
- Modify: `editors/source-editor/editor.tsx` — imports (`:1-31`), `:215` (flag), `:305-315` (existing task), `:316-340` (queue handler, `canQueue`), `:403-407` (the span), plus a once-a-minute clock next to `:215`.

**Interfaces:**
- Consumes: `isDesktopHost(): boolean` from `editors/shared/host-config.ts:158` (import `../shared/host-config.js`); `PipelineTask` from `document-models/pipeline-queue`.
- Produces (in `lib/queue-status.ts`):
  - `export const STUCK_AFTER_MS = 600_000;`
  - `export type QueueTask = Pick<PipelineTask, "taskType" | "status" | "currentPhase" | "documentRef" | "createdAt" | "handoffs">;`
  - `export function openTaskFor<T extends QueueTask>(tasks: readonly T[], sourceId: string): T | undefined` — the newest (by `createdAt`) claim task for the source whose status is PENDING, IN_PROGRESS or BLOCKED.
  - `export function queueStatusLine(task: QueueTask | undefined, opts: { desktop: boolean; now: number }): string | null`
  - `components/queue-status-line.tsx`: `export function QueueStatusLine(props: { task: QueueTask | undefined; desktop: boolean; now: number })` renders `<span className="queued">…</span>` or `null`.

- [ ] **Step 1: write the failing tests**

`editors/source-editor/lib/queue-status.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { openTaskFor, queueStatusLine, STUCK_AFTER_MS, type QueueTask } from "./queue-status.js";

const T0 = Date.parse("2026-10-16T10:00:00Z");
const task = (extra: Partial<QueueTask> = {}): QueueTask => ({
  taskType: "claim", status: "PENDING", currentPhase: "create", documentRef: "s1",
  createdAt: "2026-10-16T10:00:00Z", handoffs: [], ...extra,
});
const handoff = { phase: "create" } as unknown as QueueTask["handoffs"][number];

describe("the open task for a source", () => {
  it("takes the newest open claim task, not the first or a failed one", () => {
    const failed = task({ status: "FAILED", createdAt: "2026-10-16T09:00:00Z" });
    const old = task({ status: "IN_PROGRESS", createdAt: "2026-10-16T09:30:00Z" });
    const fresh = task({ status: "PENDING", createdAt: "2026-10-16T09:45:00Z" });
    expect(openTaskFor([failed, old, fresh], "s1")).toBe(fresh);
    expect(openTaskFor([failed, fresh, old], "s1")).toBe(fresh);
  });
  it("ignores other sources, other task types, and finished tasks", () => {
    expect(openTaskFor([task({ documentRef: "s2" }), task({ taskType: "enrichment" }), task({ status: "DONE" }), task({ status: "FAILED" })], "s1")).toBeUndefined();
    expect(openTaskFor([], "s1")).toBeUndefined();
  });
  it("counts a blocked task as open", () => {
    const blocked = task({ status: "BLOCKED" });
    expect(openTaskFor([blocked], "s1")).toBe(blocked);
  });
});

describe("the status line", () => {
  const at = (ms: number) => ({ now: T0 + ms });
  it("says nothing without an open task", () => {
    expect(queueStatusLine(undefined, { desktop: true, ...at(0) })).toBeNull();
  });
  it("says a queued source is processed in the background on the desktop, and just queued on the web", () => {
    expect(queueStatusLine(task(), { desktop: true, ...at(1000) })).toBe("Queued — the app processes it in the background");
    expect(queueStatusLine(task(), { desktop: false, ...at(1000) })).toBe("Queued for processing");
    expect(queueStatusLine(task({ currentPhase: null }), { desktop: false, ...at(1000) })).toBe("Queued for processing");
  });
  it("on the web, says nothing has started it after 10 minutes with no handoff", () => {
    const stuck = "Queued for processing — nothing has started it yet. If this vault's server does not process sources, run /powerhouse-knowledge:pipeline in Claude Code.";
    expect(queueStatusLine(task(), { desktop: false, ...at(STUCK_AFTER_MS - 1) })).toBe("Queued for processing");
    expect(queueStatusLine(task(), { desktop: false, ...at(STUCK_AFTER_MS) })).toBe(stuck);
    expect(queueStatusLine(task(), { desktop: true, ...at(STUCK_AFTER_MS * 3) })).toBe("Queued — the app processes it in the background");
    expect(queueStatusLine(task({ handoffs: [handoff] }), { desktop: false, ...at(STUCK_AFTER_MS * 3) })).toBe("Queued for processing");
  });
  it("names the phase of a task that is working or past create", () => {
    const words: Record<string, string> = { create: "extracting notes", reflect: "connecting notes", reweave: "placing notes in topics", verify: "checking notes" };
    for (const [phase, w] of Object.entries(words)) {
      expect(queueStatusLine(task({ status: "IN_PROGRESS", currentPhase: phase }), { desktop: true, ...at(0) })).toBe(`Processing — ${w}`);
    }
    expect(queueStatusLine(task({ status: "PENDING", currentPhase: "reflect" }), { desktop: false, ...at(STUCK_AFTER_MS * 3) })).toBe("Processing — connecting notes");
    expect(queueStatusLine(task({ status: "IN_PROGRESS", currentPhase: null }), { desktop: true, ...at(0) })).toBe("Processing");
    expect(queueStatusLine(task({ status: "IN_PROGRESS", currentPhase: "enrich" }), { desktop: true, ...at(0) })).toBe("Processing");
  });
  it("points to the Processing queue when blocked, on both hosts", () => {
    for (const desktop of [true, false]) {
      expect(queueStatusLine(task({ status: "BLOCKED" }), { desktop, ...at(0) })).toBe("Processing is blocked — see Processing queue");
    }
  });
});
```

`editors/source-editor/components/queue-status-line.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { QueueTask } from "../lib/queue-status.js";
import { QueueStatusLine } from "./queue-status-line.js";

const task: QueueTask = { taskType: "claim", status: "IN_PROGRESS", currentPhase: "verify", documentRef: "s1", createdAt: "2026-10-16T10:00:00Z", handoffs: [] };

describe("the queue status line", () => {
  it("renders the line in the queued style", () => {
    expect(renderToStaticMarkup(<QueueStatusLine task={task} desktop now={0} />)).toBe('<span class="queued">Processing — checking notes</span>');
  });
  it("renders nothing without an open task", () => {
    expect(renderToStaticMarkup(<QueueStatusLine task={undefined} desktop={false} now={0} />)).toBe("");
  });
});
```

- [ ] **Step 2: run** — `bunx vitest run editors/source-editor` (from `bai-knowledge-note`).
  Expected: both new files fail with `Failed to resolve import "./queue-status.js"` (and `./queue-status-line.js`).

- [ ] **Step 3: implement**

Create `editors/source-editor/lib/queue-status.ts`:

```ts
import type { PipelineTask } from "document-models/pipeline-queue";

/**
 * What the source editor says about a source's place in the processing queue. Read from the queue's own task
 * (not a local flag), so it is right after a reload and for sources queued anywhere. Pure, so it is tested
 * without rendering the editor.
 */

/** On the web, a source still waiting at the first phase with no handoff this long after it was queued is called out. */
export const STUCK_AFTER_MS = 600_000;

export type QueueTask = Pick<PipelineTask, "taskType" | "status" | "currentPhase" | "documentRef" | "createdAt" | "handoffs">;

const OPEN = new Set<string>(["PENDING", "IN_PROGRESS", "BLOCKED"]);

const PHASE_WORDS: Record<string, string> = {
  create: "extracting notes",
  reflect: "connecting notes",
  reweave: "placing notes in topics",
  verify: "checking notes",
};

const queuedAt = (t: Pick<QueueTask, "createdAt">) => Date.parse(t.createdAt) || 0;

/** The source's newest open claim task (PENDING, IN_PROGRESS or BLOCKED); an old failed one never counts. */
export function openTaskFor<T extends QueueTask>(tasks: readonly T[], sourceId: string): T | undefined {
  let best: T | undefined;
  for (const t of tasks) {
    if (t.documentRef !== sourceId || t.taskType !== "claim" || !OPEN.has(t.status)) continue;
    if (!best || queuedAt(t) > queuedAt(best)) best = t;
  }
  return best;
}

/** The line under the source's actions, or null when nothing is open. */
export function queueStatusLine(task: QueueTask | undefined, opts: { desktop: boolean; now: number }): string | null {
  if (!task) return null;
  if (task.status === "BLOCKED") return "Processing is blocked — see Processing queue";
  const atCreate = !task.currentPhase || task.currentPhase === "create";
  if (task.status === "PENDING" && atCreate) {
    if (opts.desktop) return "Queued — the app processes it in the background";
    const stuck = task.handoffs.length === 0 && opts.now - queuedAt(task) >= STUCK_AFTER_MS;
    return stuck
      ? "Queued for processing — nothing has started it yet. If this vault's server does not process sources, run /powerhouse-knowledge:pipeline in Claude Code."
      : "Queued for processing";
  }
  const words = task.currentPhase ? PHASE_WORDS[task.currentPhase] : undefined;
  return words ? `Processing — ${words}` : "Processing";
}
```

Create `editors/source-editor/components/queue-status-line.tsx`:

```tsx
import { queueStatusLine, type QueueTask } from "../lib/queue-status.js";

/** The queue status under a source's actions; reuses the editor's "queued" style. */
export function QueueStatusLine(props: { task: QueueTask | undefined; desktop: boolean; now: number }) {
  const line = queueStatusLine(props.task, { desktop: props.desktop, now: props.now });
  return line ? <span className="queued">{line}</span> : null;
}
```

Modify `editors/source-editor/editor.tsx`:

1. After the line `import { SOURCE_REVISION_MODEL } from "./lib/revision-model.js";` add:
```tsx
import { isDesktopHost } from "../shared/host-config.js";
import { QueueStatusLine } from "./components/queue-status-line.js";
import { openTaskFor } from "./lib/queue-status.js";
```
2. Replace `  const [queued, setQueued] = useState(false);` (`:215`) with:
```tsx
  // Re-read once a minute so the web "nothing has started it yet" line appears without a reload.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
```
3. Replace the block `:305-315` (from `// Check if a pipeline task already exists for this source` through the closing `const hasActiveTask = … existingTask.status !== "FAILED";`) with:
```tsx
  // The source's newest open claim task, read from the queue the editor already loads
  const pipelineState = pipelineDoc?.state?.global;
  const openTask = openTaskFor(pipelineState?.tasks ?? [], document.header.id);
  const hasActiveTask = !!openTask;
```
4. In `handleQueueForProcessing`, delete the two `setQueued(true);` lines (`:322`, `:337`).
5. Replace `const canQueue = status === "INBOX" && !!pipelineDispatch && !queued;` with `const canQueue = status === "INBOX" && !!pipelineDispatch;` (queuing moves the status to EXTRACTING, which hides the button).
6. Replace the span block at `:403-407`:
```tsx
                {queued && (
                  <span className="queued">
                    Queued — run /pipeline in Claude Code
                  </span>
                )}
```
with:
```tsx
                <QueueStatusLine task={openTask} desktop={isDesktopHost()} now={now} />
```

- [ ] **Step 4: run** — `bunx vitest run editors/source-editor` → Expected: all pass. Then `bun run tsc 2>&1 | tail -20` → Expected: no errors (an unused `useEffect` is not an issue, it is already imported at `:1`).

- [ ] **Step 5: commit**
```
git add editors/source-editor/lib/queue-status.ts editors/source-editor/lib/queue-status.test.ts editors/source-editor/components/queue-status-line.tsx editors/source-editor/components/queue-status-line.test.tsx editors/source-editor/editor.tsx
git commit -m "feat(source): the status line reads the source's own queue task, on desktop and the web

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

---

### Task 2: The paste form's "Add source" also queues (part 3, draft label F2)

**Files:** (repo: bai-knowledge-note)
- Modify: `editors/source-editor/lib/queue-status.ts` (add two exports)
- Modify: `editors/source-editor/lib/queue-status.test.ts` (append tests)
- Modify: `editors/source-editor/editor.tsx` — the early return `:296-298`, `IngestForm` signature `:938-942`, lede `:956-961`, button `:1030-1045`.

Depends on F1 (same files; `queued` already removed).

**Interfaces:**
- Produces (in `lib/queue-status.ts`):
  - `export function pasteLede(desktop: boolean): string`
  - `export function ingestAndQueue(steps: { ingest: () => void; queue?: { addTask: () => void; markQueued: () => void } }): void` — runs `ingest`, then (when `queue` is given) `addTask`, then `markQueued`, in that order.
- Consumes: `pipelineDispatch`, `document.header.id` from `Editor`.

- [ ] **Step 1: write the failing tests** — append to `queue-status.test.ts` (and add `ingestAndQueue, pasteLede` to its import list):

```ts
describe("the paste form", () => {
  it("words the lede for the desktop and the web", () => {
    expect(pasteLede(true)).toBe("Paste the text. Once added, the app turns it into notes in the background.");
    expect(pasteLede(false)).toBe("Paste the text. Once added, it is queued to be turned into notes.");
  });
  it("adds the source first, then the queue task, then moves the source to extracting", () => {
    const log: string[] = [];
    ingestAndQueue({ ingest: () => log.push("ingest"), queue: { addTask: () => log.push("addTask"), markQueued: () => log.push("markQueued") } });
    expect(log).toEqual(["ingest", "addTask", "markQueued"]);
  });
  it("only adds the source when the vault has no processing queue", () => {
    const log: string[] = [];
    ingestAndQueue({ ingest: () => log.push("ingest") });
    expect(log).toEqual(["ingest"]);
  });
});
```

- [ ] **Step 2: run** — `bunx vitest run editors/source-editor/lib/queue-status.test.ts`. Expected: failures `pasteLede is not a function` / `ingestAndQueue is not a function`.

- [ ] **Step 3: implement**

Append to `lib/queue-status.ts`:

```ts
/** The paste form's lede, by host. */
export function pasteLede(desktop: boolean): string {
  return desktop
    ? "Paste the text. Once added, the app turns it into notes in the background."
    : "Paste the text. Once added, it is queued to be turned into notes.";
}

/** "Add source": the source is added, and when the vault has a processing queue it is queued in the same press. */
export function ingestAndQueue(steps: { ingest: () => void; queue?: { addTask: () => void; markQueued: () => void } }): void {
  steps.ingest();
  if (!steps.queue) return;
  steps.queue.addTask();
  steps.queue.markQueued();
}
```

In `editor.tsx`:

1. Extend the F1 import: `import { ingestAndQueue, openTaskFor, pasteLede } from "./lib/queue-status.js";`
2. Replace
```tsx
  if (!initialized) {
    return <IngestForm dispatch={dispatch} />;
  }
```
with
```tsx
  if (!initialized) {
    return (
      <IngestForm
        dispatch={dispatch}
        sourceId={document.header.id}
        pipelineDispatch={pipelineDispatch}
      />
    );
  }
```
3. Replace the `IngestForm` signature `:938-942`:
```tsx
function IngestForm({
  dispatch,
}: {
  dispatch: (action: ReturnType<typeof actions.ingestSource>) => void;
}) {
```
with
```tsx
function IngestForm({
  dispatch,
  sourceId,
  pipelineDispatch,
}: {
  dispatch: (
    action:
      | ReturnType<typeof actions.ingestSource>
      | ReturnType<typeof actions.setSourceStatus>,
  ) => void;
  sourceId: string | undefined;
  /** Present when the drive has a processing queue. */
  pipelineDispatch:
    | ((action: ReturnType<typeof pipelineActions.addTask>) => void)
    | undefined;
}) {
```
4. Replace the lede paragraph
```tsx
            <p className="lede">
              Paste raw content here — articles, notes, transcripts. The AI
              agent will extract atomic claims from it.
            </p>
```
with
```tsx
            <p className="lede">{pasteLede(isDesktopHost())}</p>
```
5. Replace the button's `onClick` and label (`:1030-1045`) with:
```tsx
              <button
                type="button"
                className="submit"
                disabled={!title.trim() || !content.trim()}
                onClick={() =>
                  ingestAndQueue({
                    ingest: () =>
                      dispatch(
                        actions.ingestSource({
                          title,
                          content,
                          sourceType: sourceType as "ARTICLE",
                          description: desc || undefined,
                          author: author || undefined,
                          url: url || undefined,
                          createdAt: ts(),
                        }),
                      ),
                    queue:
                      pipelineDispatch && sourceId
                        ? {
                            addTask: () =>
                              pipelineDispatch(
                                pipelineActions.addTask({
                                  id: generateId(),
                                  taskType: "claim",
                                  target: title,
                                  documentRef: sourceId,
                                  createdAt: ts(),
                                }),
                              ),
                            markQueued: () =>
                              dispatch(actions.setSourceStatus({ status: "EXTRACTING" })),
                          }
                        : undefined,
                  })
                }
              >
                Add source
              </button>
```

- [ ] **Step 4: run** — `bunx vitest run editors/source-editor` → Expected: pass. `bun run tsc 2>&1 | tail -20` → no errors. (`pipelineDispatch` from `usePipelineQueueDocumentById` accepts the `addTask` action; if tsc narrows its parameter type differently, change the prop type to `typeof pipelineDispatch`'s parameter via `Parameters<NonNullable<typeof pipelineDispatch>>[0]`.)

- [ ] **Step 5: commit**
```
git add editors/source-editor/lib/queue-status.ts editors/source-editor/lib/queue-status.test.ts editors/source-editor/editor.tsx
git commit -m "feat(source): pasting a source adds it and queues it in one press

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

---

### Task 3: Delete the unused PipelineView (part 3, draft label F3)

**Files:** (repo: bai-knowledge-note)
- Delete: `editors/knowledge-vault/components/PipelineView.tsx` (imported by nothing; verified by grep: its only other mention is the spec).

**Interfaces:** none.

- [ ] **Step 1: write the failing check** — there is no behaviour to test; the guard is that nothing imports it. Run:
  `grep -rn "PipelineView" editors pieces subgraphs processors --include=*.ts --include=*.tsx | grep -v "components/PipelineView.tsx"`
- [ ] **Step 2: run** — Expected: no output (nothing imports it). If anything prints, stop and report.
- [ ] **Step 3: implement** — `git rm editors/knowledge-vault/components/PipelineView.tsx`
- [ ] **Step 4: run** — `bun run tsc 2>&1 | tail -20` → Expected: no errors; `grep -rn "Use /seed to ingest" editors | head` → no output.
- [ ] **Step 5: commit**
```
git commit -m "chore: remove PipelineView, which nothing imports

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

---

### Task 4: The Processing queue no longer waits "for your review" (part 3, draft label F4)

**Files:** (repo: bai-knowledge-note)
- Modify: `editors/pipeline-queue-editor/lib/tasks.ts` — `TaskGroup` `:10`, `GROUP_LABEL` `:12-19`, `GROUP_RANK` `:21-22`, `groupOf` `:26-39`, `View`/`VIEW_LABEL` `:48-56`, `inView` `:58-73`, `countGroups` `:96-100`
- Modify: `editors/pipeline-queue-editor/editor.tsx` — `VIEWS` `:10`, `EMPTY` `:12-18`, `open`/`summary` `:35-41`
- Modify: `editors/pipeline-queue-editor/components/phase-flow.tsx` (all, `:1-43`)
- Modify: `editors/pipeline-queue-editor/styles.ts` — drop `:23` (`.is-human`) and `:66` (`.pq-status.is-review`)
- Modify tests: `lib/tasks.test.ts`, `components/components.test.tsx`

**Interfaces:**
- Produces: `TaskGroup = "blocked" | "working" | "queued" | "done" | "failed"`; `View = "open" | "problems" | "finished" | "all"`. Nothing outside `pipeline-queue-editor/` imports these (checked: only `verify-notes.ts` matches a grep for `"review"`, unrelated).

- [ ] **Step 1: write the failing tests**

In `lib/tasks.test.ts`, replace these expectations (leave all else as is):
- In "puts each task in the group…": 
```ts
    expect(QUEUE.map(groupOf)).toEqual(["queued", "working", "queued", "blocked", "done", "failed"]);
    expect(groupOf({ status: "IN_PROGRESS", currentPhase: "verify" })).toBe("working");
    expect(groupOf({ status: "PENDING", currentPhase: "verify" })).toBe("queued");
```
- In "counts groups…": `expect(countGroups(QUEUE)).toEqual({ blocked: 1, working: 1, queued: 2, done: 1, failed: 1 });`
- In "the views" test, delete the line `expect(ids("review")).toEqual(["r"]);` and add `expect(VIEW_LABEL).not.toHaveProperty("review");` (import `VIEW_LABEL` from `./tasks.js`).
- In "put what needs a person first…": rename to "put what is stuck first, then routine work by most recently touched", and set the expectation to
```ts
    expect(sortTasks([...QUEUE, later, tie, bad]).map((t) => t.id)).toEqual(["b", "w", "q2", "q", "r", "q3", "q4", "f", "d"]);
```
Also add `GROUP_LABEL` to the import and a test:
```ts
  it("has no review group or label", () => {
    expect(Object.keys(GROUP_LABEL)).toEqual(["blocked", "working", "queued", "done", "failed"]);
  });
```

In `components/components.test.tsx`:
- Phase strip test: replace the `is-human` line with
```ts
    expect(html).not.toMatch(/waits for you|is-human/);
    expect(html).toMatch(/<span class="pq-flow-hint">checks the notes<\/span>/);
```
and the test title becomes "shows open tasks per phase, what the last step does, and the selected one".
- Task table test: replace `expect(html).toMatch(/pq-status is-review">Waiting for review/);` with `expect(html).toMatch(/pq-status is-queued">Queued/);` and `expect(html).not.toMatch(/Waiting for review/);`.
- Empty-text test: change both occurrences of "No source is waiting for review." to "Nothing is queued." (it is just a pass-through string).

- [ ] **Step 2: run** — `bunx vitest run editors/pipeline-queue-editor`. Expected failures: `expected [ 'queued', 'working', 'review', …] to equal …`, `waits for you` still present, `GROUP_LABEL` keys include `review`.

- [ ] **Step 3: implement**

`lib/tasks.ts` — replace the doc block through `groupOf` (`:3-39`) with:

```ts
/**
 * How the pipeline queue editor reads a task: which group it belongs to,
 * whether it is still open, and the order that puts what is stuck first.
 * Pure, so the table's behaviour is tested without rendering it.
 */

export type TaskGroup = "blocked" | "working" | "queued" | "done" | "failed";

export const GROUP_LABEL: Record<TaskGroup, string> = {
  blocked: "Blocked",
  working: "Working",
  queued: "Queued",
  done: "Done",
  failed: "Failed",
};

/** Attention order: what is stuck, then routine work, then history. */
const GROUP_RANK: Record<TaskGroup, number> = { blocked: 0, working: 1, queued: 2, failed: 3, done: 4 };

export const DEFAULT_PHASES = ["create", "reflect", "reweave", "verify"];

export function groupOf(task: Pick<PipelineTask, "status" | "currentPhase">): TaskGroup {
  switch (task.status) {
    case "DONE":
      return "done";
    case "FAILED":
      return "failed";
    case "BLOCKED":
      return "blocked";
    default:
      return task.status === "IN_PROGRESS" ? "working" : "queued";
  }
}
```
Replace `View`, `VIEW_LABEL`, `inView` (`:48-73`) with:
```ts
export type View = "open" | "problems" | "finished" | "all";

export const VIEW_LABEL: Record<View, string> = {
  open: "Open",
  problems: "Blocked & failed",
  finished: "Finished",
  all: "All",
};

export function inView(task: Pick<PipelineTask, "status" | "currentPhase">, view: View): boolean {
  const g = groupOf(task);
  switch (view) {
    case "open":
      return isOpen(task);
    case "problems":
      return g === "blocked" || g === "failed";
    case "finished":
      return g === "done" || g === "failed";
    case "all":
      return true;
  }
}
```
In `sortTasks` change the doc comment to `/** What is stuck first; within a group, the most recently touched. Stable for equal keys. */`. In `countGroups` replace the initial object with `{ blocked: 0, working: 0, queued: 0, done: 0, failed: 0 }`.

`editor.tsx`: `const VIEWS: View[] = ["open", "problems", "finished", "all"];` ; delete the `review:` line from `EMPTY`; replace
```tsx
  const open = groups.review + groups.blocked + groups.working + groups.queued;
  const summary = [
    groups.review ? `${groups.review} waiting for your review` : null,
```
with
```tsx
  const open = groups.blocked + groups.working + groups.queued;
  const summary = [
```

`components/phase-flow.tsx`: replace the header comment's last two sentences so it reads: "…each with how many open tasks sit there. Clicking a phase filters the table to it; clicking it again clears the filter." Remove `const human = i === last;`, remove `${human ? " is-human" : ""}` from the className, and replace the hint span with
```tsx
              <span className="pq-flow-hint">{i === last ? "checks the notes" : i === 0 ? "queued sources" : " "}</span>
```
(if there is only one phase, `i === last` wins; unchanged ordering vs. before).

`styles.ts`: delete the line `.pq-editor .pq-flow-button.is-human:not(.is-empty) .pq-flow-count { color: var(--bai-accent); }` and the line `.pq-editor .pq-status.is-review { color: var(--bai-accent); }`.

- [ ] **Step 4: run** — `bunx vitest run editors/pipeline-queue-editor` → Expected: pass. `bun run tsc 2>&1 | tail -20` → no errors (a leftover `groups.review` or `"review"` view would fail here). `grep -rn "review" editors/pipeline-queue-editor | head` → no hits except none.

- [ ] **Step 5: commit**
```
git add editors/pipeline-queue-editor
git commit -m "fix(queue): a task at verify is working or queued, not waiting for review

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

---

### Task 5: The workflow piece stops saying verify waits for review (part 3, draft label F5)

**Files:** (repo: bai-knowledge-note) — NOT `pieces/knowledge-vault/templates/pipeline.json` or `reweave.json`.
- Create: `pieces/knowledge-vault/test/wording.test.ts`
- Modify: `pieces/knowledge-vault/lib/triggers/new-pipeline-task.ts:209`
- Modify: `pieces/knowledge-vault/lib/actions/place-in-mocs.ts:17`, `:53`, `:66`
- Modify: `pieces/knowledge-vault/lib/agent/verify.ts:15-16`

**Interfaces:** none. Handoffs already written stay as history.

- [ ] **Step 1: write the failing test** — `pieces/knowledge-vault/test/wording.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { knowledgeVault } from "../index.js";

const lib = (p: string) => readFileSync(new URL(`../lib/${p}`, import.meta.url), "utf8");

describe("what the pieces say about verify", () => {
  it("labels the trigger's verify phase by what it is", () => {
    const src = lib("triggers/new-pipeline-task.ts");
    expect(src).toContain('{ label: "verify: placed, to check", value: "verify" }');
    expect(src).not.toContain("verify: waiting for review");
  });
  it("describes the Place step as advancing to the next step", () => {
    const d = (knowledgeVault.actions()["place-in-mocs"] as unknown as { description: string }).description;
    expect(d).toContain("advances the pipeline task to verify, the next step.");
    expect(d).not.toMatch(/waits for your review/);
  });
  it("hands off to verify, not to review", () => {
    const src = lib("actions/place-in-mocs.ts");
    expect(src.match(/Next: verify\./g)).toHaveLength(2);
    expect(src).not.toContain("Ready for review.");
  });
  it("says verify approves nothing and its advance completes the task", () => {
    const src = lib("agent/verify.ts");
    expect(src).toContain("Nothing is approved: the notes stay in review for a person, and this step's advance completes the task.");
    expect(src).not.toContain("after review");
  });
});
```

- [ ] **Step 2: run** — `bunx vitest run pieces/knowledge-vault/test/wording.test.ts`. Expected: 4 failures, e.g. `expected '…' to contain 'verify: placed, to check'`.

- [ ] **Step 3: implement**
  - `new-pipeline-task.ts:209`: `{ label: "verify: waiting for review", value: "verify" },` → `{ label: "verify: placed, to check", value: "verify" },`
  - `place-in-mocs.ts:17`: `…advances the pipeline task to verify, where it waits for your review. Set the step's timeout to 300 s.` → `…advances the pipeline task to verify, the next step. Set the step's timeout to 300 s.`
  - `place-in-mocs.ts:53`: `…so there was nothing to place. Ready for review.` → `…so there was nothing to place. Next: verify.`
  - `place-in-mocs.ts:66`: `…new TOPIC MoC)` : ""}. Ready for review.\`` → `…new TOPIC MoC)` : ""}. Next: verify.\``
  - `verify.ts:15-16`: replace the two comment lines ` * duplicate is rejected back to DRAFT with a comment. Nothing is approved` / ` * and the task stays at verify, whose advance completes it after review.` with
```
 * duplicate is rejected back to DRAFT with a comment. Nothing is approved: the
 * notes stay in review for a person, and this step's advance completes the task.
```

- [ ] **Step 4: run** — `bunx vitest run pieces/knowledge-vault` → Expected: pass (tests that assert the old "Ready for review." text do not exist: grep found none). `bun run tsc 2>&1 | tail -20` → no errors. `git diff --stat pieces/knowledge-vault/templates` → empty.

- [ ] **Step 5: commit**
```
git add pieces/knowledge-vault/lib pieces/knowledge-vault/test/wording.test.ts
git commit -m "fix(pieces): verify is the next step, not a wait for review

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

---

## Part 5: Activity (§5)

# Part 5: Every Activity filter can match something (spec section 5)

## Notes for the assembler

- **Package ships with the processor change.** Tasks F5a and F5b change `summarize.ts`, `index.ts` and `query.ts`, which run in the Switchboard's processor and subgraph. They reach a running Switchboard only after `bun run build` and a restart of `ph vetra` / the Switchboard (`package.json` exports point at `dist/`). The final verification step of the whole plan must say so. Link rows start from that restart; there is no back-fill.
- **Spec drift, verified against current code.** Spec lines `:42`, `:62`, `:156-160`, `:322` match today's `ActivityView.tsx` (SET_STATUS at 42 and 62, filter at 156-160, short id at 322). The indexer `continue`s are at `index.ts:271-325` (ADD 276-304, REMOVE 305-314, UPDATE 317-325); the activity insert is at `index.ts:400-417`. The summarizer's SET_STATUS is `summarize.ts:32-33`. `activity()` sorts by timestamp at `query.ts:1040-1053`; `history()` is at `query.ts:1029-1038` (the spec said 1028-1037).
- **The spec's count line is wrong against today's code.** Today it reads "N operations (Label)". F5c changes it to "12 changes (Lifecycle) in the latest 200" when a filter is on, and keeps "N changes" with no filter. (Spec text only gives the filtered form; unfiltered stays plain, with "1 change" singular.)
- **Existing test breaks when SET_STATUS leaves the summarizer.** `editors/knowledge-vault/lib/chat/vault-tools.test.ts:973,993,994,1007` use `SET_STATUS` / "Status changed to CANONICAL" through the shared `summarizeOperation`. F5a moves that fixture to `SUBMIT_FOR_REVIEW` / "Submitted for review". Another part must not reuse that fixture.
- **Cross-part files.** `ActivityView.tsx` is edited only here (the spec lists the vault menu in part 3 but that only links to Activity). `summarize.ts` is imported by the chat (`vault-tools.ts:40`), so the new `summarizeLink` export is pure and browser-safe (no kysely).
- **Decisions I made.**
  1. The link title lookup is done in the processor (`index.ts`), not in `summarize.ts`, because `graph_nodes` needs the DB. `summarize.ts` gets a pure `summarizeLink(type, input, targetTitle)`.
  2. `UPDATE_RELATIONSHIP` and `REMOVE_RELATIONSHIP` run the DB title lookup before the edge is touched. For REMOVE the target node is a separate row from the edge, so order does not matter, but the lookup still happens before `continue`.
  3. The link row is written inside its own try/catch so a failed activity write never stops the edge write or the batch (same rule as the existing "non-critical" block).
  4. The link types print lowercased with spaces ("BUILDS_ON" -> "builds on"). A missing type prints "relates to" (the same default as `ADD_LINK`'s `RELATES_TO`).
  5. `history()` and `activity()` both tiebreak equal timestamps by `index` descending, so two ops in one batch are stable.
  6. The `Links` filter list is `ADD_RELATIONSHIP, REMOVE_RELATIONSHIP, UPDATE_RELATIONSHIP, ADD_LINK, REMOVE_LINK, UPDATE_LINK_TYPE`. Icons and colours are added for all six. `PATCH_CONTENT` gets the content colour and the icon "C+" (so it differs from SET_CONTENT).
  7. Row title and kind come from `useVaultDocIndex().byId` (`editors/shared/use-vault-doc-index.ts`, `VaultDocSummary { id, title, documentType, noteType }`). Kind shown is the plain word for the type: `bai/knowledge-note` -> "note", `bai/moc` -> "topic", `bai/source` -> "source", anything else the part after the slash. Falls back to the first 8 characters of the id.
  8. The document-scope row id is `<documentId>-document-<index>`; global rows keep `<documentId>-<index>` so nothing existing changes.
- **Does not touch** the document model, `pieces/knowledge-vault/templates/pipeline.json` or `reweave.json`.

---

### Task 6: Summaries: drop SET_STATUS, add the link phrases (part 5, draft label F5a)

**Files (repo: bai-knowledge-note):**
- Modify `processors/graph-indexer/summarize.ts` (lines 32-33 removed; new export after `summarizeOperation`, i.e. after line 137)
- Modify `editors/knowledge-vault/lib/chat/vault-tools.test.ts` (lines 973, 993-994, 1007)
- Test: create `tests/processor/summarize.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `summarizeLink(type: string, input: Record<string, unknown>, targetTitle: string | null): string | null` from `processors/graph-indexer/summarize.ts`. Returns the phrase for `ADD_RELATIONSHIP`, `REMOVE_RELATIONSHIP`, `UPDATE_RELATIONSHIP` and `null` for any other type. F5b consumes it. `summarizeOperation("SET_STATUS", ...)` now returns the type "SET_STATUS".

- [ ] Step 1: write the failing tests. Create `tests/processor/summarize.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  summarizeLink,
  summarizeOperation,
} from "../../processors/graph-indexer/summarize.js";

describe("summarizeLink", () => {
  it("says what was linked, with the target's title and the link's kind", () => {
    expect(
      summarizeLink(
        "ADD_RELATIONSHIP",
        { sourceId: "a", targetId: "b", relationshipType: "BUILDS_ON" },
        "Caching claim",
      ),
    ).toBe("Linked to “Caching claim” (builds on)");
  });

  it("defaults the kind to relates to", () => {
    expect(
      summarizeLink("ADD_RELATIONSHIP", { sourceId: "a", targetId: "b" }, "B"),
    ).toBe("Linked to “B” (relates to)");
  });

  it("says a link was removed or re-explained", () => {
    expect(
      summarizeLink("REMOVE_RELATIONSHIP", { sourceId: "a", targetId: "b" }, "B"),
    ).toBe("Removed the link to “B”");
    expect(
      summarizeLink("UPDATE_RELATIONSHIP", { sourceId: "a", targetId: "b" }, "B"),
    ).toBe("Changed why it links to “B”");
  });

  it("falls back to the target id when the target has no title", () => {
    expect(
      summarizeLink("REMOVE_RELATIONSHIP", { sourceId: "a", targetId: "doc-9" }, null),
    ).toBe("Removed the link to “doc-9”");
  });

  it("is null for anything that is not a link operation", () => {
    expect(summarizeLink("SET_TITLE", { title: "x" }, null)).toBeNull();
  });
});

describe("summarizeOperation", () => {
  it("no longer knows SET_STATUS, which no model defines", () => {
    expect(summarizeOperation("SET_STATUS", { status: "CANONICAL" })).toBe("SET_STATUS");
  });
});
```

Also edit `editors/knowledge-vault/lib/chat/vault-tools.test.ts` so it does not depend on the removed phrase. Find and replace exactly these:
  - line 973: `lastOp("SET_STATUS", { status: "CANONICAL" }, A, "switchboard"),` -> `lastOp("SUBMIT_FOR_REVIEW", {}, A, "switchboard"),`
  - line 1023: same replacement (`lastOp("SET_STATUS", { status: "CANONICAL" }, A, "switchboard"),`)
  - line 993: `change: "Status changed to CANONICAL",` -> `change: "Submitted for review",`
  - line 994: `action: "SET_STATUS",` -> `action: "SUBMIT_FOR_REVIEW",`
  - line 1007: `newest: liberuum.eth — Status changed to CANONICAL` -> `newest: liberuum.eth — Submitted for review`

- [ ] Step 2: run `bunx vitest run tests/processor/summarize.test.ts`. Expected: FAIL, `summarizeLink is not a function` (and the SET_STATUS case fails with `Status changed to CANONICAL`).

- [ ] Step 3: implement. In `processors/graph-indexer/summarize.ts` delete these lines (find them):

```ts
    case "SET_STATUS":
      return `Status changed to ${String(input.status)}`;
```

and add after the closing `}` of `summarizeOperation` (before `/** Safely stringify ...`):

```ts
/**
 * The phrase for a link operation. A link's target is a document id, so the
 * caller passes the target's title (from `graph_nodes`); with none known the
 * id stands in. Null for any other operation type, which keeps the caller's
 * own phrase.
 */
export function summarizeLink(
  type: string,
  input: Record<string, unknown>,
  targetTitle: string | null,
): string | null {
  const target = truncate(targetTitle ?? s(input.targetId));
  switch (type) {
    case "ADD_RELATIONSHIP": {
      const kind = s(input.relationshipType, "RELATES_TO")
        .replace(/_/g, " ")
        .toLowerCase();
      return `Linked to “${target}” (${kind})`;
    }
    case "REMOVE_RELATIONSHIP":
      return `Removed the link to “${target}”`;
    case "UPDATE_RELATIONSHIP":
      return `Changed why it links to “${target}”`;
    default:
      return null;
  }
}
```

- [ ] Step 4: run `bunx vitest run tests/processor/summarize.test.ts editors/knowledge-vault/lib/chat/vault-tools.test.ts`. Expected: all pass.

- [ ] Step 5: commit.
```
git add processors/graph-indexer/summarize.ts tests/processor/summarize.test.ts editors/knowledge-vault/lib/chat/vault-tools.test.ts
git commit -m "feat(activity): phrases for link changes; SET_STATUS leaves the summarizer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

---

### Task 7: The indexer records link changes as activity rows; history() sorts by time (part 5, draft label F5b)

**Files (repo: bai-knowledge-note):**
- Modify `processors/graph-indexer/index.ts`: import at line 18; the three relationship branches at lines 276-325; new private method after `applyRemoveRelationship` (ends line 706).
- Modify `processors/graph-indexer/query.ts`: `history()` at lines 1029-1038 and `activity()` at lines 1040-1053.
- Test: create `tests/processor/link-activity.test.ts` (follows `tests/processor/edge-metadata.test.ts:57-123` for the PGlite setup and the `relOp` helper).

**Interfaces:**
- Consumes: `summarizeLink` from F5a.
- Produces: `graph_operations` rows with `id = <sourceId>-document-<index>`, `scope = "document"`, `operation_type` one of the three, `summary` per F5a, `input_json` the action input. Readable through `knowledgeGraphActivity` and `history()`. F5c's "Links" filter relies on these operation types.
- **Needs `bun run build` and a Switchboard restart to take effect.**

- [ ] Step 1: write the failing test. Create `tests/processor/link-activity.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Kysely } from "kysely";
import { PGlite } from "@electric-sql/pglite";
import { PGliteDialect } from "kysely-pglite-dialect";
import type { IRelationalDb } from "@powerhousedao/shared/processors";
import type { OperationWithContext } from "@powerhousedao/shared/document-model";
import type { DB } from "../../processors/graph-indexer/schema.js";
import { up, down } from "../../processors/graph-indexer/migrations.js";
import { createGraphQuery } from "../../processors/graph-indexer/query.js";
import { GraphIndexerProcessor } from "../../processors/graph-indexer/index.js";

const T1 = "2026-09-02T10:00:00.000Z";
const T2 = "2026-09-02T11:00:00.000Z";
const T3 = "2026-09-02T12:00:00.000Z";

function relOp(
  index: number,
  type: "ADD_RELATIONSHIP" | "UPDATE_RELATIONSHIP" | "REMOVE_RELATIONSHIP",
  input: Record<string, unknown>,
  timestampUtcMs = T1,
): OperationWithContext {
  const sourceId = String(input.sourceId);
  return {
    operation: {
      index,
      skip: 0,
      hash: `h${index}`,
      timestampUtcMs,
      id: `${sourceId}-${index}`,
      action: { id: `act-${sourceId}-${index}`, type, scope: "document", timestampUtcMs, input },
    },
    context: {
      documentId: sourceId,
      documentType: "bai/knowledge-note",
      scope: "document",
      branch: "main",
      ordinal: index,
    },
  } as unknown as OperationWithContext;
}

function globalOp(index: number, documentId: string, title: string, timestampUtcMs: string): OperationWithContext {
  return {
    operation: {
      index,
      skip: 0,
      hash: `g${index}`,
      timestampUtcMs,
      id: `${documentId}-g${index}`,
      action: { id: `act-g-${index}`, type: "SET_TITLE", scope: "global", timestampUtcMs, input: { title } },
    },
    context: {
      documentId,
      documentType: "bai/knowledge-note",
      scope: "global",
      branch: "main",
      ordinal: 100 + index,
    },
  } as unknown as OperationWithContext;
}

describe("link changes are activity", () => {
  let db: Kysely<DB>;
  let query: ReturnType<typeof createGraphQuery>;
  let processor: GraphIndexerProcessor;

  beforeAll(async () => {
    const pglite = new PGlite();
    db = new Kysely<DB>({ dialect: new PGliteDialect(pglite) });
    await up(db as unknown as IRelationalDb<DB>);
    query = createGraphQuery(db);
    processor = new GraphIndexerProcessor(
      "link_activity_ns",
      { documentType: [], scope: [], branch: [], documentId: [] },
      db as unknown as IRelationalDb<DB>, undefined,
      { embed: false },
    );
  });

  afterAll(async () => {
    await down(db as unknown as IRelationalDb<DB>);
    await db.destroy();
  });

  beforeEach(async () => {
    await db.deleteFrom("graph_operations").execute();
    await db.deleteFrom("graph_edges").execute();
    await db.deleteFrom("graph_nodes").execute();
    for (const id of ["a", "b"]) {
      await db
        .insertInto("graph_nodes")
        .values({ id, document_id: id, title: `Note ${id}`, description: null, note_type: null, status: "CANONICAL", updated_at: T1, document_type: "bai/knowledge-note" })
        .execute();
    }
  });

  it("records add, update and remove on the note the link starts from", async () => {
    await processor.onOperations([
      relOp(0, "ADD_RELATIONSHIP", { sourceId: "a", targetId: "b", relationshipType: "BUILDS_ON", metadata: { reason: "r" } }, T1),
      relOp(1, "UPDATE_RELATIONSHIP", { sourceId: "a", targetId: "b", relationshipType: "BUILDS_ON", metadata: { reason: "r2" } }, T2),
      relOp(2, "REMOVE_RELATIONSHIP", { sourceId: "a", targetId: "b", relationshipType: "BUILDS_ON" }, T3),
    ]);
    const rows = await query.history("a");
    expect(rows.map((r) => [r.id, r.scope, r.operationType, r.summary])).toEqual([
      ["a-document-2", "document", "REMOVE_RELATIONSHIP", "Removed the link to “Note b”"],
      ["a-document-1", "document", "UPDATE_RELATIONSHIP", "Changed why it links to “Note b”"],
      ["a-document-0", "document", "ADD_RELATIONSHIP", "Linked to “Note b” (builds on)"],
    ]);
    expect(JSON.parse(rows[2].inputJson ?? "null")).toMatchObject({ targetId: "b" });
  });

  it("falls back to the target id when the target is not indexed", async () => {
    await processor.onOperations([
      relOp(0, "ADD_RELATIONSHIP", { sourceId: "a", targetId: "ghost", relationshipType: "RELATES_TO" }),
    ]);
    expect((await query.history("a"))[0].summary).toBe("Linked to “ghost” (relates to)");
  });

  it("does not collide with a global-scope operation of the same index", async () => {
    await processor.onOperations([
      globalOp(0, "a", "A title", T1),
      relOp(0, "ADD_RELATIONSHIP", { sourceId: "a", targetId: "b", relationshipType: "RELATES_TO" }, T2),
    ]);
    const ids = (await query.history("a")).map((r) => r.id).sort((x, y) => x.localeCompare(y));
    expect(ids).toEqual(["a-0", "a-document-0"]);
  });

  it("history interleaves the two scopes by time, newest first", async () => {
    await processor.onOperations([
      globalOp(0, "a", "first", T1),
      relOp(0, "ADD_RELATIONSHIP", { sourceId: "a", targetId: "b", relationshipType: "RELATES_TO" }, T2),
      globalOp(1, "a", "third", T3),
    ]);
    // Sorting by index alone would put the link (index 0) last and the
    // title change (index 1) before the first title change (index 0).
    expect((await query.history("a")).map((r) => r.id)).toEqual(["a-1", "a-document-0", "a-0"]);
  });

  it("still applies the edge, and an unrecordable row never blocks it", async () => {
    await processor.onOperations([
      relOp(0, "ADD_RELATIONSHIP", { sourceId: "a", targetId: "b", relationshipType: "RELATES_TO" }),
      relOp(0, "ADD_RELATIONSHIP", { sourceId: "a", targetId: "b", relationshipType: "RELATES_TO" }),
    ]);
    expect((await query.forwardLinks("a")).length).toBe(1);
    expect((await query.history("a")).length).toBe(1);
  });
});
```

- [ ] Step 2: run `bunx vitest run tests/processor/link-activity.test.ts`. Expected: FAIL, `expected [] to deeply equal [ [ 'a-document-2', ...` (no rows recorded) and the interleave test fails with only `a-1`, `a-0`.

- [ ] Step 3: implement.

(a) `processors/graph-indexer/index.ts` line 18: replace
`import { summarizeOperation } from "./summarize.js";`
with
`import { summarizeLink, summarizeOperation } from "./summarize.js";`

(b) In the three branches (anchors: `await this.applyAddRelationship(input);`, `await this.applyRemoveRelationship(input);`, `await this.applyUpdateRelationship(input, operation.timestampUtcMs);`), add a call straight after each, before the existing comment or `continue`:

```ts
        await this.applyAddRelationship(input);
        await this.recordLinkActivity(entry);
```
```ts
        await this.applyRemoveRelationship(input);
        await this.recordLinkActivity(entry);
```
```ts
        await this.applyUpdateRelationship(input, operation.timestampUtcMs);
        await this.recordLinkActivity(entry);
```
(`entry` is the loop variable `const entry of operations`, already in scope.)

(c) Add this method right after `applyRemoveRelationship` (after its closing `}` at line 706, before `async onDisconnect()`):

```ts
  /**
   * A link change is activity on the note the link starts from. The
   * reactor numbers `document`-scope operations separately from `global`
   * ones, so the row id carries the scope: `<documentId>-document-<index>`
   * cannot collide with the `<documentId>-<index>` of a global operation.
   * The target's title comes from `graph_nodes`; with none, the id stands
   * in. Non-critical like every other activity write: a failure here is
   * swallowed so it can never stop the edge itself.
   */
  private async recordLinkActivity(
    entry: OperationWithContext,
  ): Promise<void> {
    try {
      const { operation, context } = entry;
      const input = operation.action.input as Record<string, unknown>;
      const sourceId = typeof input.sourceId === "string" ? input.sourceId : "";
      const targetId = typeof input.targetId === "string" ? input.targetId : "";
      if (!sourceId || !targetId) return;
      const target = await this.relationalDb
        .selectFrom("graph_nodes")
        .select("title")
        .where("document_id", "=", targetId)
        .executeTakeFirst();
      const summary = summarizeLink(
        operation.action.type,
        input,
        target?.title ?? null,
      );
      const signer = operation.action.context?.signer as
        | {
            user?: { address?: string };
            app?: { name?: string; key?: string };
            signatures?: Array<string | string[]>;
          }
        | undefined;
      const lastSignature = signer?.signatures?.at(-1);
      const signature =
        lastSignature === undefined
          ? null
          : Array.isArray(lastSignature)
            ? lastSignature.join(", ")
            : lastSignature;
      await this.relationalDb
        .insertInto("graph_operations")
        .values({
          id: `${sourceId}-document-${operation.index}`,
          document_id: sourceId,
          operation_type: operation.action.type,
          timestamp: operation.timestampUtcMs ?? new Date().toISOString(),
          index: operation.index,
          scope: context.scope ?? "document",
          summary,
          input_json: JSON.stringify(input),
          signer_address: signer?.user?.address || null,
          signer_app: signer?.app?.name || null,
          signer_key: signer?.app?.key || null,
          signature,
        })
        .onConflict((oc) => oc.column("id").doNothing())
        .execute();
    } catch {
      // non-critical — the edge write has already happened
    }
  }
```
Note: the `document_id` is the link's source (`input.sourceId`), which equals `context.documentId` for these actions and is the id `isOurs` already gated on.

(d) `processors/graph-indexer/query.ts` `history()`, replace
```ts
        .where("document_id", "=", documentId)
        .orderBy("index", "desc")
```
with
```ts
        .where("document_id", "=", documentId)
        .orderBy("timestamp", "desc")
        .orderBy("index", "desc")
```
and in `activity()` replace
```ts
        .selectFrom("graph_operations")
        .orderBy("timestamp", "desc")
        .selectAll()
        .limit(limit);
```
with
```ts
        .selectFrom("graph_operations")
        .orderBy("timestamp", "desc")
        .orderBy("index", "desc")
        .selectAll()
        .limit(limit);
```

- [ ] Step 4: run `bunx vitest run tests/processor`. Expected: all pass (existing `indexed-kinds.test.ts` history assertions still hold; if one orders by index only against equal timestamps, the index tiebreak keeps it). Then `bun run tsc`. Expected: no errors.

- [ ] Step 5: commit.
```
git add processors/graph-indexer/index.ts processors/graph-indexer/query.ts tests/processor/link-activity.test.ts
git commit -m "feat(activity): the graph index records link changes; history sorts by time

Needs bun run build and a Switchboard restart to reach a running vault.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

---

### Task 8: Activity filters, titles and count line (part 5, draft label F5c)

**Files (repo: bai-knowledge-note):**
- Modify `editors/knowledge-vault/components/ActivityView.tsx`: `FILTER_TYPES` lines 29-51; `OP_ICONS` lines 53-70; `ActivityView` lines 118-280 (hook, count line at 217-220, row props at 267-273); `OperationRow` lines 286-359 (title at 322); `opColor` lines 365-383.
- Test: create `editors/knowledge-vault/components/ActivityView.test.tsx`.

**Interfaces:**
- Consumes: `useVaultDocIndex` from `editors/shared/use-vault-doc-index.ts` (`{ byId: Map<string, VaultDocSummary>, ... }`); F5b's operation types.
- Produces (exported for test): `FILTER_TYPES`, `OP_ICONS`, `filterCountLine(count: number, filter: FilterType): string`, `docKindLabel(documentType: string): string`, `ActivityRowLabel({ documentId, byId }): JSX.Element` (renders the title and kind line). `FilterType` type exported.

- [ ] Step 1: write the failing test. Create `editors/knowledge-vault/components/ActivityView.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ActivityRowLabel,
  docKindLabel,
  filterCountLine,
  FILTER_TYPES,
  OP_ICONS,
} from "./ActivityView.js";

describe("Activity filters", () => {
  it("lifecycle lists only operations a note model defines", () => {
    expect(FILTER_TYPES.lifecycle.ops).toEqual([
      "SUBMIT_FOR_REVIEW",
      "APPROVE_NOTE",
      "REJECT_NOTE",
      "ARCHIVE_NOTE",
      "RESTORE_NOTE",
    ]);
    expect(OP_ICONS.SET_STATUS).toBeUndefined();
  });

  it("content includes PATCH_CONTENT", () => {
    expect(FILTER_TYPES.content.ops).toContain("PATCH_CONTENT");
  });

  it("links covers the three link operations the indexer records, plus v1's three", () => {
    expect(FILTER_TYPES.links.ops).toEqual([
      "ADD_RELATIONSHIP",
      "REMOVE_RELATIONSHIP",
      "UPDATE_RELATIONSHIP",
      "ADD_LINK",
      "REMOVE_LINK",
      "UPDATE_LINK_TYPE",
    ]);
    for (const op of FILTER_TYPES.links.ops) expect(OP_ICONS[op]).toBeTruthy();
    expect(OP_ICONS.PATCH_CONTENT).toBeTruthy();
  });
});

describe("filterCountLine", () => {
  it("names the filter and the window it ran over", () => {
    expect(filterCountLine(12, "lifecycle")).toBe("12 changes (Lifecycle) in the latest 200");
    expect(filterCountLine(1, "links")).toBe("1 change (Links) in the latest 200");
    expect(filterCountLine(0, "content")).toBe("0 changes (Content) in the latest 200");
  });

  it("is plain with no filter", () => {
    expect(filterCountLine(200, "all")).toBe("200 changes");
    expect(filterCountLine(1, "all")).toBe("1 change");
  });
});

describe("row titles", () => {
  const byId = new Map([
    ["doc-1234567890", { id: "doc-1234567890", title: "Caching claim", documentType: "bai/knowledge-note", noteType: "claim" }],
    ["src-1", { id: "src-1", title: "Chapter 3", documentType: "bai/source", noteType: null }],
  ]);

  it("shows the document's title and kind", () => {
    const html = renderToStaticMarkup(<ActivityRowLabel documentId="doc-1234567890" byId={byId} />);
    expect(html).toContain("Caching claim");
    expect(html).toContain("note");
    expect(html).not.toContain("doc-1234");
  });

  it("names a source as a source", () => {
    expect(docKindLabel("bai/source")).toBe("source");
    expect(docKindLabel("bai/knowledge-note")).toBe("note");
    expect(docKindLabel("bai/moc")).toBe("topic");
    expect(docKindLabel("bai/tension")).toBe("tension");
  });

  it("falls back to the short id for a document the index does not know", () => {
    const html = renderToStaticMarkup(<ActivityRowLabel documentId="abcdef1234567890" byId={byId} />);
    expect(html).toContain("abcdef12");
    expect(html).not.toContain("abcdef1234567890");
  });
});
```

- [ ] Step 2: run `bunx vitest run editors/knowledge-vault/components/ActivityView.test.tsx`. Expected: FAIL, `ActivityRowLabel` / `filterCountLine` / `FILTER_TYPES` are not exported (`undefined is not a function` or `Cannot read properties of undefined`).

- [ ] Step 3: implement, in `editors/knowledge-vault/components/ActivityView.tsx`.

(a) Imports: after line 6 (`} from "@powerhousedao/reactor-browser";`) add
```ts
import {
  useVaultDocIndex,
  type VaultDocIndex,
} from "../../shared/use-vault-doc-index.js";
```

(b) Replace lines 27-70 (from `type FilterType = ...` through the closing `};` of `OP_ICONS`) with:

```ts
export type FilterType = "all" | "content" | "links" | "lifecycle" | "topics";

export const FILTER_TYPES: Record<FilterType, { label: string; ops: string[] }> = {
  all: { label: "All", ops: [] },
  content: {
    label: "Content",
    ops: [
      "SET_TITLE",
      "SET_DESCRIPTION",
      "SET_CONTENT",
      "PATCH_CONTENT",
      "SET_NOTE_TYPE",
    ],
  },
  links: {
    label: "Links",
    // The first three are what the graph index records today; the last three
    // are v1's, kept so older rows still match.
    ops: [
      "ADD_RELATIONSHIP",
      "REMOVE_RELATIONSHIP",
      "UPDATE_RELATIONSHIP",
      "ADD_LINK",
      "REMOVE_LINK",
      "UPDATE_LINK_TYPE",
    ],
  },
  lifecycle: {
    label: "Lifecycle",
    ops: [
      "SUBMIT_FOR_REVIEW",
      "APPROVE_NOTE",
      "REJECT_NOTE",
      "ARCHIVE_NOTE",
      "RESTORE_NOTE",
    ],
  },
  topics: { label: "Topics", ops: ["ADD_TOPIC", "REMOVE_TOPIC"] },
};

/** How many of the latest changes the view loads; the filter runs over these. */
const ACTIVITY_WINDOW = 200;

export const OP_ICONS: Record<string, string> = {
  SET_TITLE: "T",
  SET_DESCRIPTION: "D",
  SET_CONTENT: "C",
  PATCH_CONTENT: "C+",
  SET_NOTE_TYPE: "N",
  ADD_RELATIONSHIP: "+L",
  REMOVE_RELATIONSHIP: "-L",
  UPDATE_RELATIONSHIP: "~L",
  ADD_LINK: "+L",
  REMOVE_LINK: "-L",
  UPDATE_LINK_TYPE: "~L",
  ADD_TOPIC: "+#",
  REMOVE_TOPIC: "-#",
  SUBMIT_FOR_REVIEW: "R",
  APPROVE_NOTE: "A",
  REJECT_NOTE: "X",
  ARCHIVE_NOTE: "Z",
  RESTORE_NOTE: "U",
  SET_PROVENANCE: "P",
  SET_METADATA_FIELD: "M",
};

/** "12 changes (Lifecycle) in the latest 200" — the filter runs over the window, not the whole history. */
export function filterCountLine(count: number, filter: FilterType): string {
  const base = `${count} change${count === 1 ? "" : "s"}`;
  return filter === "all"
    ? base
    : `${base} (${FILTER_TYPES[filter].label}) in the latest ${ACTIVITY_WINDOW}`;
}

const KIND_LABELS: Record<string, string> = {
  "bai/knowledge-note": "note",
  "bai/moc": "topic",
  "bai/source": "source",
};

/** The plain word for a document type: `bai/tension` -> "tension". */
export function docKindLabel(documentType: string): string {
  return KIND_LABELS[documentType] ?? documentType.split("/").pop() ?? documentType;
}

/** The row's second line: the document's title and kind, or its short id when the index lacks it. */
export function ActivityRowLabel({
  documentId,
  byId,
}: {
  documentId: string;
  byId: VaultDocIndex["byId"];
}) {
  const doc = byId.get(documentId);
  return (
    <p
      className="truncate text-[10px]"
      style={{ color: "var(--bai-text-faint)" }}
    >
      {doc ? `${doc.title} · ${docKindLabel(doc.documentType)}` : documentId.slice(0, 8)}
    </p>
  );
}
```

(c) Replace the two `200` literals (lines 128 and 143) `fetchActivity(driveId, 200)` with `fetchActivity(driveId, ACTIVITY_WINDOW)`.

(d) In `ActivityView`, after line 123 (`const endpoint = useMemo(...)`) add:
```ts
  const { byId } = useVaultDocIndex();
```

(e) Replace the count line (lines 217-220):
```tsx
          <p className="text-xs" style={{ color: "var(--bai-text-muted)" }}>
            {filtered.length} operation{filtered.length !== 1 ? "s" : ""}
            {filter !== "all" ? ` (${FILTER_TYPES[filter].label})` : ""}
          </p>
```
with
```tsx
          <p className="text-xs" style={{ color: "var(--bai-text-muted)" }}>
            {filterCountLine(filtered.length, filter)}
          </p>
```

(f) Pass `byId` to rows: replace
```tsx
                <OperationRow
                  key={op.id}
                  op={op}
                  verdict={verdicts.get(op.id)}
                />
```
with
```tsx
                <OperationRow
                  key={op.id}
                  op={op}
                  byId={byId}
                  verdict={verdicts.get(op.id)}
                />
```
and the `OperationRow` signature:
```tsx
function OperationRow({
  op,
  byId,
  verdict,
}: {
  op: OperationRecord;
  byId: VaultDocIndex["byId"];
  verdict: VerificationResult | undefined;
}) {
```

(g) Replace the short-id paragraph (lines 318-323)
```tsx
        <p
          className="truncate text-[10px]"
          style={{ color: "var(--bai-text-faint)" }}
        >
          {op.documentId.slice(0, 8)}...
        </p>
```
with
```tsx
        <ActivityRowLabel documentId={op.documentId} byId={byId} />
```

(h) In `opColor`, replace the relationship test (lines 368-372)
```ts
  if (
    type === "ADD_RELATIONSHIP" ||
    type === "REMOVE_RELATIONSHIP"
  )
    return "#3b82f6";
```
with
```ts
  if (
    type.endsWith("_RELATIONSHIP") ||
    type === "ADD_LINK" ||
    type === "REMOVE_LINK" ||
    type === "UPDATE_LINK_TYPE"
  )
    return "#3b82f6";
```
and the first test (line 366) to include the patch:
```ts
  if (
    type.startsWith("SET_TITLE") ||
    type.startsWith("SET_CONTENT") ||
    type === "PATCH_CONTENT"
  )
    return "#f59e0b";
```
(replace the existing two-line `if (type.startsWith("SET_TITLE") || ...) return "#f59e0b";`).

- [ ] Step 4: run `bunx vitest run editors/knowledge-vault/components/ActivityView.test.tsx`. Expected: all pass. Then `bun run tsc` and `bun run lint:fix`. Expected: clean. If `useVaultDocIndex` import pulls a hook that needs the reactor provider only when called (the test never renders `ActivityView`, only the pure exports), no mock is needed.

- [ ] Step 5: commit.
```
git add editors/knowledge-vault/components/ActivityView.tsx editors/knowledge-vault/components/ActivityView.test.tsx
git commit -m "feat(activity): filters that can match, document titles on rows, and an honest count line

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Manual check after `bun run build` and a Switchboard restart:** add a link on a note, open Activity, choose Links: the row "Linked to “<title>” (builds on)" appears under the note's title; Lifecycle shows only the five real operations; a filter shows "N changes (Links) in the latest 200".

---

## Part 6: Links and scope deletion (§6, §7)

# Part 6 — §6 "A link always has a real target and a reason" and §7 "Deleting a scope of work leaves nothing pointing at it"

All tasks are in the **bai-knowledge-note** repo (branch `ui-upgrade`). Run every command from
`/home/beast/Documents/Powerhouse/bai-knowledge-note`.

## Notes for the assembler

- **Spec line references checked against the current code.** §6 is accurate: `links-section.tsx` manual entry at
  `:514`, its fields at `:551`/`:559`, `onAdd(manualId…)` at `:489`, the add guard at `:493-496`, change-target at
  `:173-185`, and `_targetTitle` at `editor.tsx:507`. The one that moved is the type-change dispatch: it is now at
  `editor.tsx:582-624`, not `:574-616`. §7 is accurate: the dialog `ScopeOfWorkView.tsx:306-321`, body `:141-158`,
  design note `:23-25`, chat card `work-changes.ts:1178-1187`, WBS schema `:27-30` and `:129-133`.
- **`SET_SOW_PROJECT_REF` checked.** The input is `SetSowProjectRefInput { sowRef: PHID, sowProjectId: OID }`. Both
  fields are optional, and the schema says "omit or null both to unlink"
  (`document-models/work-breakdown-structure/v1/schema.graphql:129-133`). The reducer sets each field to
  `input.x || null` (`v1/src/reducers/documentation.ts:38-43`). The chat refuses one field without the other
  (`work-changes.ts:666-667`), and the action is already in `NULL_MEANS_CLEAR` (`:398`). The unlink
  `{ sowRef: null, sowProjectId: null }` passes all three. No model change is needed.
- **Liberuum's two left-over breakdowns.** Read-only check on 2026-10-16 against `http://127.0.0.1:4201/graphql`,
  drive `t2lgNDhnAWzjVppfZ72J0d0NoBbFeEpj4f7KCIS0_iM`. The drive holds no `powerhouse/scopeofwork` document, and two
  `bai/wbs` documents, both in folder `361b7825-…`:
  - `-tZbkHi4jYuXcBnfXOzcqWstL6h52wrd5aDB5D7QjuE` "Knowledge Vault Go-to-Market Strategy — Work Breakdown":
    6 goals, all TODO, 0 notes. `sowRef` `G627G3NvPVnGWvlo5tq2duSRuSDuNyqOTUA3IY5cMEA`.
  - `DAhp7HCOuRh3UcNVg0lkj-yUbuf8V08seC74na5whsU` "Knowledge Vault Go-to-Market Plan": 3 goals, all TODO, 0 notes.
    `sowRef` `MxcH8IiU6Ije7OdbImO-z8q0gnCEhMUvsa7uGONJPQE` ("Document not found").
  These match the spec. They are deleted in Task F10.
- **The first name holds an em dash ("—").** `namesIt` (`TypeToConfirmDialog.tsx`) folds only case and spaces, so
  the person must type the em dash or paste it. F10 tells the operator to copy the name from the dialog. I did not
  change `namesIt`. If the assembler wants "-" to match "—", that is a separate change to a shared component.
- **The spec's file list is missing a file.** `editors/knowledge-vault/lib/chat/vault-tools.ts` (`checkWorkProposal`,
  `:1057-1105`) also changes. It reads only the documents a proposal names, plus the scope of a breakdown being
  deleted. To write the unlink lines, the chat must also read every breakdown of a scope being deleted. That is Task
  F9.
- **The list must also show when there is no scope.** Liberuum has no scope of work, so Work › Scopes of work shows
  its empty state, "No scope of work yet". The "outside any scope" list is rendered after the empty state as well as
  after the cards. Otherwise Liberuum's two breakdowns would never appear.
- **Decisions I made:**
  1. `onAddLink` on `LinksSection` becomes `(targetDocumentId, linkType, articulation)`. The unused generated id and
     the unused title are dropped. A new prop `onChangeTarget(id, targetDocumentId, articulation)` is added.
  2. The link-type select moves to the top of the add form. The search list depends on it: sources for "Derived
     from", notes for every other kind.
  3. A selection stays when the link type changes afterwards. A pasted id may be any document, so a note chosen
     before switching to "Derived from" is still a valid target.
  4. "Change target" on a "Derived from" link also lists sources.
  5. Every row in the picker shows `"<title> · <kind>"`, as in the spec's example "Chapter 3 Hardware · source". The
     kind words are: `note`, `source`, `map` (MoC), `work breakdown`, `scope of work`. Any other type is shown
     without its `bai/` prefix, with spaces for dashes.
  6. A breakdown that some scope's project holds through `wbsRef` is left out of "outside any scope", even when its
     own `sowRef` is empty. Otherwise it would appear both inside a scope and outside every scope.
  7. The recorded-work line goes past the spec's single example. Goals are counted as "done" (COMPLETED),
     "in progress" (IN_PROGRESS, IN_REVIEW or BLOCKED) or "dropped" (WONT_DO), and notes are counted too. The line
     shows only while the checkbox is checked. Unchecked, the dialog says "They stay, outside any scope." (or "It
     stays…" for one breakdown).
  8. The checkbox label is the spec's string, "Also delete these work breakdowns", even when there is only one
     breakdown. The copy rules require verbatim strings. The assembler may want a singular form.
  9. The view unlinks with `mutateDocumentRemote` (`SET_SOW_PROJECT_REF`), the same path
     `scope-of-work/views/project/ExecutionSections.tsx:79-88` uses to link one. The chat unlinks through its
     derived `operation` lines.
  10. The chat never proposes deleting a breakdown on its own. If the same proposal deletes a breakdown by name, that
      breakdown gets no unlink line. A deleted breakdown also gets no `LINK_PROJECT_WBS` unlink on a scope that the
      same proposal deletes. Without that, the rehearsal would refuse "act on it before deleting it".
- **Files other parts also edit:** none of mine, as far as the spec's file list shows. `DriveExplorer.tsx` (§4/§10)
  is not touched here. `ScopeOfWorkView.tsx` is still imported by `DriveExplorer.tsx:59`, with an unchanged export.
  §5's Activity "Links" will see the retarget as one REMOVE plus one ADD in the same batch.
- **The two shipping steps are in the spec's Rollout.** F10 runs after the vault package with F6–F7 is in the
  desktop app: `bun run build`, a dev publish, then the app moves to that version.

---

### Task 9: Link targets — sources for "Derived from", and a pasted id from this drive (part 6, draft label F1)

**Files:**
- Create: `editors/knowledge-note-editor/lib/link-targets.ts` (bai-knowledge-note)
- Test: `editors/knowledge-note-editor/lib/link-targets.test.ts` (bai-knowledge-note)

**Interfaces:**
- Consumes: `VaultDocSummary` from `editors/shared/vault-doc-index-store.ts` (`{ id; title; documentType; noteType }`),
  `LinkType` from `document-models/knowledge-note`.
- Produces:
  - `type LinkCandidate = { id: string; title: string; kind: string }`
  - `documentKind(documentType: string): string`
  - `candidateLabel(c: LinkCandidate): string`, which gives `"<title> · <kind>"`
  - `linkCandidates(o: { linkType: LinkType; noteId: string; knowledgeDocs: readonly VaultDocSummary[]; byId: ReadonlyMap<string, VaultDocSummary>; exclude: ReadonlySet<string> }): LinkCandidate[]`
  - `pastedIdMatch(query: string, o: { noteId: string; byId: ReadonlyMap<string, VaultDocSummary>; exclude: ReadonlySet<string> }): LinkCandidate | null`
  - `searchCandidates(query: string, candidates: readonly LinkCandidate[], pasted: LinkCandidate | null, limit?: number): LinkCandidate[]`
  - `linkedTargets(links: readonly { targetDocumentId: string | null; linkType: string | null }[], kind?: string): Set<string>`

- [ ] Step 1: write the failing test, `editors/knowledge-note-editor/lib/link-targets.test.ts`:

```ts
/**
 * Where a link may point: a document of this vault, chosen from a list —
 * sources for "Derived from", notes otherwise — or a pasted id that names any
 * document in the drive. Never the note itself.
 */
import { describe, expect, it } from "vitest";
import type { VaultDocSummary } from "../../shared/vault-doc-index-store.js";
import {
  candidateLabel,
  documentKind,
  linkCandidates,
  linkedTargets,
  pastedIdMatch,
  searchCandidates,
  type LinkCandidate,
} from "./link-targets.js";

const NOTE = "bai/knowledge-note";
const doc = (id: string, title: string, documentType: string): VaultDocSummary => ({ id, title, documentType, noteType: null });
const docs = [
  doc("note-1", "This note", NOTE),
  doc("note-2", "Chips are scarce", NOTE),
  doc("moc-1", "Hardware map", "bai/moc"),
  doc("src-3", "Chapter 3 Hardware", "bai/source"),
  doc("src-4", "Chapter 4 Memory", "bai/source"),
];
const byId = new Map(docs.map((d) => [d.id, d] as const));
const knowledgeDocs = docs.filter((d) => d.documentType === NOTE || d.documentType === "bai/moc");
const none: ReadonlySet<string> = new Set();
const base = { noteId: "note-1", knowledgeDocs, byId, exclude: none };

describe("where a link may point", () => {
  it("offers notes for every kind but Derived from — never the note itself", () => {
    expect(linkCandidates({ ...base, linkType: "RELATES_TO" }).map((c) => c.id)).toEqual(["note-2"]);
    expect(linkCandidates({ ...base, linkType: "BUILDS_ON" }).map((c) => c.id)).toEqual(["note-2"]);
  });

  it("offers the vault's sources for Derived from", () => {
    expect(linkCandidates({ ...base, linkType: "DERIVED_FROM" })).toEqual([
      { id: "src-3", title: "Chapter 3 Hardware", kind: "source" },
      { id: "src-4", title: "Chapter 4 Memory", kind: "source" },
    ]);
  });

  it("leaves out what is excluded", () => {
    expect(linkCandidates({ ...base, linkType: "DERIVED_FROM", exclude: new Set(["src-3"]) }).map((c) => c.id)).toEqual(["src-4"]);
  });
});

describe("a pasted id", () => {
  it("matches any document in this drive, named with its kind", () => {
    const m = pastedIdMatch("  src-3 ", { noteId: "note-1", byId, exclude: none });
    expect(m && candidateLabel(m)).toBe("Chapter 3 Hardware · source");
    expect(pastedIdMatch("moc-1", { noteId: "note-1", byId, exclude: none })).toEqual({ id: "moc-1", title: "Hardware map", kind: "map" });
  });

  it("matches nothing for an id outside the drive, the note itself, an excluded one, or nothing typed", () => {
    expect(pastedIdMatch("phd-elsewhere", { noteId: "note-1", byId, exclude: none })).toBeNull();
    expect(pastedIdMatch("note-1", { noteId: "note-1", byId, exclude: none })).toBeNull();
    expect(pastedIdMatch("src-3", { noteId: "note-1", byId, exclude: new Set(["src-3"]) })).toBeNull();
    expect(pastedIdMatch("   ", { noteId: "note-1", byId, exclude: none })).toBeNull();
  });
});

describe("the search list", () => {
  const sources = linkCandidates({ ...base, linkType: "DERIVED_FROM" });

  it("puts the pasted match first, once — even a document of another kind", () => {
    const src = pastedIdMatch("src-4", { noteId: "note-1", byId, exclude: none });
    expect(searchCandidates("src-4", sources, src).map((c) => c.id)).toEqual(["src-4"]);
    const moc = pastedIdMatch("moc-1", { noteId: "note-1", byId, exclude: none });
    expect(searchCandidates("moc-1", sources, moc).map((c) => c.id)).toEqual(["moc-1"]);
  });

  it("matches the title or the id, case aside, and shows the first 20 with nothing typed", () => {
    expect(searchCandidates("MEMORY", sources, null).map((c) => c.id)).toEqual(["src-4"]);
    const many: LinkCandidate[] = Array.from({ length: 25 }, (_, i) => ({ id: `s${i}`, title: `S ${i}`, kind: "source" }));
    expect(searchCandidates("", many, null)).toHaveLength(20);
  });
});

describe("what a note already links to", () => {
  const links = [
    { targetDocumentId: "note-2", linkType: "BUILDS_ON" },
    { targetDocumentId: "src-3", linkType: "DERIVED_FROM" },
    { targetDocumentId: null, linkType: null },
    { targetDocumentId: "note-5", linkType: null },
  ];

  it("gives every target, or those of one kind — a link with no kind relates to", () => {
    expect([...linkedTargets(links)]).toEqual(["note-2", "src-3", "note-5"]);
    expect([...linkedTargets(links, "BUILDS_ON")]).toEqual(["note-2"]);
    expect([...linkedTargets(links, "RELATES_TO")]).toEqual(["note-5"]);
  });
});

describe("a document's kind, in words", () => {
  it("names the vault's kinds plainly", () => {
    expect(documentKind("bai/knowledge-note")).toBe("note");
    expect(documentKind("bai/source")).toBe("source");
    expect(documentKind("bai/moc")).toBe("map");
    expect(documentKind("bai/wbs")).toBe("work breakdown");
    expect(documentKind("powerhouse/scopeofwork")).toBe("scope of work");
    expect(documentKind("bai/research-claim")).toBe("research claim");
  });
});
```

- [ ] Step 2: run `bunx vitest run editors/knowledge-note-editor/lib/link-targets.test.ts`
  Expected: FAIL. The suite cannot load `./link-targets.js` (`Failed to resolve import "./link-targets.js"` /
  `Cannot find module`).

- [ ] Step 3: implement, creating `editors/knowledge-note-editor/lib/link-targets.ts`:

```ts
/**
 * Where a manual link may point. Manual entry is gone: a target is always a
 * document of this vault — chosen from a list, or a pasted id that names one —
 * so no link is born with an empty or invented target (spec §6).
 *
 * "Derived from" lists the vault's sources (a note is drawn from a source);
 * every other kind lists notes. A pasted id may name a document of any kind,
 * and is offered first, as "Chapter 3 Hardware · source".
 */
import type { LinkType } from "document-models/knowledge-note";
import type { VaultDocSummary } from "../../shared/vault-doc-index-store.js";

export type LinkCandidate = { id: string; title: string; kind: string };

const NOTE_TYPE = "bai/knowledge-note";
const SOURCE_TYPE = "bai/source";

const KIND_WORDS: Record<string, string> = {
  [NOTE_TYPE]: "note",
  "bai/moc": "map",
  "bai/wbs": "work breakdown",
  "powerhouse/scopeofwork": "scope of work",
};

/** What a document is, in a word or two: "note", "source", "map", "work breakdown". */
export function documentKind(documentType: string): string {
  return KIND_WORDS[documentType] ?? documentType.replace(/^[^/]+\//, "").replace(/-/g, " ");
}

/** "Chapter 3 Hardware · source" — how a candidate reads in the picker. */
export const candidateLabel = (c: LinkCandidate): string => `${c.title} · ${c.kind}`;

const asCandidate = (d: VaultDocSummary): LinkCandidate => ({ id: d.id, title: d.title, kind: documentKind(d.documentType) });

/**
 * The documents a link of this kind may point at: sources for "Derived from",
 * notes for every other kind. Never the note itself, nor anything in `exclude`.
 */
export function linkCandidates(o: {
  linkType: LinkType;
  noteId: string;
  knowledgeDocs: readonly VaultDocSummary[];
  byId: ReadonlyMap<string, VaultDocSummary>;
  exclude: ReadonlySet<string>;
}): LinkCandidate[] {
  const pool =
    o.linkType === "DERIVED_FROM"
      ? [...o.byId.values()].filter((d) => d.documentType === SOURCE_TYPE)
      : o.knowledgeDocs.filter((d) => d.documentType === NOTE_TYPE);
  return pool.filter((d) => d.id !== o.noteId && !o.exclude.has(d.id)).map(asCandidate);
}

/** A pasted id that names a document in this drive — of any kind — or null. */
export function pastedIdMatch(
  query: string,
  o: { noteId: string; byId: ReadonlyMap<string, VaultDocSummary>; exclude: ReadonlySet<string> },
): LinkCandidate | null {
  const id = query.trim();
  if (!id || id === o.noteId || o.exclude.has(id)) return null;
  const d = o.byId.get(id);
  return d ? asCandidate(d) : null;
}

/** What the picker lists for a query: the pasted match first, then title or id matches — at most `limit`. */
export function searchCandidates(
  query: string,
  candidates: readonly LinkCandidate[],
  pasted: LinkCandidate | null,
  limit = 20,
): LinkCandidate[] {
  const q = query.trim().toLowerCase();
  const hits = q
    ? candidates.filter((c) => c.title.toLowerCase().includes(q) || c.id.toLowerCase().includes(q))
    : [...candidates];
  const rest = pasted ? hits.filter((c) => c.id !== pasted.id) : hits;
  return (pasted ? [pasted, ...rest] : rest).slice(0, limit);
}

/** The documents a note's links already point at — all of them, or those of one kind (no kind is "Relates to"). */
export function linkedTargets(
  links: readonly { targetDocumentId: string | null; linkType: string | null }[],
  kind?: string,
): Set<string> {
  return new Set(
    links.flatMap((l) =>
      l.targetDocumentId && (kind === undefined || (l.linkType ?? "RELATES_TO") === kind) ? [l.targetDocumentId] : [],
    ),
  );
}
```

- [ ] Step 4: run `bunx vitest run editors/knowledge-note-editor/lib/link-targets.test.ts`
  Expected: PASS (9 tests).

- [ ] Step 5: commit

```bash
git add editors/knowledge-note-editor/lib/link-targets.ts editors/knowledge-note-editor/lib/link-targets.test.ts
git commit -m "feat(note-links): link targets come from the vault — sources for Derived from, a pasted id from this drive

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

---

### Task 10: The link actions, with the editor's guard (part 6, draft label F2)

**Files:**
- Create: `editors/knowledge-note-editor/lib/link-actions.ts` (bai-knowledge-note)
- Test: `editors/knowledge-note-editor/lib/link-actions.test.ts` (bai-knowledge-note)

**Interfaces:**
- Consumes: `articulationToMetadata`, `LinkArticulation` from `editors/shared/edge-articulation.ts`; `LinkType`.
- Produces:
  - `type RelationshipAction = { id: string; type: "ADD_RELATIONSHIP" | "REMOVE_RELATIONSHIP"; scope: "document"; timestampUtcMs: string; input: { sourceId: string; targetId: string; relationshipType: string; metadata?: { reason?: string; confidence?: EdgeConfidence } } }`
  - `type LinkClock = { now: string; newId: () => string }`
  - `addLinkActions(noteId: string, targetId: string, linkType: LinkType, articulation: LinkArticulation, clock: LinkClock): RelationshipAction[]`
    returns `[]` when there is no target or the target is the note itself.
  - `retargetLinkActions(noteId: string, link: { targetDocumentId: string | null; linkType: string | null }, newTargetId: string, articulation: LinkArticulation, clock: LinkClock): RelationshipAction[]`
    returns `[REMOVE, ADD]`, or `[]` when the old or new target is missing, the new target is the note itself, or
    the new target is unchanged.

- [ ] Step 1: write the failing test, `editors/knowledge-note-editor/lib/link-actions.test.ts`:

```ts
/**
 * What the note editor sends for a link: one ADD_RELATIONSHIP with its reason,
 * or — for a new target — the REMOVE and the ADD in one batch. Nothing at all
 * without a target, or with the note itself as the target.
 */
import { describe, expect, it } from "vitest";
import { addLinkActions, retargetLinkActions } from "./link-actions.js";

const NOW = "2026-10-16T09:00:00.000Z";
const clock = () => {
  let n = 0;
  return { now: NOW, newId: () => `a${++n}` };
};
const WHY = { reason: "It names the chip the paper measures", confidence: "grounded" as const };
const META = { reason: WHY.reason, confidence: "grounded" };

describe("adding a link", () => {
  it("sends one ADD_RELATIONSHIP, with the reason as its metadata", () => {
    expect(addLinkActions("note-1", "src-3", "DERIVED_FROM", WHY, clock())).toEqual([
      {
        id: "a1",
        type: "ADD_RELATIONSHIP",
        scope: "document",
        timestampUtcMs: NOW,
        input: { sourceId: "note-1", targetId: "src-3", relationshipType: "DERIVED_FROM", metadata: META },
      },
    ]);
  });

  it("sends nothing without a target, or to the note itself", () => {
    expect(addLinkActions("note-1", "", "RELATES_TO", WHY, clock())).toEqual([]);
    expect(addLinkActions("note-1", "   ", "RELATES_TO", WHY, clock())).toEqual([]);
    expect(addLinkActions("note-1", "note-1", "RELATES_TO", WHY, clock())).toEqual([]);
  });
});

describe("changing a link's target", () => {
  const link = { targetDocumentId: "note-2", linkType: "BUILDS_ON" };

  it("removes the old pair and adds the new one, with the reason, in one batch", () => {
    expect(retargetLinkActions("note-1", link, "note-3", WHY, clock())).toEqual([
      {
        id: "a1",
        type: "REMOVE_RELATIONSHIP",
        scope: "document",
        timestampUtcMs: NOW,
        input: { sourceId: "note-1", targetId: "note-2", relationshipType: "BUILDS_ON" },
      },
      {
        id: "a2",
        type: "ADD_RELATIONSHIP",
        scope: "document",
        timestampUtcMs: NOW,
        input: { sourceId: "note-1", targetId: "note-3", relationshipType: "BUILDS_ON", metadata: META },
      },
    ]);
  });

  it("reads a link with no kind as Relates to", () => {
    const acts = retargetLinkActions("note-1", { targetDocumentId: "note-2", linkType: null }, "note-3", WHY, clock());
    expect(acts.map((a) => a.input.relationshipType)).toEqual(["RELATES_TO", "RELATES_TO"]);
  });

  it("changes nothing when the new target is missing, the note itself, or the same one — or the link has none", () => {
    expect(retargetLinkActions("note-1", link, "", WHY, clock())).toEqual([]);
    expect(retargetLinkActions("note-1", link, "note-1", WHY, clock())).toEqual([]);
    expect(retargetLinkActions("note-1", link, "note-2", WHY, clock())).toEqual([]);
    expect(retargetLinkActions("note-1", { targetDocumentId: null, linkType: "BUILDS_ON" }, "note-3", WHY, clock())).toEqual([]);
  });
});
```

- [ ] Step 2: run `bunx vitest run editors/knowledge-note-editor/lib/link-actions.test.ts`
  Expected: FAIL. The suite cannot load `./link-actions.js` (module not found).

- [ ] Step 3: implement, creating `editors/knowledge-note-editor/lib/link-actions.ts`:

```ts
/**
 * The reactor system actions behind the note editor's links. A relationship
 * is (source, target, type): ADD_RELATIONSHIP carries the articulation as its
 * `metadata`, and a new target is REMOVE + ADD in one dispatch — as a type
 * change is — so the edge never exists without its reason.
 *
 * The guard lives here: nothing is sent without a target, or with the note
 * itself as the target (spec §6).
 */
import type { LinkType } from "document-models/knowledge-note";
import {
  articulationToMetadata,
  type EdgeConfidence,
  type LinkArticulation,
} from "../../shared/edge-articulation.js";

export type RelationshipAction = {
  id: string;
  type: "ADD_RELATIONSHIP" | "REMOVE_RELATIONSHIP";
  scope: "document";
  timestampUtcMs: string;
  input: {
    sourceId: string;
    targetId: string;
    relationshipType: string;
    metadata?: { reason?: string; confidence?: EdgeConfidence };
  };
};

/** When the actions are stamped, and how their ids are made. */
export type LinkClock = { now: string; newId: () => string };

/** One ADD_RELATIONSHIP — or nothing, without a target or to the note itself. */
export function addLinkActions(
  noteId: string,
  targetId: string,
  linkType: LinkType,
  articulation: LinkArticulation,
  clock: LinkClock,
): RelationshipAction[] {
  const target = targetId.trim();
  if (!target || target === noteId) return [];
  const metadata = articulationToMetadata(articulation);
  return [
    {
      id: clock.newId(),
      type: "ADD_RELATIONSHIP",
      scope: "document",
      timestampUtcMs: clock.now,
      input: { sourceId: noteId, targetId: target, relationshipType: linkType, ...(metadata ? { metadata } : {}) },
    },
  ];
}

/** REMOVE the old pair and ADD the new one with the reason — or nothing, when there is nothing valid to change. */
export function retargetLinkActions(
  noteId: string,
  link: { targetDocumentId: string | null; linkType: string | null },
  newTargetId: string,
  articulation: LinkArticulation,
  clock: LinkClock,
): RelationshipAction[] {
  const old = link.targetDocumentId;
  const target = newTargetId.trim();
  if (!old || !target || target === noteId || target === old) return [];
  const linkType = (link.linkType ?? "RELATES_TO") as LinkType;
  const remove: RelationshipAction = {
    id: clock.newId(),
    type: "REMOVE_RELATIONSHIP",
    scope: "document",
    timestampUtcMs: clock.now,
    input: { sourceId: noteId, targetId: old, relationshipType: linkType },
  };
  return [remove, ...addLinkActions(noteId, target, linkType, articulation, clock)];
}
```

- [ ] Step 4: run `bunx vitest run editors/knowledge-note-editor/lib/link-actions.test.ts`
  Expected: PASS (5 tests).

- [ ] Step 5: commit

```bash
git add editors/knowledge-note-editor/lib/link-actions.ts editors/knowledge-note-editor/lib/link-actions.test.ts
git commit -m "feat(note-links): link actions guarded — no empty target, no self-link, retarget in one batch

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

---

### Task 11: Manual entry removed; Add waits for a vault document and a reason (part 6, draft label F3)

**Files:**
- Modify: `editors/knowledge-note-editor/components/links-section.tsx` (bai-knowledge-note), at imports `:1-13`,
  props `:28-42`, `DocOption` `:73`, `LinksSection` body `:110-142` and `:161-195`, `LinkCard` props and editing
  block `:209-268`, `AddLinkForm` `:462-627`, `DocumentSearch` `:629-722`
- Modify: `editors/knowledge-note-editor/editor.tsx` (bai-knowledge-note), imports `:1-36` and `onAddLink` `:504-534`
- Test: `editors/knowledge-note-editor/components/links-section.test.tsx` (bai-knowledge-note), new

**Interfaces:**
- Consumes: F1 (`linkCandidates`, `pastedIdMatch`, `searchCandidates`, `linkedTargets`, `candidateLabel`,
  `LinkCandidate`) and F2 (`addLinkActions`).
- Produces:
  - `LinksSectionProps.onAddLink: (targetDocumentId: string, linkType: LinkType, articulation: LinkArticulation) => void`
  - `export type TargetFinder = { candidates: (linkType: LinkType) => LinkCandidate[]; pasted: (query: string) => LinkCandidate | null }`
  - `export function AddLinkForm(props: { targets: TargetFinder; onAdd: (targetId: string, linkType: LinkType, articulation: LinkArticulation) => void; onCancel: () => void; initialSelected?: LinkCandidate | null })`

- [ ] Step 1: write the failing test, `editors/knowledge-note-editor/components/links-section.test.tsx`:

```tsx
/**
 * The add-link form: no manual entry — a target is a document of this vault,
 * chosen from a list or by a pasted id — and Add stays asleep until there is
 * a target and a reason.
 */
import "../../shared/test/browser-globals.js";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AddLinkForm, type TargetFinder } from "./links-section.js";
import type { LinkCandidate } from "../lib/link-targets.js";

const noop = () => {};
const SOURCE: LinkCandidate = { id: "src-3", title: "Chapter 3 Hardware", kind: "source" };
const targets: TargetFinder = { candidates: () => [SOURCE], pasted: () => null };
const form = (selected: LinkCandidate | null = null) =>
  renderToStaticMarkup(<AddLinkForm targets={targets} onAdd={noop} onCancel={noop} initialSelected={selected} />);
const addButton = (html: string) => /<button[^>]*>Add<\/button>/.exec(html)?.[0] ?? "";

describe("adding a link", () => {
  it("has no manual entry: the target is chosen from the vault", () => {
    const html = form();
    expect(html).not.toContain("Manual entry");
    expect(html).not.toContain("Document PHID");
    expect(html).not.toContain("Link title");
    expect(html).toContain("Search notes by title, or paste an id");
    expect(html).toContain("Chapter 3 Hardware · source");
  });

  it("keeps Add disabled until a document is chosen and a reason is written", () => {
    expect(addButton(form())).toContain('disabled=""');
    const chosen = form(SOURCE);
    expect(chosen).toContain("Chapter 3 Hardware · source");
    expect(addButton(chosen)).toContain('disabled=""');
    expect(addButton(chosen)).toContain("Say why this link exists first");
  });
});
```

- [ ] Step 2: run `bunx vitest run editors/knowledge-note-editor/components/links-section.test.tsx`
  Expected: FAIL. `AddLinkForm` is not exported (`AddLinkForm is not a function` / `Element type is invalid`), and
  `TargetFinder` does not exist.

- [ ] Step 3: implement.

  **3a. `links-section.tsx` imports.** Replace lines 1-13 (from `import { useState, useMemo, useRef, useEffect } from "react";`
  through the closing `} from "../../shared/edge-articulation.js";`) with:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEventCallback } from "../../shared/use-event-callback.js";
import { setSelectedNode } from "@powerhousedao/reactor-browser";
import { useVaultDocIndex } from "../../shared/use-vault-doc-index.js";
import type { LinkType } from "document-models/knowledge-note";
import {
  CONFIDENCE_LABELS,
  EDGE_CONFIDENCE_LEVELS,
  isEdgeConfidence,
  type EdgeConfidence,
  type LinkArticulation,
} from "../../shared/edge-articulation.js";
import {
  candidateLabel,
  linkCandidates,
  linkedTargets,
  pastedIdMatch,
  searchCandidates,
  type LinkCandidate,
} from "../lib/link-targets.js";
```

  (`generateId` is no longer used here: the editor makes ids in `addLinkActions`.)

  **3b. Props.** Replace the `onAddLink` member of `LinksSectionProps` (lines 31-37):

```tsx
  onAddLink: (
    id: string,
    targetDocumentId: string,
    targetTitle: string,
    linkType: LinkType,
    articulation: LinkArticulation,
  ) => void;
```

  with:

```tsx
  /** Add a link: a document of this vault, the kind of link, and why it exists. */
  onAddLink: (
    targetDocumentId: string,
    linkType: LinkType,
    articulation: LinkArticulation,
  ) => void;
```

  **3c. The finder type.** Replace line 73, `type DocOption = { id: string; title: string };`, with:

```tsx
/** Where a link may point: the vault's documents for a kind of link, and a pasted id. */
export type TargetFinder = {
  candidates: (linkType: LinkType) => LinkCandidate[];
  pasted: (query: string) => LinkCandidate | null;
};

const kindOf = (link: LinkRow): LinkType => (link.linkType ?? "RELATES_TO") as LinkType;
```

  **3d. `LinksSection` body.** Replace lines 110-142, from `const [isAdding, setIsAdding] = useState(false);` through
  the end of `function handleAdd(…) { … }`, with:

```tsx
  const [isAdding, setIsAdding] = useState(false);
  const [editingLinkId, setEditingLinkId] = useState<string | null>(null);

  // Picker candidates from the lightweight index (subgraph + drive
  // tree) — real titles, no full-state loads.
  const { knowledgeDocs, byId } = useVaultDocIndex();
  const finderFor = useCallback(
    (exclude: ReadonlySet<string>): TargetFinder => ({
      candidates: (linkType) =>
        linkCandidates({ linkType, noteId: currentDocId, knowledgeDocs, byId, exclude }),
      pasted: (query) => pastedIdMatch(query, { noteId: currentDocId, byId, exclude }),
    }),
    [currentDocId, knowledgeDocs, byId],
  );
  // A new link may not point where one already does.
  const addTargets = useMemo(() => finderFor(linkedTargets(links)), [finderFor, links]);

  function handleAdd(
    targetId: string,
    linkType: LinkType,
    articulation: LinkArticulation,
  ) {
    onAddLink(targetId, linkType, articulation);
    setIsAdding(false);
  }
```

  Replace the `links.map(…)` block and the `AddLinkForm` element (lines 161-195, from `{links.map((link) => (`
  through `onCancel={() => setIsAdding(false)}\n        />`) with:

```tsx
      {links.map((link) => (
        <LinkCard
          key={link.id}
          link={link}
          resolved={resolveTarget(link, byId)}
          isEditing={editingLinkId === link.id}
          // A new target may not be one this note already links to with the same kind.
          targets={finderFor(linkedTargets(links, kindOf(link)))}
          onStartEdit={() => setEditingLinkId(link.id)}
          onCancelEdit={() => setEditingLinkId(null)}
          onUpdateLinkType={onUpdateLinkType}
          onRemoveLink={onRemoveLink}
          onArticulate={onArticulate}
          onChangeTarget={(targetId) => {
            // Interim until F4: remove and re-add. F4 carries the reason across.
            onRemoveLink(link.id);
            onAddLink(targetId, kindOf(link), { reason: "", confidence: null });
            setEditingLinkId(null);
          }}
        />
      ))}

      {isAdding ? (
        <AddLinkForm
          targets={addTargets}
          onAdd={handleAdd}
          onCancel={() => setIsAdding(false)}
        />
```

  **3e. `LinkCard`.** In its props type (lines 220-232), replace `allDocOptions: DocOption[];` with
  `targets: TargetFinder;` and `onChangeTarget: (targetId: string, targetTitle: string) => void;` with
  `onChangeTarget: (targetId: string) => void;`. In its parameter list (lines 209-219), replace `allDocOptions,` with
  `targets,`. Replace the editing block (lines 251-268, from `if (isEditing) {` through its closing `}`) with:

```tsx
  if (isEditing) {
    const kind = kindOf(link);
    return (
      <div
        ref={editRef}
        className="rounded-lg border border-[var(--bai-accent)]/20 bg-[var(--bai-accent-soft)] p-2"
      >
        <p className="mb-1.5 text-[10px] font-medium uppercase text-[var(--bai-text-muted)]">
          Change target document
        </p>
        <DocumentSearch
          candidates={targets.candidates(kind)}
          pasted={targets.pasted}
          noun={kind === "DERIVED_FROM" ? "sources" : "notes"}
          onSelect={(doc) => onChangeTarget(doc.id)}
          onCancel={onCancelEdit}
          autoFocus
        />
      </div>
    );
  }
```

  **3f. `AddLinkForm`.** Replace the whole function (lines 462-627) with:

```tsx
/**
 * A new link: its kind, a document of this vault — from the list or a pasted
 * id — and the reason. Add wakes only with a document and a reason: the
 * articulation test, enforced where the edge is born. The agent's pre-write
 * hook holds the CLI to the same rule.
 */
export function AddLinkForm({
  targets,
  onAdd,
  onCancel,
  initialSelected = null,
}: {
  targets: TargetFinder;
  onAdd: (
    targetId: string,
    linkType: LinkType,
    articulation: LinkArticulation,
  ) => void;
  onCancel: () => void;
  /** A document already chosen — for tests, as TypeToConfirmPanel's `initialTyped`. */
  initialSelected?: LinkCandidate | null;
}) {
  const [linkType, setLinkType] = useState<LinkType>("RELATES_TO");
  const [selected, setSelected] = useState<LinkCandidate | null>(initialSelected);
  const [reason, setReason] = useState("");
  const [confidence, setConfidence] = useState<EdgeConfidence | null>(null);
  const candidates = useMemo(() => targets.candidates(linkType), [targets, linkType]);

  const hasReason = reason.trim().length > 0;
  const canAdd = selected !== null && hasReason;

  function handleSubmit() {
    if (!selected || !hasReason) return;
    onAdd(selected.id, linkType, { reason: reason.trim(), confidence });
  }

  return (
    <div className="space-y-2 rounded-lg border border-[var(--bai-accent)]/20 bg-[var(--bai-accent-soft)] p-3">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-[var(--bai-text-muted)]">This note</span>
        <select
          value={linkType}
          aria-label="Kind of link"
          onChange={(e) => setLinkType(e.target.value as LinkType)}
          className="rounded border border-[var(--bai-border)] bg-[var(--bai-deep)] px-2 py-1 text-sm text-[var(--bai-text-secondary)]"
        >
          {LINK_TYPES.map((lt) => (
            <option key={lt} value={lt}>
              {LINK_TYPE_LABELS[lt]}
            </option>
          ))}
        </select>
      </div>

      {selected ? (
        <div className="flex items-center gap-2 rounded border border-[var(--bai-border)] bg-[var(--bai-deep)] px-3 py-1.5">
          <span className="flex-1 truncate text-sm text-[var(--bai-text-secondary)]">
            {candidateLabel(selected)}
          </span>
          <span className="text-[10px] font-mono text-[var(--bai-text-tertiary)]">
            {selected.id.slice(0, 8)}
          </span>
          <button
            type="button"
            onClick={() => setSelected(null)}
            aria-label="Choose another document"
            className="text-[var(--bai-text-muted)] hover:text-[var(--bai-danger)]"
          >
            &times;
          </button>
        </div>
      ) : (
        <DocumentSearch
          candidates={candidates}
          pasted={targets.pasted}
          noun={linkType === "DERIVED_FROM" ? "sources" : "notes"}
          onSelect={setSelected}
          onCancel={onCancel}
          autoFocus
        />
      )}

      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        placeholder="Why does this link exist? — this note connects to that one because…"
        title="The articulation test: a link without a reason is an address-book entry, not knowledge."
        className="w-full resize-none rounded border border-[var(--bai-border)] bg-[var(--bai-deep)] px-3 py-1.5 text-xs text-[var(--bai-text-secondary)] outline-none placeholder:text-[var(--bai-text-faint)] focus:border-[var(--bai-accent)]/50"
      />

      <div className="flex items-center gap-2">
        <select
          value={confidence ?? ""}
          onChange={(e) =>
            setConfidence(
              isEdgeConfidence(e.target.value) ? e.target.value : null,
            )
          }
          className="rounded border border-[var(--bai-border)] bg-[var(--bai-deep)] px-2 py-1.5 text-xs text-[var(--bai-text-secondary)]"
          title="How well-founded is this link?"
        >
          <option value="">confidence…</option>
          {EDGE_CONFIDENCE_LEVELS.map((c) => (
            <option key={c} value={c} title={CONFIDENCE_LABELS[c]}>
              {c}
            </option>
          ))}
        </select>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-3 py-1 text-xs text-[var(--bai-text-muted)] hover:bg-[var(--bai-hover)]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canAdd}
          title={
            !selected
              ? "Choose a document from this vault first"
              : !hasReason
                ? "Say why this link exists first"
                : undefined
          }
          className="rounded bg-[var(--bai-accent)] px-3 py-1 text-xs font-medium text-[var(--bai-accent-text)] hover:bg-[var(--bai-accent)]/80 disabled:opacity-40"
        >
          Add
        </button>
      </div>
    </div>
  );
}
```

  **3g. `DocumentSearch`.** Replace the whole function (lines 629-722) with:

```tsx
function DocumentSearch({
  candidates,
  pasted,
  noun,
  onSelect,
  onCancel,
  autoFocus,
}: {
  candidates: LinkCandidate[];
  /** A pasted id that names a document in this drive, of any kind. */
  pasted: (query: string) => LinkCandidate | null;
  /** What the list holds, for the placeholder. */
  noun: "notes" | "sources";
  onSelect: (doc: LinkCandidate) => void;
  onCancel: () => void;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(
    () => searchCandidates(query, candidates, pasted(query)),
    [query, candidates, pasted],
  );

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
        placeholder={`Search ${noun} by title, or paste an id`}
        className="w-full rounded border border-[var(--bai-border)] bg-[var(--bai-deep)] px-3 py-1.5 text-sm text-[var(--bai-text-secondary)] outline-none focus:border-[var(--bai-accent)]/50"
      />

      {isOpen && filtered.length > 0 && (
        <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-[var(--bai-border)] bg-[var(--bai-surface)] shadow-xl">
          {filtered.map((doc) => (
            <button
              key={doc.id}
              type="button"
              onClick={() => {
                onSelect(doc);
                setIsOpen(false);
                setQuery("");
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--bai-hover)]"
            >
              <span className="flex-1 truncate text-sm text-[var(--bai-text-secondary)]">
                {candidateLabel(doc)}
              </span>
              <span className="shrink-0 text-[10px] font-mono text-[var(--bai-text-tertiary)]">
                {doc.id.slice(0, 8)}
              </span>
            </button>
          ))}
        </div>
      )}

      {isOpen && query.trim() && filtered.length === 0 && (
        <div className="absolute z-10 mt-1 w-full rounded-lg border border-[var(--bai-border)] bg-[var(--bai-surface)] px-3 py-2 shadow-xl">
          <p className="text-xs text-[var(--bai-text-muted)]">Nothing in this vault matches</p>
        </div>
      )}
    </div>
  );
}
```

  **3h. `editor.tsx` import.** After line 36 (`import { useKnowledgeNotes } from "../knowledge-vault/hooks/use-knowledge-notes.js";`)
  add:

```tsx
import { addLinkActions } from "./lib/link-actions.js";
```

  **3i. `editor.tsx` `onAddLink`.** Replace lines 504-534, from `onAddLink={(` through the `}}` before
  `onArticulate={(id, articulation) => {`, with:

```tsx
                  onAddLink={(targetDocumentId, linkType, articulation) => {
                    // ADD_RELATIONSHIP is a reactor system action (scope:
                    // "document") on the SOURCE document. The reactor
                    // writes one row to DocumentRelationship — with the
                    // articulation as its `metadata` — and the
                    // graph-indexer mirrors both into graph_edges.
                    // Guarded: nothing goes without a target, or to the note itself.
                    const acts = addLinkActions(
                      document.header.id,
                      targetDocumentId,
                      linkType,
                      articulation,
                      { now: timestamp(), newId: generateId },
                    );
                    if (acts.length > 0) {
                      void dispatchActions(acts as never, document.header.id);
                    }
                  }}
```

- [ ] Step 4: run
  `bunx vitest run editors/knowledge-note-editor && bun run tsc && bun run lint:fix`
  Expected: the vitest run PASSES, including `links-section.test.tsx` (2 tests), `link-targets.test.ts` and
  `link-actions.test.ts`. `tsc` exits 0 with no errors. oxlint reports 0 errors.

- [ ] Step 5: commit

```bash
git add editors/knowledge-note-editor/components/links-section.tsx editors/knowledge-note-editor/components/links-section.test.tsx editors/knowledge-note-editor/editor.tsx
git commit -m "feat(note-links): no manual link entry — a link points at a vault document, sources for Derived from

The add form picks from the vault's notes, or its sources for Derived from,
and a pasted id that names any document in the drive. Add stays disabled
until a document is chosen and a reason written; the editor sends nothing
without a target or to the note itself.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

---

### Task 12: Changing a link's target asks for the reason and sends one batch (part 6, draft label F4)

**Files:**
- Modify: `editors/knowledge-note-editor/components/links-section.tsx` (bai-knowledge-note): `LinksSectionProps`,
  the `LinkCard` element in `LinksSection` (written by F3), and `LinkCard` (the props, the click-outside effect
  `:236-249`, and the editing block written by F3). Add an exported `RetargetReason`.
- Modify: `editors/knowledge-note-editor/editor.tsx` (bai-knowledge-note): the import added in F3, and a new
  `onChangeTarget` after `onUpdateLinkType` (`:582-624`)
- Test: `editors/knowledge-note-editor/components/links-section.test.tsx` (extend)

**Interfaces:**
- Consumes: F2 `retargetLinkActions`; F3 `TargetFinder`, `kindOf`, `DocumentSearch`.
- Produces:
  - `LinksSectionProps.onChangeTarget: (id: string, targetDocumentId: string, articulation: LinkArticulation) => void`
  - `export function RetargetReason(props: { target: LinkCandidate; initial: LinkArticulation; onSave: (a: LinkArticulation) => void; onCancel: () => void })`

- [ ] Step 1: write the failing test. Append to `links-section.test.tsx`. Extend the import line to
  `import { AddLinkForm, RetargetReason, type TargetFinder } from "./links-section.js";`, then add:

```tsx
describe("changing a link's target", () => {
  const NOTE: LinkCandidate = { id: "note-3", title: "Memory walls slow training", kind: "note" };

  it("asks why the note links to the new target, with the current reason and confidence filled in", () => {
    const html = renderToStaticMarkup(
      <RetargetReason
        target={NOTE}
        initial={{ reason: "Both measure the same chip", confidence: "established" }}
        onSave={noop}
        onCancel={noop}
      />,
    );
    expect(html).toContain("Why does this note link to “Memory walls slow training”?");
    expect(html).toMatch(/<textarea[^>]*>Both measure the same chip<\/textarea>/);
    expect(html).toContain('<option value="established" selected="">');
    expect(/<button[^>]*>Save<\/button>/.exec(html)?.[0]).not.toContain('disabled=""');
  });

  it("will not save the new target without a reason", () => {
    const html = renderToStaticMarkup(
      <RetargetReason target={NOTE} initial={{ reason: "", confidence: null }} onSave={noop} onCancel={noop} />,
    );
    expect(/<button[^>]*>Save<\/button>/.exec(html)?.[0]).toContain('disabled=""');
  });
});
```

- [ ] Step 2: run `bunx vitest run editors/knowledge-note-editor/components/links-section.test.tsx`
  Expected: FAIL. `RetargetReason` is not exported (`Element type is invalid … got: undefined`).

- [ ] Step 3: implement.

  **3a. Props.** In `LinksSectionProps`, after `onArticulate: (id: string, articulation: LinkArticulation) => void;`,
  add:

```tsx
  /**
   * Point a link at another document, its reason restated: REMOVE the old
   * pair and ADD the new one in one dispatch.
   */
  onChangeTarget: (
    id: string,
    targetDocumentId: string,
    articulation: LinkArticulation,
  ) => void;
```

  Add `onChangeTarget,` to `LinksSection`'s destructured parameters, after `onArticulate,`.

  **3b. The `LinkCard` element.** Replace the interim prop written in F3:

```tsx
          onChangeTarget={(targetId) => {
            // Interim until F4: remove and re-add. F4 carries the reason across.
            onRemoveLink(link.id);
            onAddLink(targetId, kindOf(link), { reason: "", confidence: null });
            setEditingLinkId(null);
          }}
```

  with:

```tsx
          onChangeTarget={(targetId, articulation) => {
            onChangeTarget(link.id, targetId, articulation);
            setEditingLinkId(null);
          }}
```

  **3c. `LinkCard`.** In its props type, replace `onChangeTarget: (targetId: string) => void;` with
  `onChangeTarget: (targetId: string, articulation: LinkArticulation) => void;`.
  Replace the lines from `const editRef = useRef<HTMLDivElement>(null);` through the end of the F3 editing block
  (`if (isEditing) { … }`) with:

```tsx
  const editRef = useRef<HTMLDivElement>(null);
  const [isArticulating, setIsArticulating] = useState(false);
  // The target picked, while the person says why the note links to it.
  const [newTarget, setNewTarget] = useState<LinkCandidate | null>(null);
  const confidence = isEdgeConfidence(link.confidence) ? link.confidence : null;

  // The parent supplies `onCancelEdit` as an inline arrow, so this
  // click-outside listener was re-subscribed on every render — once per link
  // card on the page. Leaving also drops a target picked but not saved.
  const cancelEdit = useEventCallback(() => {
    setNewTarget(null);
    onCancelEdit();
  });
  useEffect(() => {
    if (!isEditing) return;
    function handleClickOutside(e: MouseEvent) {
      if (editRef.current && !editRef.current.contains(e.target as Node)) {
        cancelEdit();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isEditing, cancelEdit]);

  if (isEditing) {
    const kind = kindOf(link);
    return (
      <div
        ref={editRef}
        className="rounded-lg border border-[var(--bai-accent)]/20 bg-[var(--bai-accent-soft)] p-2"
      >
        {newTarget ? (
          <RetargetReason
            target={newTarget}
            initial={{ reason: link.reason ?? "", confidence }}
            onSave={(articulation) => {
              onChangeTarget(newTarget.id, articulation);
              setNewTarget(null);
            }}
            onCancel={cancelEdit}
          />
        ) : (
          <>
            <p className="mb-1.5 text-[10px] font-medium uppercase text-[var(--bai-text-muted)]">
              Change target document
            </p>
            <DocumentSearch
              candidates={targets.candidates(kind)}
              pasted={targets.pasted}
              noun={kind === "DERIVED_FROM" ? "sources" : "notes"}
              onSelect={setNewTarget}
              onCancel={cancelEdit}
              autoFocus
            />
          </>
        )}
      </div>
    );
  }
```

  Then delete the now-duplicate line after the block, which was line 270 before F3:
  `const confidence = isEdgeConfidence(link.confidence) ? link.confidence : null;`. It is declared above now.

  **3d. `RetargetReason`.** Add it directly above `function ArticulationForm(`:

```tsx
/**
 * The reason for a link's new target. The old reason and confidence are
 * filled in — they may still hold — and Save is the only way the new target
 * lands: REMOVE and ADD go together, so the edge is never without a reason.
 */
export function RetargetReason({
  target,
  initial,
  onSave,
  onCancel,
}: {
  target: LinkCandidate;
  initial: LinkArticulation;
  onSave: (articulation: LinkArticulation) => void;
  onCancel: () => void;
}) {
  return (
    <div>
      <p className="text-[12px] font-medium text-[var(--bai-text-secondary)]">
        {`Why does this note link to “${target.title}”?`}
      </p>
      <ArticulationForm
        initial={initial}
        submitLabel="Save"
        onSubmit={onSave}
        onCancel={onCancel}
      />
    </div>
  );
}
```

  **3e. `editor.tsx` import.** Replace `import { addLinkActions } from "./lib/link-actions.js";` with:

```tsx
import { addLinkActions, retargetLinkActions } from "./lib/link-actions.js";
```

  **3f. `editor.tsx` `onChangeTarget`.** After the `onUpdateLinkType` handler, whose last line is the `}}` at
  `:624` followed by `/>`, insert before the `/>`:

```tsx
                  onChangeTarget={(id, targetDocumentId, articulation) => {
                    // The target is part of the relationship's identity, so a
                    // new target is remove + add — in one dispatch, as a type
                    // change is, carrying the reason the person restated.
                    const link = links.find((l) => l.id === id);
                    if (!link) return;
                    const acts = retargetLinkActions(
                      document.header.id,
                      link,
                      targetDocumentId,
                      articulation,
                      { now: timestamp(), newId: generateId },
                    );
                    if (acts.length > 0) {
                      void dispatchActions(acts as never, document.header.id);
                    }
                  }}
```

- [ ] Step 4: run
  `bunx vitest run editors/knowledge-note-editor && bun run tsc && bun run lint:fix`
  Expected: PASS, including `links-section.test.tsx` (4 tests). `tsc` exits 0. oxlint reports 0 errors.

- [ ] Step 5: commit

```bash
git add editors/knowledge-note-editor/components/links-section.tsx editors/knowledge-note-editor/components/links-section.test.tsx editors/knowledge-note-editor/editor.tsx
git commit -m "feat(note-links): a new target asks for the reason, and lands in one remove+add dispatch

The picker leaves out documents this note already links to with the same
kind; Cancel changes nothing.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

---

### Task 13: Breakdowns around a scope — rows, progress, the left-over ones, and the delete order (part 6, draft label F5)

**Files:**
- Create: `editors/knowledge-vault/lib/scope-breakdowns.ts` (bai-knowledge-note)
- Test: `editors/knowledge-vault/lib/scope-breakdowns.test.ts` (bai-knowledge-note)

**Interfaces:**
- Consumes: `VaultAction` from `editors/knowledge-vault/lib/remote-reactor.ts`.
- Produces:
  - `type BreakdownRow = { id: string; name: string; sowRef: string | null; goals: number; done: number; active: number; dropped: number; notes: number }`
  - `breakdownRow(id: string, name: string, global: Record<string, unknown> | null | undefined): BreakdownRow`
  - `breakdownProgress(b: BreakdownRow): string`, for example `"3 goals, none done"`, `"2 goals, 1 done"`,
    `"1 goal, all done"` or `"No goals yet"`
  - `breakdownsOfScope(scopeId: string, projectWbsRefs: readonly (string | null | undefined)[], breakdowns: readonly BreakdownRow[]): BreakdownRow[]`
  - `breakdownsOutsideScopes(breakdowns: readonly BreakdownRow[], scopeIds: ReadonlySet<string>, heldByScopes: ReadonlySet<string>): BreakdownRow[]`
  - `recordedWorkLine(rows: readonly BreakdownRow[], withWhat: "them" | "it"): string | null`
  - `unlinkBreakdownAction(): VaultAction`, which gives
    `{ type: "SET_SOW_PROJECT_REF", scope: "global", input: { sowRef: null, sowProjectId: null } }`
  - `type ScopeDeleteDeps = { deleteDocument: (id: string) => Promise<void>; unlinkBreakdown: (id: string) => Promise<void>; onDeleted: (id: string) => void }`
  - `deleteScopeOfWork(scopeId: string, breakdownIds: readonly string[], alsoDeleteBreakdowns: boolean, deps: ScopeDeleteDeps): Promise<void>`

- [ ] Step 1: write the failing test, `editors/knowledge-vault/lib/scope-breakdowns.test.ts`:

```ts
/**
 * The work breakdowns around a scope of work: which deliver it, which are
 * left outside any scope, what each has done — and the order a scope is
 * deleted in: its breakdowns deleted or unlinked first, then the scope.
 */
import { describe, expect, it } from "vitest";
import {
  breakdownProgress,
  breakdownRow,
  breakdownsOfScope,
  breakdownsOutsideScopes,
  deleteScopeOfWork,
  recordedWorkLine,
  unlinkBreakdownAction,
  type ScopeDeleteDeps,
} from "./scope-breakdowns.js";

/** Goals as [status, notes] pairs. */
const goals = (...specs: [string, number?][]) =>
  specs.map(([status, notes = 0], i) => ({
    id: `g${i}`,
    description: `Goal ${i}`,
    status,
    notes: Array.from({ length: notes }, (_, k) => ({ id: `n${i}-${k}`, note: "done the thing" })),
  }));
const row = (id: string, name: string, sowRef: string | null, gs = goals()) => breakdownRow(id, name, { goals: gs, sowRef });

describe("a work breakdown's row", () => {
  it("counts its goals — done, in progress, dropped — and its notes", () => {
    expect(row("w", "W", "s", goals(["TODO"], ["COMPLETED", 2], ["IN_PROGRESS", 1], ["IN_REVIEW"], ["BLOCKED"], ["WONT_DO"]))).toEqual({
      id: "w", name: "W", sowRef: "s", goals: 6, done: 1, active: 3, dropped: 1, notes: 3,
    });
  });

  it("reads an unlinked breakdown, and a state with nothing in it", () => {
    expect(breakdownRow("w", "W", { goals: [], sowRef: null }).sowRef).toBeNull();
    expect(breakdownRow("w", "W", { sowRef: "" }).sowRef).toBeNull();
    expect(breakdownRow("w", "W", null)).toEqual({ id: "w", name: "W", sowRef: null, goals: 0, done: 0, active: 0, dropped: 0, notes: 0 });
  });

  it("says its progress in words", () => {
    const plan = row("w", "Knowledge Vault Go-to-Market Plan", "s", goals(["TODO"], ["TODO"], ["TODO"]));
    expect(`${plan.name} — ${breakdownProgress(plan)}`).toBe("Knowledge Vault Go-to-Market Plan — 3 goals, none done");
    expect(breakdownProgress(row("w", "W", null, goals(["COMPLETED"], ["TODO"])))).toBe("2 goals, 1 done");
    expect(breakdownProgress(row("w", "W", null, goals(["COMPLETED"])))).toBe("1 goal, all done");
    expect(breakdownProgress(row("w", "W", null))).toBe("No goals yet");
  });
});

describe("the breakdowns that deliver a scope", () => {
  const a = row("wbs-a", "A", "scope-1");
  const b = row("wbs-b", "B", null);
  const c = row("wbs-c", "C", "scope-2");

  it("takes each project's breakdown, then any that names the scope — once each", () => {
    expect(breakdownsOfScope("scope-1", ["wbs-b", null, "wbs-a", undefined], [a, b, c]).map((x) => x.id)).toEqual(["wbs-b", "wbs-a"]);
    expect(breakdownsOfScope("scope-1", [], [a, b, c]).map((x) => x.id)).toEqual(["wbs-a"]);
  });

  it("leaves out a project's breakdown that is no longer in the vault", () => {
    expect(breakdownsOfScope("scope-1", ["wbs-gone"], [b, c])).toEqual([]);
  });
});

describe("breakdowns outside any scope", () => {
  it("lists those with no scope or a scope not in this vault, by name — not one a scope's project holds", () => {
    const rows = [row("w1", "Zeta", null), row("w2", "Alpha", "scope-deleted"), row("w3", "Kept", "scope-1"), row("w4", "Held", null)];
    expect(breakdownsOutsideScopes(rows, new Set(["scope-1"]), new Set(["w4"])).map((r) => r.name)).toEqual(["Alpha", "Zeta"]);
  });
});

describe("what deleting breakdowns takes with them", () => {
  it("says nothing when every goal is still to do and none has a note", () => {
    expect(recordedWorkLine([row("w", "A", "s", goals(["TODO"], ["TODO"]))], "them")).toBeNull();
    expect(recordedWorkLine([], "them")).toBeNull();
  });

  it("names goals done and notes", () => {
    const rows = [
      row("w1", "A", "s", goals(["COMPLETED", 4], ["COMPLETED", 5], ["COMPLETED"])),
      row("w2", "B", "s", goals(["COMPLETED"], ["COMPLETED"], ["TODO"])),
    ];
    expect(recordedWorkLine(rows, "them")).toBe("5 goals done and 9 notes would be deleted with them.");
  });

  it("names goals in progress and dropped, for one breakdown", () => {
    const one = row("w", "A", "s", goals(["IN_PROGRESS"], ["BLOCKED"], ["WONT_DO"], ["COMPLETED", 1]));
    expect(recordedWorkLine([one], "it")).toBe("1 goal done, 2 goals in progress, 1 goal dropped and 1 note would be deleted with it.");
  });
});

describe("deleting a scope with its breakdowns", () => {
  const recorder = () => {
    const log: string[] = [];
    const deps: ScopeDeleteDeps = {
      deleteDocument: (id) => {
        log.push(`delete ${id}`);
        return Promise.resolve();
      },
      unlinkBreakdown: (id) => {
        log.push(`unlink ${id}`);
        return Promise.resolve();
      },
      onDeleted: (id) => {
        log.push(`gone ${id}`);
      },
    };
    return { log, deps };
  };

  it("deletes the breakdowns, then the scope, when the box is checked", async () => {
    const { log, deps } = recorder();
    await deleteScopeOfWork("scope-1", ["wbs-a", "wbs-b"], true, deps);
    expect(log).toEqual(["delete wbs-a", "gone wbs-a", "delete wbs-b", "gone wbs-b", "delete scope-1", "gone scope-1"]);
  });

  it("unlinks each breakdown first, then deletes the scope, when it is not", async () => {
    const { log, deps } = recorder();
    await deleteScopeOfWork("scope-1", ["wbs-a", "wbs-b"], false, deps);
    expect(log).toEqual(["unlink wbs-a", "unlink wbs-b", "delete scope-1", "gone scope-1"]);
  });

  it("stops at the first failure and keeps the scope", async () => {
    const { log, deps } = recorder();
    const failing: ScopeDeleteDeps = {
      ...deps,
      deleteDocument: (id) => (id === "wbs-b" ? Promise.reject(new Error("refused")) : deps.deleteDocument(id)),
    };
    await expect(deleteScopeOfWork("scope-1", ["wbs-a", "wbs-b"], true, failing)).rejects.toThrow("refused");
    expect(log).toEqual(["delete wbs-a", "gone wbs-a"]);
  });

  it("unlinks with SET_SOW_PROJECT_REF and both fields null — the model's 'not yet compiled into a scope'", () => {
    expect(unlinkBreakdownAction()).toEqual({ type: "SET_SOW_PROJECT_REF", scope: "global", input: { sowRef: null, sowProjectId: null } });
  });
});
```

- [ ] Step 2: run `bunx vitest run editors/knowledge-vault/lib/scope-breakdowns.test.ts`
  Expected: FAIL. The suite cannot load `./scope-breakdowns.js` (module not found).

- [ ] Step 3: implement, creating `editors/knowledge-vault/lib/scope-breakdowns.ts`:

```ts
/**
 * The work breakdowns (bai/wbs) around a scope of work. Which deliver it — its
 * projects' `wbsRef`, and any breakdown whose `sowRef` names it — which are
 * left outside any scope, and what each holds, so deleting a scope never
 * leaves a breakdown pointing at nothing (spec §7).
 *
 * Unlinking uses the model's own SET_SOW_PROJECT_REF with both fields null —
 * the state the model calls "not yet compiled into a scope" — so there is no
 * new operation.
 */
import type { VaultAction } from "./remote-reactor.js";

export type BreakdownRow = {
  id: string;
  name: string;
  /** The scope it says it delivers; null when unlinked. */
  sowRef: string | null;
  goals: number;
  /** COMPLETED */
  done: number;
  /** IN_PROGRESS, IN_REVIEW or BLOCKED */
  active: number;
  /** WONT_DO */
  dropped: number;
  /** Notes on its goals, all of them. */
  notes: number;
};

type GoalLike = { status?: unknown; notes?: unknown };
const ACTIVE = new Set(["IN_PROGRESS", "IN_REVIEW", "BLOCKED"]);

/** A breakdown's row, from its document's name and global state. */
export function breakdownRow(
  id: string,
  name: string,
  global: Record<string, unknown> | null | undefined,
): BreakdownRow {
  const g = global ?? {};
  const goals: GoalLike[] = Array.isArray(g.goals) ? (g.goals as GoalLike[]) : [];
  return {
    id,
    name,
    sowRef: typeof g.sowRef === "string" && g.sowRef ? g.sowRef : null,
    goals: goals.length,
    done: goals.filter((x) => x.status === "COMPLETED").length,
    active: goals.filter((x) => typeof x.status === "string" && ACTIVE.has(x.status)).length,
    dropped: goals.filter((x) => x.status === "WONT_DO").length,
    notes: goals.reduce((n, x) => n + (Array.isArray(x.notes) ? x.notes.length : 0), 0),
  };
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const andList = (xs: readonly string[]) =>
  xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

/** "3 goals, none done" · "2 goals, 1 done" · "1 goal, all done" · "No goals yet" */
export function breakdownProgress(b: BreakdownRow): string {
  if (b.goals === 0) return "No goals yet";
  const done = b.done === 0 ? "none" : b.done === b.goals ? "all" : String(b.done);
  return `${count(b.goals, "goal")}, ${done} done`;
}

/**
 * The breakdowns that deliver a scope: each project's breakdown, in project
 * order, then any other whose `sowRef` names the scope — once each, and only
 * those still in the vault.
 */
export function breakdownsOfScope(
  scopeId: string,
  projectWbsRefs: readonly (string | null | undefined)[],
  breakdowns: readonly BreakdownRow[],
): BreakdownRow[] {
  const byId = new Map(breakdowns.map((b) => [b.id, b] as const));
  const out: BreakdownRow[] = [];
  const seen = new Set<string>();
  const add = (b: BreakdownRow | undefined) => {
    if (b && !seen.has(b.id)) {
      seen.add(b.id);
      out.push(b);
    }
  };
  for (const ref of projectWbsRefs) if (ref) add(byId.get(ref));
  for (const b of breakdowns) if (b.sowRef === scopeId) add(b);
  return out;
}

/**
 * Breakdowns outside any scope: `sowRef` empty, or naming no scope in this
 * vault — and held by no scope's project. By name.
 */
export function breakdownsOutsideScopes(
  breakdowns: readonly BreakdownRow[],
  scopeIds: ReadonlySet<string>,
  heldByScopes: ReadonlySet<string>,
): BreakdownRow[] {
  return breakdowns
    .filter((b) => !heldByScopes.has(b.id) && (!b.sowRef || !scopeIds.has(b.sowRef)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * What deleting these breakdowns takes beyond goals still to do — "5 goals
 * done and 9 notes would be deleted with them." — or null when nothing was
 * recorded.
 */
export function recordedWorkLine(rows: readonly BreakdownRow[], withWhat: "them" | "it"): string | null {
  const sum = (pick: (b: BreakdownRow) => number) => rows.reduce((n, b) => n + pick(b), 0);
  const done = sum((b) => b.done);
  const active = sum((b) => b.active);
  const dropped = sum((b) => b.dropped);
  const notes = sum((b) => b.notes);
  const parts = [
    done ? `${count(done, "goal")} done` : null,
    active ? `${count(active, "goal")} in progress` : null,
    dropped ? `${count(dropped, "goal")} dropped` : null,
    notes ? count(notes, "note") : null,
  ].filter((p): p is string => p !== null);
  return parts.length ? `${andList(parts)} would be deleted with ${withWhat}.` : null;
}

/** SET_SOW_PROJECT_REF with both fields null: the breakdown stays, outside any scope. */
export function unlinkBreakdownAction(): VaultAction {
  return { type: "SET_SOW_PROJECT_REF", scope: "global", input: { sowRef: null, sowProjectId: null } };
}

export type ScopeDeleteDeps = {
  deleteDocument: (id: string) => Promise<void>;
  /** Write `unlinkBreakdownAction()` to the breakdown. */
  unlinkBreakdown: (id: string) => Promise<void>;
  /** Told as each document goes, so the view drops it even when a later step fails. */
  onDeleted: (id: string) => void;
};

/**
 * Delete a scope of work: its breakdowns first — deleted, or unlinked — then
 * the scope. The first failure stops the rest and is thrown; the scope is
 * deleted last, so a failure never leaves a breakdown pointing at nothing.
 */
export async function deleteScopeOfWork(
  scopeId: string,
  breakdownIds: readonly string[],
  alsoDeleteBreakdowns: boolean,
  deps: ScopeDeleteDeps,
): Promise<void> {
  for (const id of breakdownIds) {
    if (alsoDeleteBreakdowns) {
      await deps.deleteDocument(id);
      deps.onDeleted(id);
    } else {
      await deps.unlinkBreakdown(id);
    }
  }
  await deps.deleteDocument(scopeId);
  deps.onDeleted(scopeId);
}
```

- [ ] Step 4: run `bunx vitest run editors/knowledge-vault/lib/scope-breakdowns.test.ts`
  Expected: PASS (13 tests).

- [ ] Step 5: commit

```bash
git add editors/knowledge-vault/lib/scope-breakdowns.ts editors/knowledge-vault/lib/scope-breakdowns.test.ts
git commit -m "feat(work): the breakdowns around a scope — progress, left-over ones, and the delete order

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

---

### Task 14: The scope dialog lists its breakdowns, and deletes or unlinks them first (part 6, draft label F6)

**Files:**
- Modify: `editors/knowledge-vault/components/ScopeOfWorkView.tsx` (bai-knowledge-note): design note `:16-26`,
  imports `:1-14`, `SowRow` `:40-52`, `DeleteScopeBody` `:141-158`, `ScopeOfWorkView` `:259-399`
- Test: `editors/knowledge-vault/components/ScopeOfWorkView.test.tsx` (bai-knowledge-note), new

**Interfaces:**
- Consumes: F5 (`BreakdownRow`, `breakdownRow`, `breakdownProgress`, `breakdownsOfScope`, `recordedWorkLine`,
  `deleteScopeOfWork`, `unlinkBreakdownAction`); `mutateDocumentRemote` and `deleteDocumentRemote` from
  `../lib/remote-reactor.js`; `refetch` from `useReactorDocsWithRefetch` (`hooks/use-reactor-docs.ts:183`).
- Produces:
  - `export function DeleteScopeBody(props: { breakdowns: readonly BreakdownRow[]; alsoDelete: boolean; onAlsoDelete: (v: boolean) => void; busy?: boolean })`
  - `SowRow.wbsRefs: string[]`, which replaces `SowRow.breakdowns: number`

- [ ] Step 1: write the failing test, `editors/knowledge-vault/components/ScopeOfWorkView.test.tsx`:

```tsx
/**
 * Deleting a scope of work: the dialog names the work breakdowns that deliver
 * it, with their progress; "Also delete these work breakdowns" starts checked;
 * unchecked, they stay — outside any scope.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DeleteScopeBody } from "./ScopeOfWorkView.js";
import { breakdownRow } from "../lib/scope-breakdowns.js";

const noop = () => {};
const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");
const todo = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `g${i}`, description: "x", status: "TODO", notes: [] }));
const PLAN = breakdownRow("wbs-plan", "Knowledge Vault Go-to-Market Plan", { goals: todo(3), sowRef: "scope-1" });
const WORKED = breakdownRow("wbs-done", "Launch", {
  goals: [
    { id: "a", description: "x", status: "COMPLETED", notes: [{ id: "n1", note: "shipped" }] },
    { id: "b", description: "y", status: "COMPLETED", notes: [] },
  ],
  sowRef: "scope-1",
});
const body = (breakdowns = [PLAN], alsoDelete = true) =>
  renderToStaticMarkup(<DeleteScopeBody breakdowns={breakdowns} alsoDelete={alsoDelete} onAlsoDelete={noop} />);

describe("the dialog for deleting a scope of work", () => {
  it("lists the breakdowns that deliver it, each with its progress", () => {
    expect(text(body())).toContain("Knowledge Vault Go-to-Market Plan — 3 goals, none done");
  });

  it("has the checkbox, checked by default", () => {
    const html = body();
    expect(html).toMatch(/<input type="checkbox" checked=""/);
    expect(text(html)).toContain("Also delete these work breakdowns");
  });

  it("says what recorded work would go while checked", () => {
    expect(text(body([PLAN, WORKED]))).toContain("2 goals done and 1 note would be deleted with them.");
    expect(text(body([PLAN]))).not.toContain("would be deleted");
  });

  it("says they stay, outside any scope, when unchecked", () => {
    const html = body([PLAN, WORKED], false);
    expect(html).not.toMatch(/<input type="checkbox" checked=""/);
    expect(text(html)).toContain("They stay, outside any scope.");
    expect(text(html)).not.toContain("would be deleted");
  });

  it("names neither list nor checkbox when nothing delivers the scope", () => {
    const html = body([]);
    expect(html).not.toContain('type="checkbox"');
    expect(text(html)).toContain("This deletes the whole scope of work");
  });
});
```

- [ ] Step 2: run `bunx vitest run editors/knowledge-vault/components/ScopeOfWorkView.test.tsx`
  Expected: FAIL. `DeleteScopeBody` is not exported (`Element type is invalid … got: undefined`).

- [ ] Step 3: implement.

  **3a. Design note.** Replace lines 23-25:

```
 * Each card can delete its scope of work — the whole document, so the person
 * types its title to confirm (TypeToConfirmDialog). The work breakdowns of its
 * projects are documents of their own and stay; the dialog says so.
```

  with:

```
 * Each card can delete its scope of work — the whole document, so the person
 * types its title to confirm (TypeToConfirmDialog). The dialog lists the work
 * breakdowns that deliver it; "Also delete these work breakdowns" starts
 * checked. Checked, they are deleted first; unchecked, each is unlinked first
 * (SET_SOW_PROJECT_REF, both fields null). The scope goes last, so nothing is
 * left pointing at it (lib/scope-breakdowns.ts).
```

  **3b. Imports.** Replace line 9,
  `import { createDocumentRemote, deleteDocumentRemote } from "../lib/remote-reactor.js";`, with:

```tsx
import { createDocumentRemote, deleteDocumentRemote, mutateDocumentRemote } from "../lib/remote-reactor.js";
import {
  breakdownProgress,
  breakdownRow,
  breakdownsOfScope,
  deleteScopeOfWork,
  recordedWorkLine,
  unlinkBreakdownAction,
  type BreakdownRow,
} from "../lib/scope-breakdowns.js";
```

  After the import block (after line 14), add:

```tsx
const SCOPE_DOC = "powerhouse/scopeofwork";
const WBS_DOC = "bai/wbs";
```

  **3c. `SowRow`.** Replace lines 49-50:

```tsx
  /** Projects linked to a work breakdown — breakdowns that stay when the scope goes. */
  breakdowns: number;
```

  with:

```tsx
  /** Its projects' work breakdowns (`wbsRef`), in project order. */
  wbsRefs: string[];
```

  **3d. `DeleteScopeBody`.** Replace lines 141-158, the whole function and its doc comment, with:

```tsx
/**
 * What goes with a scope of work — the dialog's body. The work breakdowns
 * that deliver it are listed with their progress, and go too unless the box
 * is cleared; then they stay, outside any scope.
 */
export function DeleteScopeBody({
  breakdowns,
  alsoDelete,
  onAlsoDelete,
  busy = false,
}: {
  breakdowns: readonly BreakdownRow[];
  alsoDelete: boolean;
  onAlsoDelete: (v: boolean) => void;
  busy?: boolean;
}) {
  const one = breakdowns.length === 1;
  const recorded = alsoDelete ? recordedWorkLine(breakdowns, one ? "it" : "them") : null;
  return (
    <>
      <p>
        This deletes the whole scope of work — its envelopes, deliverables,
        milestones and contributors. It cannot be undone.
      </p>
      {breakdowns.length > 0 && (
        <>
          <p>{one ? "One work breakdown delivers it:" : `${breakdowns.length} work breakdowns deliver it:`}</p>
          <ul
            className="space-y-1 rounded-lg px-3 py-2"
            style={{ backgroundColor: "var(--bai-deep)", border: "1px solid var(--bai-border)" }}
          >
            {breakdowns.map((b) => (
              <li key={b.id} className="text-[12.5px]">
                <span style={{ color: "var(--bai-text)" }}>{b.name}</span>
                <span style={{ color: "var(--bai-text-muted)" }}>{` — ${breakdownProgress(b)}`}</span>
              </li>
            ))}
          </ul>
          <label className="flex items-center gap-2 text-[12.5px]" style={{ color: "var(--bai-text)" }}>
            <input
              type="checkbox"
              checked={alsoDelete}
              disabled={busy}
              onChange={(e) => onAlsoDelete(e.target.checked)}
            />
            Also delete these work breakdowns
          </label>
          {alsoDelete
            ? recorded && <p style={{ color: "var(--bai-danger)" }}>{recorded}</p>
            : (
              <p style={{ color: "var(--bai-text-muted)" }}>
                {one ? "It stays, outside any scope." : "They stay, outside any scope."}
              </p>
            )}
        </>
      )}
    </>
  );
}
```

  **3e. `ScopeOfWorkView`.** Replace the function from `export function ScopeOfWorkView() {` (line 259) through
  `const confirmDelete = async () => { … };` (line 321) with:

```tsx
export function ScopeOfWorkView() {
  const [createOpen, setCreateOpen] = useState(false);
  // The scope being deleted, while the dialog is open; and the documents gone, kept out of the lists until the tree catches up.
  const [deleting, setDeleting] = useState<SowRow | null>(null);
  // Checked by default: a scope's breakdowns go with it unless the person keeps them.
  const [alsoDeleteBreakdowns, setAlsoDeleteBreakdowns] = useState(true);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set());
  const driveId = useSelectedDriveId();
  const projectsFolderId = useFolderMap().get("projects");
  const { serverFileNodes, isLoading: treeLoading } = useKnowledgeNotes();
  // Scopes and breakdowns in one read: the dialog lists a scope's breakdowns,
  // and the list below the cards the ones outside any scope.
  const specs = useMemo<ReactorDocSpec[]>(
    () =>
      serverFileNodes
        .filter((n) => n.documentType === SCOPE_DOC || n.documentType === WBS_DOC)
        .map((n) => ({ id: n.id, documentType: n.documentType, name: n.name })),
    [serverFileNodes],
  );
  const { docs, isLoading: docsLoading, refetch } = useReactorDocsWithRefetch(specs, {
    pollMs: 30_000,
    retainKey: "scope-view",
  });
  const isLoading = (treeLoading && specs.length === 0) || docsLoading;

  const sows = useMemo<SowRow[]>(() => {
    return docs
      .filter((d) => d.header.documentType === SCOPE_DOC)
      .map((d) => {
        const g = (d.state as unknown as { global: Record<string, unknown> }).global;
        const deliverables = (g.deliverables as { status?: string }[] | undefined) ?? [];
        const roadmaps = (g.roadmaps as { milestones?: unknown[] }[] | undefined) ?? [];
        const projects = (g.projects as { wbsRef?: string | null }[] | undefined) ?? [];
        return {
          id: d.header.id,
          title: (g.title as string | undefined) || d.header.name,
          status: (g.status as string | undefined) ?? "DRAFT",
          projects: projects.length,
          deliverables: deliverables.length,
          delivered: deliverables.filter((x) => x.status === "DELIVERED").length,
          milestones: roadmaps.reduce((n, r) => n + (r.milestones?.length ?? 0), 0),
          contributors: ((g.contributors as unknown[] | undefined) ?? []).length,
          wbsRefs: projects.flatMap((p) => (p.wbsRef ? [p.wbsRef] : [])),
          lastModified: d.header.lastModifiedAtUtcIso,
        };
      })
      .filter((row) => !gone.has(row.id))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [docs, gone]);

  const breakdowns = useMemo<BreakdownRow[]>(
    () =>
      docs
        .filter((d) => d.header.documentType === WBS_DOC && !gone.has(d.header.id))
        .map((d) =>
          breakdownRow(
            d.header.id,
            d.header.name,
            (d.state as unknown as { global?: Record<string, unknown> }).global,
          ),
        ),
    [docs, gone],
  );
  const deletingBreakdowns = useMemo(
    () => (deleting ? breakdownsOfScope(deleting.id, deleting.wbsRefs, breakdowns) : []),
    [deleting, breakdowns],
  );

  const markGone = (id: string) => setGone((prev) => new Set(prev).add(id));

  const confirmDelete = async () => {
    if (!deleting || !driveId || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteScopeOfWork(
        deleting.id,
        deletingBreakdowns.map((b) => b.id),
        alsoDeleteBreakdowns,
        {
          deleteDocument: (id) => deleteDocumentRemote(id, driveId),
          unlinkBreakdown: (id) => mutateDocumentRemote(id, [unlinkBreakdownAction()]),
          onDeleted: markGone,
        },
      );
      setDeleting(null);
    } catch (err) {
      setDeleteError(writeErrorText([err]));
    } finally {
      setDeleteBusy(false);
      triggerVaultPull();
      refetch();
    }
  };
```

  In the `SowCard` element's `onDelete` (lines 366-369), replace:

```tsx
              onDelete={(row) => {
                setDeleteError(null);
                setDeleting(row);
              }}
```

  with:

```tsx
              onDelete={(row) => {
                setDeleteError(null);
                setAlsoDeleteBreakdowns(true);
                setDeleting(row);
              }}
```

  Replace the dialog's child (line 394), `<DeleteScopeBody sow={deleting} />`, with:

```tsx
          <DeleteScopeBody
            breakdowns={deletingBreakdowns}
            alsoDelete={alsoDeleteBreakdowns}
            onAlsoDelete={setAlsoDeleteBreakdowns}
            busy={deleteBusy}
          />
```

- [ ] Step 4: run
  `bunx vitest run editors/knowledge-vault/components && bun run tsc && bun run lint:fix`
  Expected: PASS, including `ScopeOfWorkView.test.tsx` (5 tests). `VaultPlaces.test.tsx` still passes; it imports
  `DriveExplorer`, which imports this view. `tsc` exits 0. oxlint reports 0 errors.

- [ ] Step 5: commit

```bash
git add editors/knowledge-vault/components/ScopeOfWorkView.tsx editors/knowledge-vault/components/ScopeOfWorkView.test.tsx
git commit -m "feat(work): deleting a scope lists its breakdowns and deletes or unlinks them first

\"Also delete these work breakdowns\" starts checked. Unchecked, each is
unlinked with SET_SOW_PROJECT_REF (both null) before the scope goes, so no
breakdown is left pointing at a deleted scope.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

---

### Task 15: "Work breakdowns outside any scope", with Open and a typed-name Delete (part 6, draft label F7)

**Files:**
- Modify: `editors/knowledge-vault/components/ScopeOfWorkView.tsx` (bai-knowledge-note): add `OutsideScopeList` and
  `DeleteBreakdownBody`, and state, list and dialog in `ScopeOfWorkView` (as written by F6)
- Test: `editors/knowledge-vault/components/ScopeOfWorkView.test.tsx` (extend)

**Interfaces:**
- Consumes: F5 `breakdownsOutsideScopes`, `recordedWorkLine`, `breakdownProgress`; F6 `breakdowns`, `sows`,
  `markGone`, `refetch`.
- Produces:
  - `export function OutsideScopeList(props: { breakdowns: readonly BreakdownRow[]; onOpen: (id: string) => void; onDelete: (b: BreakdownRow) => void })`
  - `export function DeleteBreakdownBody(props: { breakdown: BreakdownRow })`

- [ ] Step 1: write the failing test. In `ScopeOfWorkView.test.tsx`, change the import to
  `import { DeleteBreakdownBody, DeleteScopeBody, OutsideScopeList } from "./ScopeOfWorkView.js";`, then append:

```tsx
describe("work breakdowns outside any scope", () => {
  const STRATEGY = breakdownRow("wbs-s", "Knowledge Vault Go-to-Market Strategy — Work Breakdown", { goals: todo(6), sowRef: "scope-gone" });

  it("lists each with its progress, Open and Delete, under its heading", () => {
    const html = renderToStaticMarkup(<OutsideScopeList breakdowns={[PLAN, STRATEGY]} onOpen={noop} onDelete={noop} />);
    const t = text(html);
    expect(t).toContain("Work breakdowns outside any scope");
    expect(t).toContain("Knowledge Vault Go-to-Market Plan");
    expect(t).toContain("3 goals, none done");
    expect(t).toContain("6 goals, none done");
    expect(html).toContain("aria-label=\"Open work breakdown “Knowledge Vault Go-to-Market Plan”\"");
    expect(html).toContain("aria-label=\"Delete work breakdown “Knowledge Vault Go-to-Market Plan”\"");
  });

  it("shows nothing when every breakdown is in a scope", () => {
    expect(renderToStaticMarkup(<OutsideScopeList breakdowns={[]} onOpen={noop} onDelete={noop} />)).toBe("");
  });

  it("says what deleting one takes", () => {
    expect(text(renderToStaticMarkup(<DeleteBreakdownBody breakdown={PLAN} />))).toContain("This deletes the whole work breakdown — its goals and their notes. It cannot be undone.");
    expect(text(renderToStaticMarkup(<DeleteBreakdownBody breakdown={WORKED} />))).toContain("2 goals done and 1 note would be deleted with it.");
  });
});
```

- [ ] Step 2: run `bunx vitest run editors/knowledge-vault/components/ScopeOfWorkView.test.tsx`
  Expected: FAIL. `OutsideScopeList` and `DeleteBreakdownBody` are not exported (`Element type is invalid`).

- [ ] Step 3: implement.

  **3a. Import.** In the F6 import from `../lib/scope-breakdowns.js`, add `breakdownsOutsideScopes,` after
  `breakdownsOfScope,`.

  **3b. Components.** Add directly after `DeleteScopeBody`:

```tsx
/**
 * Work breakdowns outside any scope — no `sowRef`, or one naming a scope that
 * is gone — so a left-over breakdown is found here, not only in search.
 */
export function OutsideScopeList({
  breakdowns,
  onOpen,
  onDelete,
}: {
  breakdowns: readonly BreakdownRow[];
  onOpen: (id: string) => void;
  onDelete: (b: BreakdownRow) => void;
}) {
  if (breakdowns.length === 0) return null;
  return (
    <section aria-labelledby="kv-outside-scope" className="space-y-2 pt-2">
      <h3 id="kv-outside-scope" className="text-xs font-semibold" style={{ color: "var(--bai-text-tertiary)" }}>
        Work breakdowns outside any scope
      </h3>
      <ul className="space-y-1">
        {breakdowns.map((b) => (
          <li
            key={b.id}
            className="flex items-center gap-2 rounded-xl border border-[var(--bai-border)] bg-[var(--bai-surface)] py-2.5 pl-4 pr-2"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium" style={{ color: "var(--bai-text-secondary)" }}>
                {b.name}
              </p>
              <p className="mt-0.5 text-[11px]" style={{ color: "var(--bai-text-muted)" }}>
                {breakdownProgress(b)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onOpen(b.id)}
              aria-label={`Open work breakdown “${b.name}”`}
              className="rounded-md px-2.5 py-1 text-xs font-medium transition-colors hover:bg-[var(--bai-hover)]"
              style={{ color: "var(--bai-text-secondary)" }}
            >
              Open
            </button>
            <button
              type="button"
              onClick={() => onDelete(b)}
              aria-label={`Delete work breakdown “${b.name}”`}
              title="Delete work breakdown"
              className="rounded-md p-1.5 transition-colors hover:bg-[var(--bai-danger-soft)] hover:text-[var(--bai-danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--bai-danger)]"
              style={{ color: "var(--bai-text-muted)" }}
            >
              <TrashIcon />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** What goes with a work breakdown — the dialog's body. */
export function DeleteBreakdownBody({ breakdown }: { breakdown: BreakdownRow }) {
  const recorded = recordedWorkLine([breakdown], "it");
  return (
    <>
      <p>This deletes the whole work breakdown — its goals and their notes. It cannot be undone.</p>
      {recorded && <p style={{ color: "var(--bai-danger)" }}>{recorded}</p>}
    </>
  );
}
```

  **3c. State and the list in `ScopeOfWorkView`.** After
  `const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set());` add:

```tsx
  // The left-over breakdown being deleted, while its dialog is open.
  const [deletingBreakdown, setDeletingBreakdown] = useState<BreakdownRow | null>(null);
```

  After the `deletingBreakdowns` memo (F6) add:

```tsx
  // Outside any scope: the scope ids come from the tree, so a scope still
  // loading never makes its breakdowns look left over.
  const scopeIds = useMemo(
    () => new Set(serverFileNodes.filter((n) => n.documentType === SCOPE_DOC && !gone.has(n.id)).map((n) => n.id)),
    [serverFileNodes, gone],
  );
  const outside = useMemo(
    () => breakdownsOutsideScopes(breakdowns, scopeIds, new Set(sows.flatMap((s) => s.wbsRefs))),
    [breakdowns, scopeIds, sows],
  );
```

  After `confirmDelete` (F6) add:

```tsx
  const confirmDeleteBreakdown = async () => {
    if (!deletingBreakdown || !driveId || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteDocumentRemote(deletingBreakdown.id, driveId);
      markGone(deletingBreakdown.id);
      setDeletingBreakdown(null);
    } catch (err) {
      setDeleteError(writeErrorText([err]));
    } finally {
      setDeleteBusy(false);
      triggerVaultPull();
      refetch();
    }
  };
```

  **3d. Render the list after the scope block.** It shows under the cards, and under the empty state too, because
  Liberuum has no scope. Find the end of the scope list:

```tsx
            />
          ))}
        </div>
      )}

      <NewScopeDialog
```

  and replace it with:

```tsx
            />
          ))}
        </div>
      )}

      {!docsLoading && (
        <OutsideScopeList
          breakdowns={outside}
          onOpen={(id) => setSelectedNode(id)}
          onDelete={(b) => {
            setDeleteError(null);
            setDeletingBreakdown(b);
          }}
        />
      )}

      <NewScopeDialog
```

  **3e. Its dialog.** Just before the final `</div>` of the return (after the `{deleting && ( … )}` block), add:

```tsx
      {deletingBreakdown && (
        <TypeToConfirmDialog
          title={`Delete “${deletingBreakdown.name}”?`}
          name={deletingBreakdown.name}
          nameLabel="the work breakdown's name"
          confirmLabel="Delete work breakdown"
          busyLabel="Deleting…"
          busy={deleteBusy}
          error={deleteError}
          onConfirm={() => void confirmDeleteBreakdown()}
          onCancel={() => setDeletingBreakdown(null)}
        >
          <DeleteBreakdownBody breakdown={deletingBreakdown} />
        </TypeToConfirmDialog>
      )}
```

- [ ] Step 4: run
  `bunx vitest run editors/knowledge-vault/components && bun run tsc && bun run lint:fix`
  Expected: PASS, including `ScopeOfWorkView.test.tsx` (8 tests). `tsc` exits 0. oxlint reports 0 errors.

- [ ] Step 5: commit

```bash
git add editors/knowledge-vault/components/ScopeOfWorkView.tsx editors/knowledge-vault/components/ScopeOfWorkView.test.tsx
git commit -m "feat(work): list work breakdowns outside any scope, with Open and a typed-name Delete

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

---

### Task 16: The chat unlinks a deleted scope's breakdowns, one line each (part 6, draft label F8)

**Files:**
- Modify: `editors/knowledge-vault/lib/chat/work-changes.ts` (bai-knowledge-note): `ProposedChange.derived` doc
  `:321-322`, `checkProposal` setup after `:831`, the `delete_document` branch `:1158-1188`
- Modify: `editors/knowledge-vault/lib/chat/test/work-fixtures.ts`: add `pointingWorkDocs()`
- Test: `editors/knowledge-vault/lib/chat/work-changes.test.ts`: replace the test at `:221-224`, and add tests

**Interfaces:**
- Consumes: `LoadedDocument` map (`docs`), `Names.doc`, `push`, `WBS_TYPE`, `ScopeOfWorkState`.
- Produces: for `delete_document` of a scope, one derived change per linked breakdown that is loaded and not
  deleted by name in the same proposal:
  `{ kind: "operation", document: <wbsId>, documentType: WBS_TYPE, derived: true, steps: [{ type: "SET_SOW_PROJECT_REF", input: { sowRef: null, sowProjectId: null } }], says: "Unlink work breakdown “<name>” — it stays, outside any scope" }`,
  followed by the scope deletion, whose `warning` is now just `"deletes the whole document"`.

- [ ] Step 1: write the failing tests.

  In `test/work-fixtures.ts`, after `linkedWorkDocs()`, add:

```ts
/** wbs-1 names scope-1 as its scope, but no project of scope-1 holds it — a one-way link. */
export function pointingWorkDocs(): Map<string, LoadedDocument> {
  const docs = loadedWorkDocs();
  let w = wbsUtils.createDocument({ global: docs.get("wbs-1")!.state } as never);
  w = wbsReducer(w, wbs.setSowProjectRef({ sowRef: "scope-1", sowProjectId: "proj-kv" }));
  expect(w.operations.global.every((op) => !op.error)).toBe(true);
  docs.set("wbs-1", { ...docs.get("wbs-1")!, state: w.state.global as unknown as Record<string, unknown> });
  return docs;
}
```

  In `work-changes.test.ts`, change the fixtures import (line 13) to
  `import { linkedWorkDocs, loadedWorkDocs, pointingWorkDocs } from "./test/work-fixtures.js";`, and replace the test
  at lines 221-224:

```ts
  it("says a deleted scope's breakdowns stay, so the person can delete them too", () => {
    const r = checkForm({ deletions: [{ document: "scope-1" }] }, linkedWorkDocs());
    expect(r.ok && r.proposal.changes[0].warning).toBe("deletes the whole document — its project's work breakdown stays, linked to nothing");
  });
```

  with:

```ts
  it("unlinks a deleted scope's breakdowns first, one line each — they stay, outside any scope", () => {
    const r = checkForm({ deletions: [{ document: "scope-1" }] }, linkedWorkDocs());
    if (!r.ok) throw new Error(r.errors.join(" | "));
    expect(r.proposal.changes.map((c) => [c.says, c.warning, c.derived ?? false])).toEqual([
      ["Unlink work breakdown “Knowledge Vault breakdown” — it stays, outside any scope", undefined, true],
      ["Delete scope of work “Powerhouse 2026”", "deletes the whole document", false],
    ]);
    expect(r.proposal.changes[0]).toMatchObject({
      document: "wbs-1",
      documentType: WBS_TYPE,
      steps: [{ type: "SET_SOW_PROJECT_REF", input: { sowRef: null, sowProjectId: null } }],
    });
    expect(r.proposal.deletions).toBe(1);
  });

  it("unlinks a breakdown that names the scope even when no project holds it", () => {
    const r = checkForm({ deletions: [{ document: "scope-1" }] }, pointingWorkDocs());
    expect(r.ok && says(r.proposal)).toEqual([
      "Unlink work breakdown “Knowledge Vault breakdown” — it stays, outside any scope",
      "Delete scope of work “Powerhouse 2026”",
    ]);
  });

  it("never deletes a breakdown it was not asked to — one named for deletion is deleted, not unlinked", () => {
    for (const order of [["scope-1", "wbs-1"], ["wbs-1", "scope-1"]]) {
      const r = checkForm({ deletions: order.map((document) => ({ document })) }, linkedWorkDocs());
      if (!r.ok) throw new Error(r.errors.join(" | "));
      expect(says(r.proposal).sort()).toEqual(["Delete scope of work “Powerhouse 2026”", "Delete work breakdown “Knowledge Vault breakdown”"]);
      expect(r.proposal.deletions).toBe(2);
    }
  });
```

- [ ] Step 2: run `bunx vitest run editors/knowledge-vault/lib/chat/work-changes.test.ts`
  Expected: FAIL. The first new test gets `["Delete scope of work “Powerhouse 2026”", "deletes the whole document — its project's work breakdown stays, linked to nothing", false]`
  where an unlink line was expected. The second test gets no unlink line. The third test, in the order
  `["scope-1", "wbs-1"]`, gets an extra "Unlink project KV …" line, and the rehearsal refuses it with
  `… is deleted by deletions[0] — act on it before deleting it, or not at all.`

- [ ] Step 3: implement in `work-changes.ts`.

  **3a.** Replace the doc comment on `derived` (line 321):

```ts
  /** Added by the checker, not written by the model — the unlink before a breakdown's deletion: not edited on its own. */
```

  with:

```ts
  /** Added by the checker, not written by the model — an unlink before a breakdown's or a scope's deletion: not edited on its own. */
```

  **3b.** After line 831,
  `const willCreate = new Set([...createdScopes, ...createdBreakdowns]);`, add:

```ts
  // The documents the proposal deletes by name: no unlink is proposed for one that goes anyway.
  const deletesByName = new Set(list.filter((c) => c.kind === "delete_document").map((c) => str(c.document)).filter((v): v is string => v !== undefined));
```

  **3c.** In the work-breakdown part of the `delete_document` branch, replace:

```ts
        if (scopeId && project) {
```

  with:

```ts
        // A scope deleted in the same proposal needs no unlink — and could not take one after it is gone.
        if (scopeId && project && !deletesByName.has(scopeId)) {
```

  **3d.** Replace the scope part of the branch, from
  `// A scope's breakdowns are documents of their own: say they stay, so the person can delete them too.` through
  the `push({ … warning: \`deletes the whole document${…}\`, });` and its `return;` (lines 1179-1187), with:

```ts
      // A scope's breakdowns stay: each is unlinked first, as its own line, so none points at a scope that is gone.
      // They are its projects' wbsRef and any breakdown whose sowRef names it; one the proposal deletes by name is
      // left to that deletion. The chat never deletes a breakdown it was not asked to.
      const held = (d.state as ScopeOfWorkState | null)?.projects;
      const fromProjects = Array.isArray(held) ? held.flatMap((x) => (typeof x.wbsRef === "string" && x.wbsRef ? [x.wbsRef] : [])) : [];
      const naming = [...docs.values()]
        .filter((w) => w.documentType === WBS_TYPE && (w.state as { sowRef?: unknown } | null)?.sowRef === document)
        .map((w) => w.documentId);
      for (const id of new Set([...fromProjects, ...naming])) {
        if (docs.get(id)?.documentType !== WBS_TYPE || deletesByName.has(id)) continue;
        push({
          kind: "operation", document: id, documentType: WBS_TYPE, derived: true,
          steps: [{ type: "SET_SOW_PROJECT_REF", input: { sowRef: null, sowProjectId: null } }],
          says: `Unlink work breakdown ${names.doc(id)} — it stays, outside any scope`,
        });
      }
      push({ kind, document, documentType: SCOPE_TYPE, says: `Delete scope of work ${names.doc(document)}`, warning: "deletes the whole document" });
      return;
```

- [ ] Step 4: run
  `bunx vitest run editors/knowledge-vault/lib/chat editors/knowledge-vault/hooks/use-work-proposal.test.ts && bun run tsc`
  Expected: PASS. That covers `work-changes.test.ts` with the three new tests, `work-tools.test.ts` and
  `use-work-proposal.test.ts`. `tsc` exits 0.

- [ ] Step 5: commit

```bash
git add editors/knowledge-vault/lib/chat/work-changes.ts editors/knowledge-vault/lib/chat/work-changes.test.ts editors/knowledge-vault/lib/chat/test/work-fixtures.ts
git commit -m "feat(chat): deleting a scope unlinks each of its breakdowns first, one line each

\"Unlink work breakdown “<name>” — it stays, outside any scope\": the chat
only unlinks; a breakdown is deleted only when the proposal names it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

---

### Task 17: The chat reads the breakdowns of a scope it deletes (part 6, draft label F9)

**Files:**
- Modify: `editors/knowledge-vault/lib/chat/vault-tools.ts` (bai-knowledge-note): `checkWorkProposal` `:1093-1100`
  and its doc comment `:1049-1056`; the import at `:29`
- Test: `editors/knowledge-vault/lib/chat/work-tools.test.ts` (extend)

**Interfaces:**
- Consumes: `driveMembers` (`Map<string, { name; documentType }>`), `load`, `docs`, `SCOPE_TYPE`, `WBS_TYPE`.
- Produces: no new export. For a `delete_document` of a scope, `checkWorkProposal` also loads every `wbsRef` of its
  projects and every `bai/wbs` member of the vault. F8's unlink lines then name them, and the rehearsal runs on them.

- [ ] Step 1: write the failing test. In `work-tools.test.ts`, inside `describe("propose_work_changes", …)`, after
  the test "reads the scope that holds a breakdown to delete, so the project is unlinked first", add:

```ts
  it("reads the breakdowns of a scope to delete, so each is unlinked first", async () => {
    const linked = linkedWorkDocs();
    const reads = fakeEngine({
      ...VAULT,
      "scope-1": { ...VAULT["scope-1"], global: linked.get("scope-1")!.state! },
      "wbs-1": { ...VAULT["wbs-1"], global: linked.get("wbs-1")!.state! },
    });
    const r = await executeTool("propose_work_changes", { summary: "Drop the scope", deletions: [{ document: "scope-1" }] }, CTX);
    expect(reads).toEqual(["scope-1", "wbs-1"]);
    expect(r.ok && (r.data as { proposal: WorkProposal }).proposal.changes.map((c) => c.says)).toEqual([
      "Unlink work breakdown “Knowledge Vault breakdown” — it stays, outside any scope",
      "Delete scope of work “Powerhouse 2026”",
    ]);
  });
```

- [ ] Step 2: run `bunx vitest run editors/knowledge-vault/lib/chat/work-tools.test.ts`
  Expected: FAIL. `reads` is `["scope-1"]`, because `wbs-1` is never read, and the proposal has only
  `"Delete scope of work “Powerhouse 2026”"`.

- [ ] Step 3: implement in `vault-tools.ts`.

  **3a.** Change line 29 to import `SCOPE_TYPE` too:

```ts
import { SCOPE_TYPE, WBS_TYPE, checkProposal, formToChanges, isNewRef, workCatalog, type CheckResult, type LoadedDocument } from "./work-changes.js";
```

  **3b.** In the doc comment of `checkWorkProposal`, replace
  `from the vault — and the scope holding any breakdown it deletes — then the` with
  `from the vault — the scope holding any breakdown it deletes, and the breakdowns of any scope it deletes — then the`.

  **3c.** Replace lines 1093-1100, from `// A breakdown to delete is unlinked from its project first: read the scope that holds it.`
  through `if (holders.size) await load(holders);`, with:

```ts
  // A breakdown to delete is unlinked from its project first: read the scope that holds it.
  // A scope to delete has its breakdowns unlinked first: read its projects' breakdowns, and every
  // breakdown in the vault — one may name the scope without a project holding it.
  const holders = new Set<string>();
  let deletesScope = false;
  for (const c of changes) {
    const d = c.kind === "delete_document" && typeof c.document === "string" ? docs.get(c.document.trim()) : undefined;
    const sowRef = (d?.state as { sowRef?: unknown } | null | undefined)?.sowRef;
    if (d?.documentType === WBS_TYPE && typeof sowRef === "string" && !docs.has(sowRef)) holders.add(sowRef);
    if (d?.documentType === SCOPE_TYPE) {
      deletesScope = true;
      const projects = (d.state as { projects?: { wbsRef?: string | null }[] } | null)?.projects ?? [];
      for (const p of projects) if (p.wbsRef && !docs.has(p.wbsRef)) holders.add(p.wbsRef);
    }
  }
  if (deletesScope && members) {
    for (const [id, m] of members) if (m.documentType === WBS_TYPE && !docs.has(id)) holders.add(id);
  }
  if (holders.size) await load(holders);
```

- [ ] Step 4: run `bunx vitest run editors/knowledge-vault/lib/chat && bun run tsc && bun run lint:fix`
  Expected: PASS, including the new `work-tools.test.ts` case. The earlier case "reads the scope that holds a
  breakdown to delete" still sees `["wbs-1", "scope-1"]`. `tsc` exits 0. oxlint reports 0 errors.

- [ ] Step 5: commit

```bash
git add editors/knowledge-vault/lib/chat/vault-tools.ts editors/knowledge-vault/lib/chat/work-tools.test.ts
git commit -m "feat(chat): read a deleted scope's breakdowns so the card can unlink each one

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

---

## Part 7: Graph find and filter (§10)

# Part 7: Find and filter in the graph (spec section 10)

All tasks are in **bai-knowledge-note** (branch `ui-upgrade`). No document-model change, no subgraph or processor change (so no `bun run build` is needed for this part; Vetra's watcher rebuilds editors).

## Notes for the assembler

- **Spec line numbers checked against current code.** The toolbar is at `GraphView.tsx:1051-1108` and the legend at `:1110-1168` (the spec said `:1110-1170`; 1170 is the hover tooltip comment). `applyHighlight` is at `graph/model.ts:657-686` (spec: 657-675). `hitTest` is at `model.ts:403-438`. Its three callers in `GraphView.tsx` are at `:515`, `:595` and `:655`. `refreshHighlight` is at `GraphView.tsx:1274-1291`.
- **The spec's link list differs from today's legend.** Today the legend loops over `LINK_TYPE_COLOR_HEX`, which also has `CITES` and `DELIVERED_BY`. Those two are edges of the indexed scope and WBS documents, and the editor's graph can never draw them: `buildGraphModel` only makes `CORE_IDEA` edges and knowledge-note `LinkType` edges, and `LinkType` has five values (`document-models/knowledge-note/v2/schema.graphql:46-52`). The new legend lists exactly the spec's six link entries. `LINK_TYPE_COLOR_HEX` and `LINK_TYPE_COLOR_NUM` stay as they are.
- **The labels change to the spec's words.** Today the legend prints "DRAFT", "IN REVIEW" and "relates to". It now prints "Draft", "In review", "Canonical", "Archived", "MOC", "relates to", "builds on", "contradicts", "supersedes", "derived from", "core idea".
- **Cross-part file: `editors/knowledge-vault/components/DriveExplorer.tsx`.** Part 3/4 (guide, `CREATE_ITEMS` export) also edits it. This part only adds one import, one `useState` after line 259, and two props on `<GraphView>` at `:842-849`. Those spots do not overlap with the guide changes. The guide copy for the graph ("Find a note, or hide kinds of notes from the legend.") belongs to the guide part, not here.
- **How "hidden" is drawn.** Both renderers already skip anything whose alpha byte is 0: the GL node shader at `gl-renderer.ts:65`, the GL edge shader at `:138`, and the canvas renderer at `canvas-renderer.ts:148`, `:174` and `:197`. So hidden means alpha 0, written in the same loop that writes the highlight alpha. No renderer change is needed.
- **Performance.** `indexGraph` stores a `Uint8Array` kind code per node and per edge. A toggle then runs `computeVisibility` (one pass over the nodes and one over the edges, with bit tests and no strings) and then `applyHighlight` (its existing pass, plus one extra comparison per item). The visibility arrays are reused when the graph keeps its size. `hitTest` gains one byte read per node.
- **Decisions I made.**
  1. A status the legend does not list (an unknown status) gets kind code 31. No filter sets that bit, so such a node is never hidden.
  2. Find puts titles that **start** with the text before titles that only contain it. Within each group it keeps graph order (notes, then maps of content). Matching ignores case and trims the query. Find also searches hidden nodes, because choosing one shows its kind again.
  3. After a choice, the find box empties. Arrow keys move through the list, and Enter takes the highlighted row (the first by default).
  4. If a toggle hides the **selected** node, the selection clears, the same as clicking empty canvas, so no card is left for a node that is not drawn.
  5. The sidebar's `focusedIds` still lists all of a node's neighbours, hidden ones included. The legend is a filter on the canvas only.
  6. Fit-to-screen still frames every placed node, hidden ones included, so the framing does not jump when an entry is toggled. This matches "the layout keeps hidden nodes".
  7. `FIT_INSETS.top` goes from 40 to 56 so that a fit clears the find box (top 12 px plus a 32 px box).
  8. A refresh that keeps the structure but changes a status or a link type (the `sameStructure` path) now updates the kind codes, so the filter follows the change. Today that path does not recolour edges when a link type changes. That is an existing gap and this part leaves it alone.
  9. `filter` and `onFilterChange` are **required** props of `GraphView`. Its only caller is `DriveExplorer`.
- **Verification is mostly unit-level.** GraphView's canvas wiring has no test harness (there is no GraphView test today). F7f is checked with `bun run tsc`, `bun run lint:fix`, the graph test folder and a manual pass in Vetra Studio. The manual steps are listed in that task.

---

### Task 18: Legend kinds and the filter value (part 7, draft label F7a)

**Files (repo: bai-knowledge-note):**
- Modify `editors/knowledge-vault/components/graph/model.ts`:
  - insert a new section after `sameStructure` (after line 245, before the `/*  Indexed graph  */` banner at 247);
  - replace the `IndexedGraph` type (`:252-263`);
  - replace `indexGraph` (`:265-310`).
- Test: `editors/knowledge-vault/components/graph/model.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (all exported from `graph/model.ts`):
  - `NODE_KINDS = ["DRAFT","IN_REVIEW","CANONICAL","ARCHIVED","MOC"] as const`, `type NodeKind`, `NODE_KIND_LABEL: Record<NodeKind, string>`
  - `LINK_KINDS = ["RELATES_TO","BUILDS_ON","CONTRADICTS","SUPERSEDES","DERIVED_FROM","CORE_IDEA"] as const`, `type LinkKind`, `LINK_KIND_LABEL: Record<LinkKind, string>`
  - `OTHER_KIND = 31`
  - `nodeKindCode(node: Pick<NodeSpec, "isMoc" | "status">): number`
  - `linkKindCode(link: Pick<LinkSpec, "linkType">): number`
  - `type GraphFilter = { hiddenNodes: readonly NodeKind[]; hiddenLinks: readonly LinkKind[] }`
  - `EMPTY_GRAPH_FILTER: GraphFilter`
  - `hidesAnything(filter: GraphFilter): boolean`
  - `toggleNodeKind(filter: GraphFilter, kind: NodeKind): GraphFilter`
  - `toggleLinkKind(filter: GraphFilter, kind: LinkKind): GraphFilter`
  - `showNodeKind(filter: GraphFilter, node: Pick<NodeSpec, "isMoc" | "status">): GraphFilter`, which returns the same object when nothing changes
  - `IndexedGraph` gains `nodeKind: Uint8Array` (per node) and `linkKind: Uint8Array` (per indexed link)

- [ ] Step 1: write the failing test. In `model.test.ts`, extend the import from `./model.js` (lines 2-22) so that it reads:

```ts
import {
  applyHighlight,
  buildGraphModel,
  easeFactor,
  easeTowards,
  edgeAlpha,
  edgeAttributes,
  EMPTY_GRAPH_FILTER,
  fitView,
  hidesAnything,
  hitTest,
  indexGraph,
  jitter,
  LINK_KIND_LABEL,
  LINK_KINDS,
  mergePositions,
  MOC_EDGE_COLOR,
  neighbourhood,
  NODE_KIND_LABEL,
  NODE_KINDS,
  nodeAlpha,
  nodeAttributes,
  OTHER_KIND,
  packGraph,
  sameStructure,
  showNodeKind,
  toggleLinkKind,
  toggleNodeKind,
  type GraphMocInput,
  type GraphNoteInput,
} from "./model.js";
```

Then add this block after the `describe("indexGraph and neighbourhood", ...)` block (after line 155):

```ts
describe("legend kinds and the filter", () => {
  it("codes each node and link by the legend entry that hides it; anything else is never hidden", () => {
    const g = indexGraph(
      buildGraphModel(
        [
          note("a", [{ target: "b" }]),
          note("b", [], "DRAFT"),
          note("odd", [], "WEIRD"),
        ],
        [moc("m", ["a"])],
      ),
    );
    expect([...g.nodeKind]).toEqual([2, 0, OTHER_KIND, 4]); // CANONICAL, DRAFT, unknown, MOC
    expect([...g.linkKind]).toEqual([5, 0]); // m→a core idea, a→b relates to
  });

  it("names the entries in the spec's words, in the legend's order", () => {
    expect(NODE_KINDS.map((k) => NODE_KIND_LABEL[k])).toEqual([
      "Draft",
      "In review",
      "Canonical",
      "Archived",
      "MOC",
    ]);
    expect(LINK_KINDS.map((k) => LINK_KIND_LABEL[k])).toEqual([
      "relates to",
      "builds on",
      "contradicts",
      "supersedes",
      "derived from",
      "core idea",
    ]);
  });

  it("toggles an entry, keeps the legend's order, and shows a node's kind again", () => {
    expect(hidesAnything(EMPTY_GRAPH_FILTER)).toBe(false);
    let f = toggleNodeKind(EMPTY_GRAPH_FILTER, "MOC");
    f = toggleNodeKind(f, "DRAFT");
    expect(f.hiddenNodes).toEqual(["DRAFT", "MOC"]);
    expect(hidesAnything(f)).toBe(true);
    f = toggleLinkKind(f, "CORE_IDEA");
    expect(f.hiddenLinks).toEqual(["CORE_IDEA"]);
    expect(toggleNodeKind(f, "DRAFT").hiddenNodes).toEqual(["MOC"]);
    expect(toggleLinkKind(f, "CORE_IDEA").hiddenLinks).toEqual([]);

    const shown = showNodeKind(f, { isMoc: true, status: null });
    expect(shown.hiddenNodes).toEqual(["DRAFT"]);
    expect(shown.hiddenLinks).toEqual(["CORE_IDEA"]); // links are left as they were
    expect(showNodeKind(f, { isMoc: false, status: "CANONICAL" })).toBe(f); // not hidden: unchanged
    expect(showNodeKind(f, { isMoc: false, status: "WEIRD" })).toBe(f);
    expect(EMPTY_GRAPH_FILTER.hiddenNodes).toEqual([]); // never mutated
  });
});
```

- [ ] Step 2: run `bunx vitest run editors/knowledge-vault/components/graph/model.test.ts` from the repo root.
  Expected: FAIL. The three new tests fail with `TypeError: ... is not a function` for `toggleNodeKind` / `hidesAnything`, and `g.nodeKind` is undefined. The existing tests still pass.

- [ ] Step 3: implement. In `graph/model.ts`, insert this new section right after the closing `}` of `sameStructure` (line 245) and before the banner `/*  Indexed graph  */` (line 247):

```ts
/* ------------------------------------------------------------------ */
/*  Legend kinds and the filter                                         */
/* ------------------------------------------------------------------ */

/** The node entries of the legend, in its order; each can be hidden. */
export const NODE_KINDS = [
  "DRAFT",
  "IN_REVIEW",
  "CANONICAL",
  "ARCHIVED",
  "MOC",
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];
export const NODE_KIND_LABEL: Record<NodeKind, string> = {
  DRAFT: "Draft",
  IN_REVIEW: "In review",
  CANONICAL: "Canonical",
  ARCHIVED: "Archived",
  MOC: "MOC",
};

/** The link entries of the legend, in its order; each can be hidden. */
export const LINK_KINDS = [
  "RELATES_TO",
  "BUILDS_ON",
  "CONTRADICTS",
  "SUPERSEDES",
  "DERIVED_FROM",
  "CORE_IDEA",
] as const;
export type LinkKind = (typeof LINK_KINDS)[number];
export const LINK_KIND_LABEL: Record<LinkKind, string> = {
  RELATES_TO: "relates to",
  BUILDS_ON: "builds on",
  CONTRADICTS: "contradicts",
  SUPERSEDES: "supersedes",
  DERIVED_FROM: "derived from",
  CORE_IDEA: "core idea",
};

/**
 * The kind code of anything the legend does not list (an unknown status or
 * link type): a bit no filter sets, so it is never hidden.
 */
export const OTHER_KIND = 31;

/** A node's legend entry as an index into NODE_KINDS, or OTHER_KIND. */
export function nodeKindCode(node: Pick<NodeSpec, "isMoc" | "status">): number {
  const kind = node.isMoc ? "MOC" : node.status;
  const i = (NODE_KINDS as readonly (string | null)[]).indexOf(kind);
  return i < 0 ? OTHER_KIND : i;
}

/** A link's legend entry as an index into LINK_KINDS, or OTHER_KIND. */
export function linkKindCode(link: Pick<LinkSpec, "linkType">): number {
  const i = (LINK_KINDS as readonly (string | null)[]).indexOf(link.linkType);
  return i < 0 ? OTHER_KIND : i;
}

/**
 * What the legend hides. Held by the vault while it is open and never saved;
 * the order of each list follows the legend.
 */
export type GraphFilter = {
  hiddenNodes: readonly NodeKind[];
  hiddenLinks: readonly LinkKind[];
};

export const EMPTY_GRAPH_FILTER: GraphFilter = {
  hiddenNodes: [],
  hiddenLinks: [],
};

export function hidesAnything(filter: GraphFilter): boolean {
  return filter.hiddenNodes.length > 0 || filter.hiddenLinks.length > 0;
}

export function toggleNodeKind(
  filter: GraphFilter,
  kind: NodeKind,
): GraphFilter {
  const hidden = filter.hiddenNodes.includes(kind);
  return {
    ...filter,
    hiddenNodes: NODE_KINDS.filter((k) =>
      k === kind ? !hidden : filter.hiddenNodes.includes(k),
    ),
  };
}

export function toggleLinkKind(
  filter: GraphFilter,
  kind: LinkKind,
): GraphFilter {
  const hidden = filter.hiddenLinks.includes(kind);
  return {
    ...filter,
    hiddenLinks: LINK_KINDS.filter((k) =>
      k === kind ? !hidden : filter.hiddenLinks.includes(k),
    ),
  };
}

/** The filter with this node's kind shown again; the same object when it was not hidden. */
export function showNodeKind(
  filter: GraphFilter,
  node: Pick<NodeSpec, "isMoc" | "status">,
): GraphFilter {
  const code = nodeKindCode(node);
  if (code === OTHER_KIND) return filter;
  const kind = NODE_KINDS[code];
  return filter.hiddenNodes.includes(kind)
    ? toggleNodeKind(filter, kind)
    : filter;
}
```

Replace the `IndexedGraph` type (lines 251-263, from its doc comment through the closing `};`) with:

```ts
/** The model by node index: what the layout, the renderer and hit testing share. */
export type IndexedGraph = {
  nodes: NodeSpec[];
  index: Map<string, number>;
  links: LinkSpec[];
  src: Uint32Array;
  dst: Uint32Array;
  /** Undirected adjacency (CSR): the neighbours of i are adj[adjStart[i] .. adjStart[i + 1]). */
  adjStart: Uint32Array;
  adj: Uint32Array;
  radius: Float32Array;
  isMoc: Uint8Array;
  /** The legend entry of each node (nodeKindCode), so a filter is a pass of bit tests. */
  nodeKind: Uint8Array;
  /** The legend entry of each link (linkKindCode), in `links` order. */
  linkKind: Uint8Array;
};
```

Replace `indexGraph` (lines 265-310, `export function indexGraph(model: GraphModel): IndexedGraph {` through its closing `}`) with:

```ts
export function indexGraph(model: GraphModel): IndexedGraph {
  const nodes = model.nodes;
  const n = nodes.length;
  const index = new Map<string, number>();
  const radius = new Float32Array(n);
  const isMoc = new Uint8Array(n);
  const nodeKind = new Uint8Array(n);
  nodes.forEach((node, i) => {
    index.set(node.id, i);
    radius[i] = node.radius;
    isMoc[i] = node.isMoc ? 1 : 0;
    nodeKind[i] = nodeKindCode(node);
  });
  const links: LinkSpec[] = [];
  const src: number[] = [];
  const dst: number[] = [];
  const linkKind: number[] = [];
  for (const l of model.links) {
    const s = index.get(l.source);
    const t = index.get(l.target);
    if (s === undefined || t === undefined) continue;
    links.push(l);
    src.push(s);
    dst.push(t);
    linkKind.push(linkKindCode(l));
  }
  const adjStart = new Uint32Array(n + 1);
  for (let k = 0; k < src.length; k++) {
    adjStart[src[k] + 1]++;
    adjStart[dst[k] + 1]++;
  }
  for (let i = 0; i < n; i++) adjStart[i + 1] += adjStart[i];
  const adj = new Uint32Array(src.length * 2);
  const fill = adjStart.slice(0, n);
  for (let k = 0; k < src.length; k++) {
    adj[fill[src[k]]++] = dst[k];
    adj[fill[dst[k]]++] = src[k];
  }
  return {
    nodes,
    index,
    links,
    src: Uint32Array.from(src),
    dst: Uint32Array.from(dst),
    adjStart,
    adj,
    radius,
    isMoc,
    nodeKind,
    linkKind: Uint8Array.from(linkKind),
  };
}
```

- [ ] Step 4: run `bunx vitest run editors/knowledge-vault/components/graph/model.test.ts`.
  Expected: PASS (all tests, old and new).

- [ ] Step 5: commit.

```bash
git add editors/knowledge-vault/components/graph/model.ts editors/knowledge-vault/components/graph/model.test.ts
git commit -m "feat(graph): legend kinds per node and link, and the filter value

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

---

### Task 19: The visibility mask, drawn in the highlight pass and skipped by hit testing (part 7, draft label F7b)

**Files (repo: bai-knowledge-note):**
- Modify `editors/knowledge-vault/components/graph/model.ts`:
  - `hitTest` (`:403-438`, line numbers before F7a; after F7a, find it by its signature);
  - `applyHighlight` (`:653-686` before F7a, including its doc comment);
  - add `computeVisibility` directly after `applyHighlight`.
- Test: `editors/knowledge-vault/components/graph/model.test.ts`

**Interfaces:**
- Consumes: from F7a, `GraphFilter`, `IndexedGraph.nodeKind` / `linkKind`, `NODE_KINDS`, `LINK_KINDS`. Adds the private helper `kindBits` next to `computeVisibility`.
- Produces:
  - `type Visibility = { node: Uint8Array; edge: Uint8Array }` (1 drawn, 0 hidden)
  - `computeVisibility(g: IndexedGraph, filter: GraphFilter, reuse?: Visibility | null): Visibility | null`. It returns null when nothing is hidden, and reuses `reuse` when the sizes match.
  - `applyHighlight(g, highlight, nodeColor, edgeColor, edgePrimary, visible: Visibility | null = null): void`. The new last parameter is optional, so existing calls are unchanged.
  - `hitTest(g, pos, x, y, pad = 4, visible: Uint8Array | null = null): number`

- [ ] Step 1: write the failing tests. In `model.test.ts`, add `computeVisibility` to the `./model.js` import list (alphabetically after `buildGraphModel`). In `describe("hitTest", ...)` add this test after the last `it` (after line 240):

```ts
  it("passes over hidden nodes, as if they were not drawn", () => {
    // (-3, 0) is inside a (nearer) and on b's edge.
    expect(hitTest(g, noMoc, -3, 0, 4)).toBe(0);
    const aHidden = Uint8Array.from([0, 1, 1, 1]);
    expect(hitTest(g, noMoc, -3, 0, 4, aHidden)).toBe(1);
    expect(hitTest(g, noMoc, -12, 0, 4, aHidden)).toBe(-1); // only a was within the pad
    // A hidden MoC no longer covers the notes under it.
    expect(hitTest(g, pos, 5, 0, 4, Uint8Array.from([1, 1, 1, 0]))).toBe(1);
  });
```

Add this block after `describe("render attributes and highlight", ...)` (after line 358):

```ts
describe("the legend filter on screen", () => {
  // sample(): a, b, c are CANONICAL notes; m1, m2 MoCs. Edges 0–4 are core
  // ideas (m1→a, m1→b, m1→m2, m2→b, m2→c); edge 5 is a→b, relates to.
  const g = indexGraph(sample());

  it("hides nodes of a hidden kind, links of a hidden kind, and links that touch a hidden node", () => {
    expect(computeVisibility(g, EMPTY_GRAPH_FILTER)).toBeNull();
    const noMocs = computeVisibility(
      g,
      toggleNodeKind(EMPTY_GRAPH_FILTER, "MOC"),
    )!;
    expect([...noMocs.node]).toEqual([1, 1, 1, 0, 0]);
    expect([...noMocs.edge]).toEqual([0, 0, 0, 0, 0, 1]);
    const noRelates = computeVisibility(
      g,
      toggleLinkKind(EMPTY_GRAPH_FILTER, "RELATES_TO"),
    )!;
    expect([...noRelates.node]).toEqual([1, 1, 1, 1, 1]);
    expect([...noRelates.edge]).toEqual([1, 1, 1, 1, 1, 0]);
  });

  it("reuses its arrays while the graph keeps its size", () => {
    const first = computeVisibility(
      g,
      toggleNodeKind(EMPTY_GRAPH_FILTER, "MOC"),
    )!;
    const again = computeVisibility(
      g,
      toggleLinkKind(EMPTY_GRAPH_FILTER, "RELATES_TO"),
      first,
    )!;
    expect(again).toBe(first);
    expect([...again.node]).toEqual([1, 1, 1, 1, 1]);
    const other = indexGraph(buildGraphModel([note("x")], []));
    expect(
      computeVisibility(other, toggleNodeKind(EMPTY_GRAPH_FILTER, "MOC"), first),
    ).not.toBe(first);
  });

  it("writes hidden as transparent in the highlight's own pass, whatever is highlighted", () => {
    const { color: nodeColor } = nodeAttributes(g);
    const e = edgeAttributes(g);
    const visible = computeVisibility(
      g,
      toggleNodeKind(EMPTY_GRAPH_FILTER, "MOC"),
    );
    applyHighlight(g, null, nodeColor, e.color, e.primary, visible);
    expect([0, 1, 2, 3, 4].map((i) => nodeColor[i * 4 + 3])).toEqual([
      255, 255, 255, 0, 0,
    ]);
    expect([0, 1, 2, 3, 4, 5].map((k) => e.color[k * 4 + 3])).toEqual([
      0, 0, 0, 0, 0, 140,
    ]);

    const flags = new Uint8Array(5);
    for (const i of neighbourhood(g, g.index.get("c")!)) flags[i] = 1; // c, m2
    applyHighlight(g, flags, nodeColor, e.color, e.primary, visible);
    expect(nodeColor[4 * 4 + 3]).toBe(0); // m2 is in the highlight but hidden
    expect(nodeColor[2 * 4 + 3]).toBe(255); // c
    expect(nodeColor[0 * 4 + 3]).toBe(38); // a, dimmed
    expect(e.color[4 * 4 + 3]).toBe(0); // m2→c touches a hidden node
    expect(e.color[5 * 4 + 3]).toBe(10); // a→b, outside the highlight

    applyHighlight(g, null, nodeColor, e.color, e.primary, null);
    expect(nodeColor[3 * 4 + 3]).toBe(255); // shown again
    expect(e.color[0 * 4 + 3]).toBe(140);
  });
});
```

- [ ] Step 2: run `bunx vitest run editors/knowledge-vault/components/graph/model.test.ts`.
  Expected: FAIL. The hitTest test fails with `expected 0 to be 1`, because the extra argument is ignored. The new suite fails with `TypeError: computeVisibility is not a function`.

- [ ] Step 3: implement. In `hitTest`, change the signature and add the skip as the first line of the loop. Replace:

```ts
export function hitTest(
  g: IndexedGraph,
  pos: Float32Array,
  x: number,
  y: number,
  pad = 4,
): number {
  let inside = -1;
  let insideDist = Infinity;
  let near = -1;
  let nearGap = Infinity;
  const { radius, isMoc } = g;
  for (let i = 0; i < radius.length; i++) {
    const dx = pos[i * 2] - x;
```

with:

```ts
export function hitTest(
  g: IndexedGraph,
  pos: Float32Array,
  x: number,
  y: number,
  pad = 4,
  /** The node mask of `computeVisibility`: a hidden node (0) cannot be hovered or clicked. */
  visible: Uint8Array | null = null,
): number {
  let inside = -1;
  let insideDist = Infinity;
  let near = -1;
  let nearGap = Infinity;
  const { radius, isMoc } = g;
  for (let i = 0; i < radius.length; i++) {
    if (visible && visible[i] === 0) continue;
    const dx = pos[i * 2] - x;
```

Also add one sentence to `hitTest`'s doc comment, before the closing ` */`: ` * Nodes the legend hides (\`visible\`) are passed over.`

Replace `applyHighlight` with its doc comment (from `/**\n * Write the highlight into the alpha bytes` through the function's closing `}` at the end of the file) with:

```ts
/**
 * Write the highlight into the alpha bytes of the node and edge colours.
 * `highlight` flags the highlighted nodes (1), or is null for none.
 * `visible` is the legend's mask (computeVisibility), or null when nothing is
 * hidden: a hidden node or edge gets alpha 0, which the renderers skip. Both
 * are applied in this one pass.
 */
export function applyHighlight(
  g: IndexedGraph,
  highlight: Uint8Array | null,
  nodeColor: Uint8Array,
  edgeColor: Uint8Array,
  edgePrimary: Uint8Array,
  visible: Visibility | null = null,
): void {
  const n = g.nodes.length;
  const dim = Math.round(nodeAlpha(false) * 255);
  const shownNode = visible?.node ?? null;
  const shownEdge = visible?.edge ?? null;
  for (let i = 0; i < n; i++)
    nodeColor[i * 4 + 3] =
      shownNode && shownNode[i] === 0
        ? 0
        : highlight
          ? highlight[i]
            ? 255
            : dim
          : 255;
  // Six possible values; computed once.
  const table = new Uint8Array(8);
  for (let p = 0; p < 2; p++)
    for (let s = 0; s < 2; s++)
      for (let t = 0; t < 2; t++)
        table[(p << 2) | (s << 1) | t] = Math.round(
          edgeAlpha(p === 1, s === 1, t === 1) * 255,
        );
  const none = [
    Math.round(edgeAlpha(false, null, null) * 255),
    Math.round(edgeAlpha(true, null, null) * 255),
  ];
  for (let k = 0; k < g.links.length; k++) {
    const p = edgePrimary[k];
    edgeColor[k * 4 + 3] =
      shownEdge && shownEdge[k] === 0
        ? 0
        : highlight
          ? table[(p << 2) | (highlight[g.src[k]] << 1) | highlight[g.dst[k]]]
          : none[p];
  }
}

/** A filter list as bits over its kind codes. */
function kindBits(hidden: readonly string[], all: readonly string[]): number {
  let bits = 0;
  for (const kind of hidden) {
    const i = all.indexOf(kind);
    if (i >= 0) bits |= 1 << i;
  }
  return bits;
}

/** What the legend leaves on screen: per node and per edge, 1 drawn, 0 hidden. */
export type Visibility = { node: Uint8Array; edge: Uint8Array };

/**
 * The legend's mask for this graph, or null when it hides nothing. A node is
 * hidden when its kind is; an edge when its kind is or either end is hidden.
 * One pass over the nodes and one over the edges, all bit tests on the kind
 * codes, so a toggle at 100,000 nodes costs what a highlight does. `reuse` is
 * filled in place when it has the graph's sizes.
 */
export function computeVisibility(
  g: IndexedGraph,
  filter: GraphFilter,
  reuse: Visibility | null = null,
): Visibility | null {
  const hiddenNodes = kindBits(filter.hiddenNodes, NODE_KINDS);
  const hiddenLinks = kindBits(filter.hiddenLinks, LINK_KINDS);
  if (hiddenNodes === 0 && hiddenLinks === 0) return null;
  const n = g.nodes.length;
  const m = g.links.length;
  const v =
    reuse && reuse.node.length === n && reuse.edge.length === m
      ? reuse
      : { node: new Uint8Array(n), edge: new Uint8Array(m) };
  const { nodeKind, linkKind, src, dst } = g;
  for (let i = 0; i < n; i++)
    v.node[i] = ((hiddenNodes >>> nodeKind[i]) & 1) === 1 ? 0 : 1;
  for (let k = 0; k < m; k++)
    v.edge[k] =
      ((hiddenLinks >>> linkKind[k]) & 1) === 1 ||
      v.node[src[k]] === 0 ||
      v.node[dst[k]] === 0
        ? 0
        : 1;
  return v;
}
```

(`OTHER_KIND` is 31 and the filters only set bits 0 to 5, so `>>> 31` always reads 0 and such a node or link stays shown.)

- [ ] Step 4: run `bunx vitest run editors/knowledge-vault/components/graph/model.test.ts`.
  Expected: PASS. The existing `applyHighlight` test at `:334-357` still passes, because `visible` defaults to null.

- [ ] Step 5: commit.

```bash
git add editors/knowledge-vault/components/graph/model.ts editors/knowledge-vault/components/graph/model.test.ts
git commit -m "feat(graph): a visibility mask applied in the highlight pass; hidden nodes cannot be hit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

---

### Task 20: Find a node, and centre the view on it (part 7, draft label F7c)

**Files (repo: bai-knowledge-note):**
- Modify `editors/knowledge-vault/components/graph/model.ts`: add `findNodes` and `centerOn` directly after `fitView` (after the closing `}` of `fitView`, line 496 before F7a).
- Test: `editors/knowledge-vault/components/graph/model.test.ts`

**Interfaces:**
- Produces:
  - `type FoundNode = { id: string; label: string; isMoc: boolean }`
  - `FIND_LIMIT = 8`
  - `findNodes(g: Pick<IndexedGraph, "nodes">, query: string, limit?: number): FoundNode[]`
  - `centerOn(view: { scale: number }, x: number, y: number, width: number, height: number, minScale?: number): { scale: number; x: number; y: number }`

- [ ] Step 1: write the failing tests. Add `centerOn` and `findNodes` to the `./model.js` import list. Add this after `describe("fitView", ...)` (after line 278):

```ts
describe("find", () => {
  const g = indexGraph(
    buildGraphModel(
      [
        { ...note("x"), title: "Building agents" },
        { ...note("y"), title: "Agents first" },
        ...Array.from({ length: 12 }, (_, i) => note(`n${i}`)),
      ],
      [{ ...moc("t", []), title: "Agent topics" }],
    ),
  );

  it("waits for the second character", () => {
    expect(findNodes(g, "")).toEqual([]);
    expect(findNodes(g, "a")).toEqual([]);
    expect(findNodes(g, "  a ")).toEqual([]);
  });

  it("lists titles that start with the text first, then those that contain it, ignoring case, and marks maps of content", () => {
    expect(findNodes(g, "AGENT")).toEqual([
      { id: "y", label: "Agents first", isMoc: false },
      { id: "t", label: "Agent topics", isMoc: true },
      { id: "x", label: "Building agents", isMoc: false },
    ]);
  });

  it("lists at most eight, and nothing when nothing matches", () => {
    expect(findNodes(g, "note")).toHaveLength(8);
    expect(findNodes(g, "zzz")).toEqual([]);
  });
});

describe("centerOn", () => {
  it("puts the point in the middle of the canvas, at 1× or closer", () => {
    expect(centerOn({ scale: 0.5 }, 100, 50, 800, 600)).toEqual({
      scale: 1,
      x: 300,
      y: 250,
    });
    expect(centerOn({ scale: 2 }, 100, 50, 800, 600)).toEqual({
      scale: 2,
      x: 200,
      y: 200,
    });
  });
});
```

- [ ] Step 2: run `bunx vitest run editors/knowledge-vault/components/graph/model.test.ts`.
  Expected: FAIL with `TypeError: findNodes is not a function` and `TypeError: centerOn is not a function`.

- [ ] Step 3: implement. Insert after the closing `}` of `fitView`:

```ts
/** A node the find box lists. */
export type FoundNode = { id: string; label: string; isMoc: boolean };

/** The most nodes the find box lists. */
export const FIND_LIMIT = 8;

/**
 * Nodes whose title contains `query` (case ignored), from its second
 * character: titles that start with it first, then the rest, each in graph
 * order. Hidden nodes are found too — choosing one shows its kind again.
 */
export function findNodes(
  g: Pick<IndexedGraph, "nodes">,
  query: string,
  limit = FIND_LIMIT,
): FoundNode[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const starts: NodeSpec[] = [];
  const contains: NodeSpec[] = [];
  for (const node of g.nodes) {
    const at = node.label.toLowerCase().indexOf(q);
    if (at < 0) continue;
    if (at === 0) {
      starts.push(node);
      if (starts.length >= limit) break;
    } else if (contains.length < limit) {
      contains.push(node);
    }
  }
  return [...starts, ...contains]
    .slice(0, limit)
    .map((node) => ({ id: node.id, label: node.label, isMoc: node.isMoc }));
}

/** The view with world point (x, y) in the middle of the canvas, at `minScale` or closer. */
export function centerOn(
  view: { scale: number },
  x: number,
  y: number,
  width: number,
  height: number,
  minScale = 1,
): { scale: number; x: number; y: number } {
  const scale = Math.max(view.scale, minScale);
  return { scale, x: width / 2 - x * scale, y: height / 2 - y * scale };
}
```

- [ ] Step 4: run `bunx vitest run editors/knowledge-vault/components/graph/model.test.ts`.
  Expected: PASS.

- [ ] Step 5: commit.

```bash
git add editors/knowledge-vault/components/graph/model.ts editors/knowledge-vault/components/graph/model.test.ts
git commit -m "feat(graph): find nodes by title and centre the view on one

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

---

### Task 21: The legend as toggles, with "Show all" (part 7, draft label F7d)

**Files (repo: bai-knowledge-note):**
- Create `editors/knowledge-vault/components/graph/GraphLegend.tsx`
- Test: create `editors/knowledge-vault/components/graph/GraphLegend.test.tsx`

**Interfaces:**
- Consumes: F7a's `NODE_KINDS`, `NODE_KIND_LABEL`, `LINK_KINDS`, `LINK_KIND_LABEL`, `GraphFilter`, `EMPTY_GRAPH_FILTER`, `hidesAnything`, `toggleNodeKind`, `toggleLinkKind`. Also the existing `STATUS_COLOR_HEX`, `LINK_TYPE_COLOR_HEX` and `MOC_COLOR_HEX`.
- Produces: `GraphLegend(props: { filter: GraphFilter; onChange: (filter: GraphFilter) => void }): JSX.Element`. It is positioned absolutely at the bottom left, as the legend is today. F7f renders it in place of the inline legend.

- [ ] Step 1: write the failing test. Create `GraphLegend.test.tsx`:

```tsx
/**
 * The graph's legend is its filter: every entry is a toggle, a hidden one is
 * struck through, and "Show all" appears while anything is hidden.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GraphLegend } from "./GraphLegend.js";
import {
  EMPTY_GRAPH_FILTER,
  toggleLinkKind,
  toggleNodeKind,
  type GraphFilter,
} from "./model.js";

const noop = () => {};
const legend = (filter: GraphFilter) =>
  renderToStaticMarkup(<GraphLegend filter={filter} onChange={noop} />);
const toggles = (html: string) =>
  [
    ...html.matchAll(
      /<button[^>]*data-kind="([A-Z_]+)" aria-pressed="(true|false)"[^>]*>(.*?)<\/button>/g,
    ),
  ].map((m) => ({
    kind: m[1],
    shown: m[2] === "true",
    text: m[3].replace(/<[^>]+>/g, ""),
    struck: m[3].includes("line-through"),
  }));

describe("GraphLegend", () => {
  it("makes every node and link entry a toggle, in the spec's words, all shown", () => {
    const html = legend(EMPTY_GRAPH_FILTER);
    const all = toggles(html);
    expect(all.map((t) => t.kind)).toEqual([
      "DRAFT",
      "IN_REVIEW",
      "CANONICAL",
      "ARCHIVED",
      "MOC",
      "RELATES_TO",
      "BUILDS_ON",
      "CONTRADICTS",
      "SUPERSEDES",
      "DERIVED_FROM",
      "CORE_IDEA",
    ]);
    expect(all.map((t) => t.text)).toEqual([
      "Draft",
      "In review",
      "Canonical",
      "Archived",
      "MOC",
      "relates to",
      "builds on",
      "contradicts",
      "supersedes",
      "derived from",
      "core idea",
    ]);
    expect(all.every((t) => t.shown && !t.struck)).toBe(true);
    expect(html).not.toContain("Show all");
    expect(html).not.toMatch(/cites|delivered by/i);
  });

  it("strikes through what is hidden and offers Show all", () => {
    const filter = toggleLinkKind(
      toggleNodeKind(EMPTY_GRAPH_FILTER, "ARCHIVED"),
      "CORE_IDEA",
    );
    const html = legend(filter);
    const by = new Map(toggles(html).map((t) => [t.kind, t]));
    expect(by.get("ARCHIVED")).toMatchObject({ shown: false, struck: true });
    expect(by.get("CORE_IDEA")).toMatchObject({ shown: false, struck: true });
    expect(by.get("DRAFT")).toMatchObject({ shown: true, struck: false });
    expect(html).toMatch(/<button type="button"[^>]*>Show all<\/button>/);
  });
});
```

- [ ] Step 2: run `bunx vitest run editors/knowledge-vault/components/graph/GraphLegend.test.tsx`.
  Expected: FAIL. The suite cannot load `./GraphLegend.js` ("Failed to load url ./GraphLegend.js" / "Cannot find module").

- [ ] Step 3: implement. Create `GraphLegend.tsx`:

```tsx
import type { ReactNode } from "react";
import {
  EMPTY_GRAPH_FILTER,
  hidesAnything,
  LINK_KIND_LABEL,
  LINK_KINDS,
  LINK_TYPE_COLOR_HEX,
  MOC_COLOR_HEX,
  NODE_KIND_LABEL,
  NODE_KINDS,
  STATUS_COLOR_HEX,
  toggleLinkKind,
  toggleNodeKind,
  type GraphFilter,
  type LinkKind,
  type NodeKind,
} from "./model.js";

/*
 * The graph's legend, which is also its filter: each node and link entry
 * hides or shows its kind. Hidden entries are struck through, and "Show all"
 * appears while anything is hidden. The state belongs to the vault
 * (DriveExplorer), so it survives leaving the graph and coming back.
 */

function nodeSwatch(kind: NodeKind): ReactNode {
  if (kind === "MOC")
    return (
      <span
        className="inline-block h-3 w-3"
        style={{
          backgroundColor: MOC_COLOR_HEX,
          clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
        }}
      />
    );
  return (
    <span
      className="inline-block h-2.5 w-2.5 rounded-full"
      style={{ backgroundColor: STATUS_COLOR_HEX[kind] }}
    />
  );
}

function linkSwatch(kind: LinkKind): ReactNode {
  return (
    <span
      className="inline-block h-0 w-3 border-t-2"
      style={{
        borderColor:
          kind === "CORE_IDEA" ? MOC_COLOR_HEX : LINK_TYPE_COLOR_HEX[kind],
      }}
    />
  );
}

function LegendToggle(props: {
  kind: string;
  label: string;
  hidden: boolean;
  textColor: string;
  swatch: ReactNode;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      data-kind={props.kind}
      aria-pressed={!props.hidden}
      onClick={props.onToggle}
      className="flex items-center gap-1.5 rounded px-0.5"
      style={{ opacity: props.hidden ? 0.5 : 1 }}
    >
      {props.swatch}
      <span
        style={{
          color: props.textColor,
          textDecoration: props.hidden ? "line-through" : "none",
        }}
      >
        {props.label}
      </span>
    </button>
  );
}

export function GraphLegend(props: {
  filter: GraphFilter;
  onChange: (filter: GraphFilter) => void;
}) {
  const { filter, onChange } = props;
  return (
    <div
      role="group"
      aria-label="Legend"
      className="absolute bottom-4 left-4 z-10 flex flex-col gap-2 rounded-lg px-3 py-2.5 text-[10px] backdrop-blur-sm"
      style={{
        backgroundColor:
          "color-mix(in srgb, var(--bai-bg, #11111b) 90%, transparent)",
        border: "1px solid var(--bai-border, rgba(255,255,255,0.1))",
      }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {NODE_KINDS.map((kind) => (
          <LegendToggle
            key={kind}
            kind={kind}
            label={NODE_KIND_LABEL[kind]}
            hidden={filter.hiddenNodes.includes(kind)}
            textColor="var(--bai-text-tertiary, #9ca3af)"
            swatch={nodeSwatch(kind)}
            onToggle={() => onChange(toggleNodeKind(filter, kind))}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {LINK_KINDS.map((kind) => (
          <LegendToggle
            key={kind}
            kind={kind}
            label={LINK_KIND_LABEL[kind]}
            hidden={filter.hiddenLinks.includes(kind)}
            textColor="var(--bai-text-muted, #6b7280)"
            swatch={linkSwatch(kind)}
            onToggle={() => onChange(toggleLinkKind(filter, kind))}
          />
        ))}
      </div>
      {hidesAnything(filter) && (
        <button
          type="button"
          onClick={() => onChange(EMPTY_GRAPH_FILTER)}
          className="self-start underline"
          style={{ color: "var(--bai-text-secondary, #d4d4d8)" }}
        >
          Show all
        </button>
      )}
    </div>
  );
}
```

- [ ] Step 4: run `bunx vitest run editors/knowledge-vault/components/graph/GraphLegend.test.tsx`.
  Expected: PASS.

- [ ] Step 5: commit.

```bash
git add editors/knowledge-vault/components/graph/GraphLegend.tsx editors/knowledge-vault/components/graph/GraphLegend.test.tsx
git commit -m "feat(graph): the legend becomes the filter, with Show all

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

---

### Task 22: The find box (part 7, draft label F7e)

**Files (repo: bai-knowledge-note):**
- Create `editors/knowledge-vault/components/graph/GraphFind.tsx`
- Test: create `editors/knowledge-vault/components/graph/GraphFind.test.tsx`

**Interfaces:**
- Consumes: F7c's `FoundNode` (and `findNodes` in the test).
- Produces: `GraphFind(props: { search: (query: string) => FoundNode[]; onChoose: (id: string) => void; initialQuery?: string }): JSX.Element`. It is positioned absolutely at the top left. `initialQuery` exists for static-markup tests, following the `initialTyped` pattern in `TypeToConfirmDialog`.

- [ ] Step 1: write the failing test. Create `GraphFind.test.tsx`:

```tsx
/**
 * The graph's find box: from the second character it lists up to eight nodes
 * whose title contains the text, maps of content marked "topic".
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GraphFind } from "./GraphFind.js";
import {
  buildGraphModel,
  findNodes,
  indexGraph,
  type GraphNoteInput,
} from "./model.js";

const note = (id: string, title: string): GraphNoteInput => ({
  id,
  name: `${id}-slug`,
  title,
  status: "CANONICAL",
  links: [],
});
const g = indexGraph(
  buildGraphModel(
    [note("x", "Building agents"), note("y", "Agents first")],
    [{ id: "t", title: "Agent topics", tier: "TOPIC", coreIdeas: [], childRefs: [] }],
  ),
);
const noop = () => {};
const find = (initialQuery: string) =>
  renderToStaticMarkup(
    <GraphFind
      search={(q) => findNodes(g, q)}
      onChoose={noop}
      initialQuery={initialQuery}
    />,
  );
const options = (html: string) =>
  [
    ...html.matchAll(
      /<li[^>]*role="option" aria-selected="(true|false)" data-node-id="([^"]+)"[^>]*>(.*?)<\/li>/g,
    ),
  ].map((m) => ({
    id: m[2],
    selected: m[1] === "true",
    topic: m[3].includes(">topic</span>"),
  }));

describe("GraphFind", () => {
  it("is a labelled box with the spec's placeholder, and lists nothing before the second character", () => {
    for (const q of ["", "a"]) {
      const html = find(q);
      expect(html).toContain('placeholder="Find a note or topic"');
      expect(html).toContain('aria-expanded="false"');
      expect(html).not.toContain('role="listbox"');
    }
  });

  it("lists the matches, the first one ready for Enter, maps of content marked topic", () => {
    const html = find("agent");
    expect(html).toContain('aria-expanded="true"');
    expect(options(html)).toEqual([
      { id: "y", selected: true, topic: false },
      { id: "t", selected: false, topic: true },
      { id: "x", selected: false, topic: false },
    ]);
  });
});
```

- [ ] Step 2: run `bunx vitest run editors/knowledge-vault/components/graph/GraphFind.test.tsx`.
  Expected: FAIL. The suite cannot load `./GraphFind.js`.

- [ ] Step 3: implement. Create `GraphFind.tsx`:

```tsx
import { useId, useState, type KeyboardEvent } from "react";
import type { FoundNode } from "./model.js";

/*
 * Find a note or topic on the graph. From the second character it lists up
 * to eight nodes whose title contains the text; Enter or a click chooses one
 * (the view moves to it and it is selected, as a click on the canvas does),
 * the arrow keys move through the list, and Esc clears the box.
 */
export function GraphFind(props: {
  search: (query: string) => FoundNode[];
  onChoose: (id: string) => void;
  /** The text the box starts with (for tests). */
  initialQuery?: string;
}) {
  const [query, setQuery] = useState(props.initialQuery ?? "");
  const [active, setActive] = useState(0);
  const listId = useId();
  const results = props.search(query);
  const current = Math.min(active, Math.max(0, results.length - 1));
  const optionId = (i: number) => `${listId}-${i}`;

  function clear() {
    setQuery("");
    setActive(0);
  }
  function choose(found: FoundNode) {
    props.onChoose(found.id);
    clear();
  }
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      clear();
      return;
    }
    if (e.key === "Enter") {
      const found = results[current];
      if (found) {
        e.preventDefault();
        choose(found);
      }
      return;
    }
    if (results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((current + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((current - 1 + results.length) % results.length);
    }
  }

  return (
    <div className="absolute left-3 top-3 z-20 w-64">
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        placeholder="Find a note or topic"
        aria-label="Find a note or topic"
        role="combobox"
        aria-expanded={results.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          results.length > 0 ? optionId(current) : undefined
        }
        spellCheck={false}
        className="h-8 w-full rounded-md px-2.5 text-xs outline-none backdrop-blur-sm"
        style={{
          backgroundColor:
            "color-mix(in srgb, var(--bai-bg, #11111b) 90%, transparent)",
          color: "var(--bai-text, #e4e4e7)",
          border: "1px solid var(--bai-border, rgba(255,255,255,0.1))",
        }}
      />
      {results.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matching notes and topics"
          className="mt-1 overflow-hidden rounded-md text-xs shadow-lg"
          style={{
            backgroundColor: "var(--bai-surface, #181825)",
            border: "1px solid var(--bai-border, rgba(255,255,255,0.1))",
          }}
        >
          {results.map((found, i) => (
            <li
              key={found.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === current}
              data-node-id={found.id}
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => {
                if (i !== current) setActive(i);
              }}
              onClick={() => choose(found)}
              className="flex cursor-pointer items-center justify-between gap-2 px-2.5 py-1.5"
              style={{
                backgroundColor:
                  i === current
                    ? "color-mix(in srgb, var(--bai-accent, #cba6f7) 18%, transparent)"
                    : "transparent",
                color: "var(--bai-text, #e4e4e7)",
              }}
            >
              <span className="truncate">{found.label}</span>
              {found.isMoc && (
                <span
                  className="shrink-0 text-[10px]"
                  style={{ color: "var(--bai-text-muted, #9ca3af)" }}
                >
                  topic
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] Step 4: run `bunx vitest run editors/knowledge-vault/components/graph/GraphFind.test.tsx`.
  Expected: PASS.

- [ ] Step 5: commit.

```bash
git add editors/knowledge-vault/components/graph/GraphFind.tsx editors/knowledge-vault/components/graph/GraphFind.test.tsx
git commit -m "feat(graph): a find box for notes and topics

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

---

### Task 23: Wire find and filter into GraphView, with the state in DriveExplorer (part 7, draft label F7f)

**Files (repo: bai-knowledge-note):**
- Modify `editors/knowledge-vault/components/GraphView.tsx`:
  - imports `:18-37`;
  - props `:87-107`;
  - `Scene` `:147-208`;
  - `FIT_INSETS` `:253`;
  - refs `:281-292`;
  - the scene literal `:409-452`;
  - the three `hitTest` calls `:515`, `:595`, `:655`;
  - the `sameStructure` branch `:878-906`;
  - the data effect `:937` / `:973`;
  - the JSX `:1110-1168`;
  - `refreshHighlight` `:1274-1291`.
- Modify `editors/knowledge-vault/components/DriveExplorer.tsx`: imports (`:55`), state after `:259`, and the `<GraphView>` element at `:842-849`.
- Test: no new unit test. The pure logic is covered by F7a–F7e. Verification is `bun run tsc`, `bun run lint:fix`, the graph test folder and the manual pass below.

**Interfaces:**
- Consumes: everything F7a–F7e produce.
- Produces: `GraphViewProps` gains the **required** props `filter: GraphFilter` and `onFilterChange: (filter: GraphFilter) => void`.

- [ ] Step 1: no failing unit test for this task, because the canvas wiring has no harness. Before starting, confirm the baseline passes: `bunx vitest run editors/knowledge-vault/components/graph`.
  Expected: PASS.

- [ ] Step 2: implement `GraphView.tsx`.

  **2a. Imports.** Replace the `./graph/model.js` import block (lines 18-37) with:

```ts
import {
  applyHighlight,
  buildGraphModel,
  centerOn,
  computeVisibility,
  easeFactor,
  easeTowards,
  edgeAttributes,
  findNodes,
  fitView,
  hitTest,
  indexGraph,
  linkKindCode,
  mergePositions,
  neighbourhood,
  nodeAttributes,
  nodeKindCode,
  packGraph,
  sameStructure,
  showNodeKind,
  type GraphFilter,
  type IndexedGraph,
  type Point,
  type Visibility,
} from "./graph/model.js";
import { GraphFind } from "./graph/GraphFind.js";
import { GraphLegend } from "./graph/GraphLegend.js";
```

  **2b. Props.** In `GraphViewProps`, after `inlineLayout?: boolean;` (line 106), add:

```ts
  /** What the legend hides. Held by the vault (DriveExplorer) while it is open; never saved. */
  filter: GraphFilter;
  onFilterChange: (filter: GraphFilter) => void;
```

  **2c. Scene.** In `type Scene`, after `highlight: Uint8Array;` (line 160), add:

```ts
  /** The legend's mask (computeVisibility), or null when nothing is hidden. Applied with the highlight. */
  visible: Visibility | null;
```

In the scene literal, after `highlight: new Uint8Array(0),` (line 421), add:

```ts
      visible: null,
```

  **2d. Fit insets.** Replace line 253 `const FIT_INSETS = { top: 40, right: 72, bottom: 96, left: 40 };` with:

```ts
// top clears the find box (12 px down, 32 px tall).
const FIT_INSETS = { top: 56, right: 72, bottom: 96, left: 40 };
```

  **2e. Refs.** After `layoutKeyRef.current = props.layoutKey;` (line 292), add:

```ts
  const filterRef = useRef(props.filter);
  filterRef.current = props.filter;
```

  **2f. hitTest callers.** Pass the node mask as the sixth argument at all three call sites:
  - line 515: `setHover(hitTest(g, draw.pos, p.x, p.y, hitPad(scene.view)), at);` becomes
    `setHover(hitTest(g, draw.pos, p.x, p.y, hitPad(scene.view), scene.visible?.node ?? null), at);`
  - line 595: `over ? hitTest(g, draw.pos, p.x, p.y, hitPad(scene.view)) : -1,` becomes
    `over ? hitTest(g, draw.pos, p.x, p.y, hitPad(scene.view), scene.visible?.node ?? null) : -1,`
  - line 655: `const hit = hitTest(g, draw.pos, p.x, p.y, hitPad(scene.view));` becomes
    `const hit = hitTest(g, draw.pos, p.x, p.y, hitPad(scene.view), scene.visible?.node ?? null);`

  **2g. The sameStructure branch.** In the loop at `:886-896`, after `prev.radius[i] = spec.radius;` (line 891), add:

```ts
        prev.nodeKind[i] = nodeKindCode(spec);
```

Then, right after that loop's closing `}` (line 896) and before `if (resized) {` (line 897), add:

```ts
      // A status or a link type can change without the structure changing:
      // sort them into the legend's kinds again, so the filter follows.
      const byId = new Map(model.links.map((l) => [l.id, l]));
      prev.links.forEach((l, k) => {
        const next = byId.get(l.id);
        if (next) prev.linkKind[k] = linkKindCode(next);
      });
      scene.visible = computeVisibility(prev, filterRef.current, scene.visible);
      refreshHighlight(scene);
```

  **2h. A new graph.** After `scene.highlight = new Uint8Array(g.nodes.length);` (line 937), add:

```ts
    scene.visible = computeVisibility(g, filterRef.current, null);
```

The existing `refreshHighlight(scene);` at line 973 then draws it.

  **2i. The filter effect and the find handler.** Insert both after the `clearFocusNonce` effect, i.e. after line 363 (`}, [props.clearFocusNonce]);`):

```ts
  // The legend changed: one pass to rebuild the mask, the highlight pass to
  // draw it. The layout is not told: hidden nodes keep their places.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!ready || !scene) return;
    const g = scene.graph;
    scene.visible = g ? computeVisibility(g, props.filter, scene.visible) : null;
    // What is under a resting pointer may now be hidden.
    scene.hoverStale = true;
    refreshHighlight(scene);
    // A selected node that is now hidden cannot stay selected.
    const id = selectedIdRef.current;
    const i = id && g ? g.index.get(id) : undefined;
    if (i !== undefined && scene.visible && scene.visible.node[i] === 0)
      select(-1, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, props.filter]);

  /** The find box chose a node: show its kind if hidden, move to it, select it. */
  function chooseFound(id: string) {
    const scene = sceneRef.current;
    const g = scene?.graph;
    const draw = scene?.draw;
    if (!scene || !g || !draw) return;
    const i = g.index.get(id);
    if (i === undefined) return;
    if (scene.visible && scene.visible.node[i] === 0) {
      const next = showNodeKind(filterRef.current, g.nodes[i]);
      filterRef.current = next;
      // Drawn at once; the parent's state catches up on its next render.
      scene.visible = computeVisibility(g, next, scene.visible);
      props.onFilterChange(next);
    }
    const x = draw.pos[i * 2];
    const y = draw.pos[i * 2 + 1];
    let at: Point | null = null;
    if (Number.isFinite(x) && Number.isFinite(y)) {
      // The user chose where to look: no auto-fit takes the view back.
      userInteractedRef.current = true;
      scene.view = centerOn(scene.view, x, y, scene.width, scene.height, 1);
      scene.dirty = true;
      at = { x: scene.width / 2, y: scene.height / 2 };
    }
    select(i, at);
  }

  function findOnGraph(query: string) {
    const g = sceneRef.current?.graph;
    return g ? findNodes(g, query) : [];
  }
```

(`select` calls `refreshHighlight`, which now applies `scene.visible`, so the newly shown kind and the highlight land in the same pass.)

  **2j. JSX.** Replace everything from `{/* Legend */}` (line 1110) up to, but not including, `{/* Hover tooltip — only when nothing is selected` (line 1170), which is the whole legend `<div>…</div>`, with:

```tsx
      <GraphFind search={findOnGraph} onChoose={chooseFound} />

      <GraphLegend filter={props.filter} onChange={props.onFilterChange} />

```

  **2k. refreshHighlight.** Replace the `applyHighlight(` call inside `refreshHighlight` (lines 1282-1288) with:

```ts
  applyHighlight(
    g,
    set ? flags : null,
    draw.nodeColor,
    draw.edgeColor,
    scene.edgePrimary,
    scene.visible,
  );
```

After 2a, `LINK_TYPE_COLOR_HEX`, `MOC_COLOR_HEX` and `STATUS_COLOR_HEX` are no longer imported by GraphView, because the legend moved to `GraphLegend.tsx`. Make sure no other reference to them remains in the file: `grep -n "COLOR_HEX" editors/knowledge-vault/components/GraphView.tsx` should print nothing.

- [ ] Step 3: implement `DriveExplorer.tsx`.
  - After line 55 (`import GraphView, { type GraphFocus } from "./GraphView.js";`), add:

```ts
import { EMPTY_GRAPH_FILTER, type GraphFilter } from "./graph/model.js";
```

  - After line 259 (`const [graphClearNonce, setGraphClearNonce] = useState(0);`), add:

```ts
  // The graph's legend filter: kept while the vault is open, never saved.
  const [graphFilter, setGraphFilter] = useState<GraphFilter>(EMPTY_GRAPH_FILTER);
```

  - In the `<GraphView … />` element (`:842-849`), after `layoutKey={driveId ?? undefined}`, add:

```tsx
        filter={graphFilter}
        onFilterChange={setGraphFilter}
```

- [ ] Step 4: verify.
  - `bunx vitest run editors/knowledge-vault/components/graph editors/knowledge-vault/components/VaultPlaces.test.tsx`. Expected: PASS. The second file imports `DriveExplorer.js`, so this also checks that the module loads.
  - `bun run tsc`. Expected: no errors.
  - `bun run lint:fix`. Expected: no errors. In particular, no unused imports in `GraphView.tsx`.
  - Manual check in Vetra Studio (`ph vetra` is already running, and the watcher rebuilds the editor). Open a vault, then open Graph:
    1. Type one letter in "Find a note or topic": no list appears. Type a second letter: up to 8 titles appear, and maps of content say "topic". Press Esc: the box empties.
    2. Choose a result with Enter: the view centres on it at 1× or closer, its neighbourhood lights up, its card opens, and the sidebar lists its connections.
    3. Click "MOC" in the legend: it is struck through, the diamonds and their core-idea lines disappear, and nothing else moves. "Show all" appears. Hovering where a MoC was finds the note beneath it or nothing.
    4. Find a map of content while MOC is hidden and choose it: MOC is shown again and the map is selected.
    5. Hide "relates to": only those lines go. Click "Show all": everything is back and "Show all" goes away.
    6. Select a canonical note, then hide "Canonical": the card closes and the sidebar returns to its default.
    7. Switch to Notes and back to Graph: the filter is still set. Reload the page: the filter is gone (not saved).
    8. Repeat steps 3 and 5 in the desktop app (`knowledge-vault-app`). It uses the same editor bundle.

- [ ] Step 5: commit.

```bash
git add editors/knowledge-vault/components/GraphView.tsx editors/knowledge-vault/components/DriveExplorer.tsx
git commit -m "feat(graph): find a note and filter by the legend; the filter lives in the vault

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Part 4: Getting started guide (§4)

# Part 4 (spec §4): the Getting started guide describes the app as it is

## Notes for the assembler

- Repo for both tasks: `bai-knowledge-note` (branch ui-upgrade). Nothing in `knowledge-vault-app`.
- **Cross-part files.** `DriveExplorer.tsx` is also edited by §10 (graph filter state) and §3 (paste text queues). F1 touches only three spots: a new `GUIDE_PLACES` const right after `buildPlaces`, `export` on `CREATE_ITEMS` (`:1018`), and the `<GettingStartedModal>` line (`:987`). No overlap with their regions, but apply F1 by the text anchors, not the line numbers. `CREATE_ITEMS` labels ("Write a note", "New topic", "Paste text as a source") are what the guide prints; if §3 renames "Paste text as a source" the guide follows by itself and the test still passes.
- **Spec correction: no import cycle.** The spec says the guide renders "from `buildPlaces` / `VAULT_MENU` / `CREATE_ITEMS`". `GettingStarted.tsx` importing `DriveExplorer.tsx` would be a cycle (`DriveExplorer` already imports `GettingStartedModal`), and `check-circular-imports` (dpdm) runs on this repo. Decision: `DriveExplorer` passes the three lists to the modal as props (`places`, `menu`, `createItems`); the guide imports only the TYPES `VaultPlace` and `VaultMenuItem`. The test imports both modules and feeds the real exports, so the "only names that exist" check is the same.
- **`GUIDE_PLACES`** (new, exported from `DriveExplorer.tsx`) is `buildPlaces` with `contradictions: 1`, so the guide always lists Contradictions (spec: "Listed while any are open"). The sidebar's own `places` (`:506`) is not used for the guide.
- **Spec correction: `resolveReactorEndpoint()` already ends in `/graphql`** (`shared/subgraph-endpoint.ts:83-86`), so the command is `switchboard init --url ${resolveReactorEndpoint()} --name <vault> --use-profile`, not `<origin>/graphql` appended again. Off a known host it returns the relative `/graphql`; that is what the existing code gives and is shown as is.
- **Decision: the guide does not know the vault's name**, so the command shows the literal placeholder `<vault>`.
- **Decision: dropped as stale** beyond the spec's list: the "Source Types" grid (ARTICLE, PAPER, ...; the add-source form it described is gone, Add sources converts files), the "Typical Workflow" paragraph (it repeated the removed "Queue for Processing" / `/pipeline` flow), the `.mcp.json` snippet, and the "Setup — Local / Remote" headings. The section list stays six, same ids (`overview`, `sources`, `notes`, `pipeline`, `graph`, `plugin`), labels in sentence case: Overview, Adding sources, Notes, Processing, Graph and links, AI agent. Title becomes "Getting started".
- **Step layout changed** from title-over-body to one line, "**Title** — body", so the spec's copy ("Add sources — drop files on the window or press Add sources.") is verbatim.
- **§10 and §3 are only described.** The Graph line says "Find a note, or hide kinds of notes from the legend." and the paste line says it is queued when added. If §10 or §3 slip, the guide would describe something missing: land F2 after them.
- **Bridges**: removed. If the health work (D) later adds it to a health view, it must also be added to the Graph and links section (spec).
- Test env: static markup (`renderToStaticMarkup`), like `VaultPlaces.test.tsx`. Desktop vs web is switched with `setHostConfig` from `editors/shared/host-config.ts`.
- Not verified against the running app: "See runs" (a pipeline chip in the host app, spec §1/§2) and "Settings › Diagnostics" are host-app strings (`knowledge-vault-app`), copied from the spec.

---

### Task 24: Hand the guide the real places, menu and create items (part 4, draft label F1)

**Files:** (repo: `bai-knowledge-note`)
- Modify: `editors/knowledge-vault/components/DriveExplorer.tsx`: add `GUIDE_PLACES` after `buildPlaces` (ends at `:189`, before the `RENDERED_VIEWS` comment at `:191`); `<GettingStartedModal ... />` at `:987`; `const CREATE_ITEMS` at `:1018` gains `export`.
- Test: `editors/knowledge-vault/components/GuideSources.test.tsx` (create)

**Interfaces:**
- Consumes: `buildPlaces(counts, current?)`, `PLACE_VIEW`, `VAULT_MENU` (already exported), `VaultPlace`.
- Produces: `export const GUIDE_PLACES: VaultPlace[]`; `export const CREATE_ITEMS`; the modal's new props (F2 defines them): `places: VaultPlace[]`, `menu: VaultMenuItem[]`, `createItems: ReadonlyArray<VaultMenuItem>`.

- [ ] **Step 1: write the failing test** — create `editors/knowledge-vault/components/GuideSources.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import {
  CREATE_ITEMS,
  GUIDE_PLACES,
  PLACE_VIEW,
  VAULT_MENU,
} from "./DriveExplorer.js";

describe("what the Getting started guide is built from", () => {
  it("lists every place the sidebar can show, Contradictions included, in the sidebar's order", () => {
    expect(GUIDE_PLACES.map((p) => p.id)).toEqual([
      "ask",
      "notes",
      "topics",
      "sources",
      "work",
      "graph",
      "contradictions",
    ]);
    expect([...GUIDE_PLACES.map((p) => p.id)].sort()).toEqual(
      Object.keys(PLACE_VIEW).sort(),
    );
  });

  it("exposes the vault menu and the create items with their labels", () => {
    expect(VAULT_MENU.map((i) => i.label)).toEqual([
      "Vault settings",
      "Who has access",
      "Processing queue",
      "Activity",
      "Health check",
      "Files and folders",
    ]);
    expect(CREATE_ITEMS.map((i) => i.label)).toEqual([
      "Write a note",
      "New topic",
      "Paste text as a source",
    ]);
  });
});
```

- [ ] **Step 2: run** — `bunx vitest run editors/knowledge-vault/components/GuideSources.test.tsx`
  Expected: FAIL — `GUIDE_PLACES` and `CREATE_ITEMS` are `undefined` (not exported), e.g. `Cannot read properties of undefined (reading 'map')`.

- [ ] **Step 3: implement** in `editors/knowledge-vault/components/DriveExplorer.tsx`.

  (a) Find the end of `buildPlaces` and the comment that follows:

```ts
  return all.filter(
    (p) =>
      PLACE_VIEW[p.id] !== undefined &&
      (p.id !== "contradictions" || counts.contradictions > 0 || current === "contradictions"),
  );
}

/**
 * Every view mode the content area renders.
```

  Replace with:

```ts
  return all.filter(
    (p) =>
      PLACE_VIEW[p.id] !== undefined &&
      (p.id !== "contradictions" || counts.contradictions > 0 || current === "contradictions"),
  );
}

/**
 * Every place the vault can list, for the Getting started guide: Contradictions
 * is in it (the sidebar shows it only while some are open). The guide prints
 * these labels, so a renamed place renames itself there.
 */
export const GUIDE_PLACES: VaultPlace[] = buildPlaces({
  notes: 0,
  topics: 0,
  sources: 0,
  work: 0,
  contradictions: 1,
});

/**
 * Every view mode the content area renders.
```

  (b) Replace the line `{guideOpen && <GettingStartedModal onClose={() => setGuideOpen(false)} />}` with:

```tsx
      {guideOpen && (
        <GettingStartedModal
          places={GUIDE_PLACES}
          menu={VAULT_MENU}
          createItems={CREATE_ITEMS}
          onClose={() => setGuideOpen(false)}
        />
      )}
```

  (c) Replace `const CREATE_ITEMS = [` with `export const CREATE_ITEMS = [`.

  Note: `bun run tsc` fails on (b) until F2 adds the props; do F1 and F2 back to back, and run tsc at the end of F2. The F1 test does not depend on it.

- [ ] **Step 4: run** — `bunx vitest run editors/knowledge-vault/components/GuideSources.test.tsx`
  Expected: PASS (2 tests).

- [ ] **Step 5: commit** — do this together with F2 if tsc is checked per commit; otherwise:
  `git add editors/knowledge-vault/components/DriveExplorer.tsx editors/knowledge-vault/components/GuideSources.test.tsx` and message:

```
feat(guide): export the places and create items the guide is built from

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

---

---

### Task 25: Rewrite the guide, rendered from the real places and menus (part 4, draft label F2)

**Files:** (repo: `bai-knowledge-note`)
- Modify (replace whole file, currently 685 lines): `editors/knowledge-vault/components/GettingStarted.tsx`
- Test: `editors/knowledge-vault/components/GettingStarted.test.tsx` (create)

**Interfaces:**
- Consumes: F1's `GUIDE_PLACES`, `VAULT_MENU`, `CREATE_ITEMS`; `VaultPlace` (`VaultPlaces.tsx`), `VaultMenuItem` (`VaultMenu.tsx`); `isDesktopHost()` (`shared/host-config.ts`); `resolveReactorEndpoint()` (`shared/subgraph-endpoint.ts`).
- Produces:
  - `GettingStartedModal({ onClose, places, menu, createItems })`, props `places: VaultPlace[]`, `menu: VaultMenuItem[]`, `createItems: ReadonlyArray<VaultMenuItem>`.
  - `GUIDE_SECTIONS: { id: GuideSectionId; label: string }[]` and `GuideContent({ section, places, menu, createItems })` (the body without the modal frame, for tests).
  - Markup contract the test relies on: `data-guide-place="<place id>"` on each Find-your-way row; `data-ref="<kind>:<key>"` (kind `place`, `menu` or `create`) on every printed menu or create entry name.

- [ ] **Step 1: write the failing test** — create `editors/knowledge-vault/components/GettingStarted.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { setHostConfig } from "../../shared/host-config.js";
import {
  CREATE_ITEMS,
  GUIDE_PLACES,
  PLACE_VIEW,
  VAULT_MENU,
} from "./DriveExplorer.js";
import {
  GettingStartedModal,
  GUIDE_SECTIONS,
  GuideContent,
} from "./GettingStarted.js";

const lists = { places: GUIDE_PLACES, menu: VAULT_MENU, createItems: CREATE_ITEMS };

function section(id: (typeof GUIDE_SECTIONS)[number]["id"], over: Partial<typeof lists> = {}) {
  return renderToStaticMarkup(<GuideContent section={id} {...lists} {...over} />);
}

/** The words a reader sees: tags gone, entities decoded. */
function text(html: string) {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function refs(html: string) {
  return [...html.matchAll(/data-ref="([a-z]+):([A-Za-z0-9_-]+)"/g)].map((m) => ({
    kind: m[1],
    key: m[2],
  }));
}

const desktop = () =>
  setHostConfig({ kind: "desktop", switchboardOrigin: "http://127.0.0.1:4201" });

afterEach(() => setHostConfig(undefined));

describe("Getting started guide", () => {
  it("keeps six sections in sentence case", () => {
    expect(GUIDE_SECTIONS.map((s) => s.label)).toEqual([
      "Overview",
      "Adding sources",
      "Notes",
      "Processing",
      "Graph and links",
      "AI agent",
    ]);
    const modal = renderToStaticMarkup(<GettingStartedModal onClose={() => {}} {...lists} />);
    for (const s of GUIDE_SECTIONS) expect(modal).toContain(`>${s.label}<`);
    expect(modal).toContain(">Getting started<");
  });

  it("describes each place, one line per place the sidebar can show", () => {
    const html = section("overview");
    const rows = [...html.matchAll(/data-guide-place="([a-z]+)"/g)].map((m) => m[1]);
    expect(rows).toEqual(GUIDE_PLACES.map((p) => p.id));
    expect([...rows].sort()).toEqual(Object.keys(PLACE_VIEW).sort());
    const t = text(html);
    expect(t).toContain("AskAsk the vault a question; the answer names the notes it used.");
    expect(t).toContain("NotesEvery note: one idea each, with its links and its source.");
    expect(t).toContain("TopicsMaps of your topics, from the vault's top map down.");
    expect(t).toContain("SourcesWhat you added, and what became of each.");
    expect(t).toContain("WorkScopes of work, their projects, and the breakdowns that deliver them.");
    expect(t).toContain("GraphHow notes connect. Find a note, or hide kinds of notes from the legend.");
    expect(t).toContain("ContradictionsNotes that disagree. Listed while any are open.");
  });

  it("takes the place names from the places it is given, so a rename shows up", () => {
    const renamed = GUIDE_PLACES.map((p) => (p.id === "notes" ? { ...p, label: "Library" } : p));
    const t = text(section("overview", { places: renamed }));
    expect(t).toContain("LibraryEvery note: one idea each");
    expect(t).not.toContain("NotesEvery note");
  });

  it("names every vault menu entry and every create item, from the real lists", () => {
    const html = section("overview");
    const t = text(html);
    expect(t).toContain(
      "Under the vault's name, and at the foot (Vault settings): Vault settings, Who has access, Processing queue, Activity, Health check and Files and folders.",
    );
    expect(t).toContain(
      "Add sources takes files; the arrow beside it offers Write a note, New topic and Paste text as a source.",
    );
    expect(t).toContain("Search (Ctrl K, or ⌘ K on a Mac) finds notes, topics, sources and chats.");
    const r = refs(html);
    expect(r.filter((x) => x.kind === "menu").map((x) => x.key)).toEqual(VAULT_MENU.map((i) => i.key));
    expect(r.filter((x) => x.kind === "create").map((x) => x.key)).toEqual(CREATE_ITEMS.map((i) => i.key));
  });

  it("names only places and menu entries that exist, in every section", () => {
    for (const host of [desktop, () => setHostConfig(undefined)]) {
      host();
      for (const s of GUIDE_SECTIONS) {
        for (const r of refs(section(s.id))) {
          const real =
            r.kind === "menu"
              ? VAULT_MENU.map((i) => i.key)
              : r.kind === "create"
                ? CREATE_ITEMS.map((i) => i.key)
                : GUIDE_PLACES.map((p) => p.id);
          expect(real, `${s.id}: ${r.kind}:${r.key}`).toContain(r.key);
        }
      }
    }
  });

  it("renames a menu entry in the prose that points at it", () => {
    const menu = VAULT_MENU.map((i) => (i.key === "pipeline" ? { ...i, label: "Work queue" } : i));
    expect(text(section("pipeline", { menu }))).toContain("Work queue is in the vault menu.");
    expect(text(section("graph", { menu }))).not.toContain("Processing queue");
  });

  it("gives the desktop and the web their own quick start", () => {
    desktop();
    const d = text(section("overview"));
    expect(d).toContain("Add sources — drop files on the window or press Add sources.");
    expect(d).toContain(
      "Processing — the app reads each source in the background and writes its notes; the status at the top of the window says how it is going.",
    );
    expect(d).toContain("Review — new notes wait in review; open one, check it, and Approve it.");
    expect(d).toContain("Ask — the answer names the notes it used.");
    setHostConfig(undefined);
    const w = text(section("overview"));
    expect(w).toContain(
      "Processing — if this vault's server runs the pipeline, sources are processed on their own; otherwise an AI agent processes them (see AI agent).",
    );
    expect(w).not.toContain("the app reads each source in the background");
    expect(w).toContain("Review — new notes wait in review; open one, check it, and Approve it.");
  });

  it("describes adding sources as the app does it now", () => {
    const t = text(section("sources"));
    expect(t).toContain("Add sources converts a PDF, a Word file, a web page or a book");
    expect(t).toContain("shows the sources it would create before anything is written");
    expect(t).toContain("Each one is queued for processing.");
    expect(t).toContain("Paste text as a source, which is queued when added.");
    expect(t).toContain("Inbox → Extracting → Extracted, or Archived");
    expect(t).toContain("Editing a source returns it to Inbox.");
    expect(t).toContain('"Delete source" is on each source\'s row.');
  });

  it("names the four processing steps with their phases, and says where it runs", () => {
    desktop();
    const d = text(section("pipeline"));
    expect(d).toContain("Extract");
    expect(d).toContain("Connect");
    expect(d).toContain("Place in topics");
    expect(d).toContain("Verify");
    for (const phase of ["create", "reflect", "reweave", "verify"]) expect(d).toContain(phase);
    expect(d).toContain("It runs on its own; See runs, at the top of the window, opens each run in Workflows.");
    expect(d).toContain("Processing queue is in the vault menu.");
    expect(d).toContain("The Verify step finishes a source's task; its notes stay in review for you.");
    setHostConfig(undefined);
    expect(text(section("pipeline"))).toContain(
      "It runs where this vault's server runs the pipeline, or from an AI agent.",
    );
  });

  it("describes the graph, find and filter, and health without Bridges", () => {
    const t = text(section("graph"));
    expect(t).toContain("Find a note, or hide kinds of notes from the legend.");
    expect(t).toContain("Health check (in the vault menu) shows orphans, link density and dangling links.");
    expect(t).toContain("The graph updates on its own when notes change.");
    for (const kind of ["RELATES_TO", "BUILDS_ON", "CONTRADICTS", "SUPERSEDES", "DERIVED_FROM"]) {
      expect(t).toContain(kind);
    }
    expect(t).not.toContain("Bridges");
  });

  it("tells the desktop where the agent's settings are, and the web how to point the CLI", () => {
    desktop();
    const d = text(section("plugin"));
    expect(d).toContain(
      "Settings › Diagnostics shows the two things an agent needs: the Switchboard CLI command for this vault and the MCP address.",
    );
    setHostConfig(undefined);
    const w = text(section("plugin"));
    expect(w).toContain("switchboard init --url /graphql --name <vault> --use-profile");
    for (const t2 of [d, w]) {
      expect(t2).toContain("claude plugin marketplace add liberuum/powerhouse-knowledge");
      expect(t2).toContain("claude plugin install powerhouse-knowledge@powerhouse-knowledge");
      for (const c of ["setup", "seed", "extract", "connect", "verify", "pipeline", "health", "graph", "search"]) {
        expect(t2).toContain(`/powerhouse-knowledge:${c}`);
      }
    }
  });

  it("no longer carries the stale passages", () => {
    desktop();
    const all = GUIDE_SECTIONS.map((s) => text(section(s.id))).join("\n");
    setHostConfig(undefined);
    const web = GUIDE_SECTIONS.map((s) => text(section(s.id))).join("\n");
    for (const body of [all, web]) {
      for (const stale of [
        "Navigation Tabs",
        "Pipeline tab",
        "Health tab",
        "Graph tab",
        "Notes tab",
        "Queue for Processing",
        "Ingest Source",
        "Add Source in the top bar",
        "New > Knowledge Note",
        "top bar menu",
        "Bridges",
        "next tab switch",
        "--plugin-dir",
        ".mcp.json",
        "249",
        "Ars Contexta",
        "/research/",
        "Run /pipeline",
        "run /pipeline",
        "Config",
      ]) {
        expect(body, stale).not.toContain(stale);
      }
    }
  });
});
```

- [ ] **Step 2: run** — `bunx vitest run editors/knowledge-vault/components/GettingStarted.test.tsx`
  Expected: FAIL — `GUIDE_SECTIONS` / `GuideContent` are not exported from `./GettingStarted.js` (`TypeError: Cannot read properties of undefined (reading 'map')` or `GuideContent is not defined`).

- [ ] **Step 3: implement** — replace the whole of `editors/knowledge-vault/components/GettingStarted.tsx` (find: the file starts with `import { useState } from "react";` and `export function GettingStartedModal({ onClose }: { onClose: () => void }) {`) with:

```tsx
import { useState } from "react";
import { isDesktopHost } from "../../shared/host-config.js";
import { resolveReactorEndpoint } from "../../shared/subgraph-endpoint.js";
import type { VaultMenuItem } from "./VaultMenu.js";
import type { VaultPlace } from "./VaultPlaces.js";

/**
 * The lists the guide is printed from. `DriveExplorer` passes its own
 * `GUIDE_PLACES`, `VAULT_MENU` and `CREATE_ITEMS`, so a renamed place or menu
 * entry renames itself here. This file imports only types from the vault's
 * views: importing `DriveExplorer` would be a cycle.
 */
export type GuideLists = {
  places: VaultPlace[];
  menu: VaultMenuItem[];
  createItems: ReadonlyArray<VaultMenuItem>;
};

export const GUIDE_SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "sources", label: "Adding sources" },
  { id: "notes", label: "Notes" },
  { id: "pipeline", label: "Processing" },
  { id: "graph", label: "Graph and links" },
  { id: "plugin", label: "AI agent" },
] as const;

export type GuideSectionId = (typeof GUIDE_SECTIONS)[number]["id"];

/** What each place holds, by place id. The place's name comes from the list it is given. */
const PLACE_DESC: Record<string, string> = {
  ask: "Ask the vault a question; the answer names the notes it used.",
  notes: "Every note: one idea each, with its links and its source.",
  topics: "Maps of your topics, from the vault's top map down.",
  sources: "What you added, and what became of each.",
  work: "Scopes of work, their projects, and the breakdowns that deliver them.",
  graph: "How notes connect. Find a note, or hide kinds of notes from the legend.",
  contradictions: "Notes that disagree. Listed while any are open.",
};

/** The guide, opened from the sidebar's foot ("Getting started"). */
export function GettingStartedModal({
  onClose,
  places,
  menu,
  createItems,
}: { onClose: () => void } & GuideLists) {
  const [activeSection, setActiveSection] = useState<GuideSectionId>("overview");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className="relative z-10 flex h-[80vh] w-[720px] max-w-[90vw] flex-col rounded-2xl shadow-2xl"
        style={{
          backgroundColor: "var(--bai-surface)",
          border: "1px solid var(--bai-border)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: "1px solid var(--bai-border)" }}
        >
          <div>
            <h2
              className="text-lg font-bold"
              style={{ color: "var(--bai-text)" }}
            >
              Getting started
            </h2>
            <p className="text-xs" style={{ color: "var(--bai-text-muted)" }}>
              Learn how to use the Knowledge Vault
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-2 transition-colors"
            style={{ color: "var(--bai-text-muted)" }}
          >
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Left nav */}
          <div
            className="w-44 shrink-0 py-3"
            style={{ borderRight: "1px solid var(--bai-border)" }}
          >
            {GUIDE_SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveSection(s.id)}
                className="flex w-full px-4 py-2 text-left text-xs transition-colors"
                style={{
                  backgroundColor:
                    activeSection === s.id
                      ? "var(--bai-accent-soft)"
                      : "transparent",
                  color:
                    activeSection === s.id
                      ? "var(--bai-accent)"
                      : "var(--bai-text-tertiary)",
                  fontWeight: activeSection === s.id ? 500 : 400,
                }}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <GuideContent
              section={activeSection}
              places={places}
              menu={menu}
              createItems={createItems}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/** One section's body, without the modal's frame. */
export function GuideContent({
  section,
  places,
  menu,
  createItems,
}: { section: GuideSectionId } & GuideLists) {
  switch (section) {
    case "overview":
      return <OverviewSection places={places} menu={menu} createItems={createItems} />;
    case "sources":
      return <SourcesSection />;
    case "notes":
      return <NotesSection createItems={createItems} />;
    case "pipeline":
      return <ProcessingSection menu={menu} />;
    case "graph":
      return <GraphSection menu={menu} />;
    case "plugin":
      return <PluginSection />;
  }
}

const H = ({ children }: { children: React.ReactNode }) => (
  <h3
    className="mb-3 text-sm font-semibold"
    style={{ color: "var(--bai-text)" }}
  >
    {children}
  </h3>
);
const P = ({ children }: { children: React.ReactNode }) => (
  <p
    className="mb-4 text-xs leading-relaxed"
    style={{ color: "var(--bai-text-tertiary)" }}
  >
    {children}
  </p>
);
/** One numbered line: "Title — what to do". */
const Step = ({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) => (
  <div className="mb-4 flex gap-3">
    <span
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
      style={{
        backgroundColor: "var(--bai-accent-soft)",
        color: "var(--bai-accent)",
      }}
    >
      {n}
    </span>
    <p className="text-xs" style={{ color: "var(--bai-text-muted)" }}>
      <b style={{ color: "var(--bai-text)", fontWeight: 500 }}>{title}</b>
      {" — "}
      {children}
    </p>
  </div>
);
const Tip = ({ children }: { children: React.ReactNode }) => (
  <div
    className="mb-4 rounded-lg px-4 py-3"
    style={{
      border: "1px solid var(--bai-accent-soft)",
      backgroundColor: "var(--bai-accent-soft)",
    }}
  >
    <p className="text-xs" style={{ color: "var(--bai-accent)", opacity: 0.8 }}>
      {children}
    </p>
  </div>
);
const Row = ({
  name,
  nameWidth,
  mono,
  children,
}: {
  name: string;
  nameWidth: string;
  mono?: boolean;
  children: React.ReactNode;
}) => (
  <div
    className="flex gap-2 rounded px-3 py-1.5"
    style={{ backgroundColor: "var(--bai-bg)" }}
  >
    <span
      className={`shrink-0 text-[10px] font-medium ${nameWidth}${mono ? " font-mono" : ""}`}
      style={{ color: "var(--bai-accent)" }}
    >
      {name}
    </span>
    <span className="text-[10px]" style={{ color: "var(--bai-text-muted)" }}>
      {children}
    </span>
  </div>
);
const Code = ({ children }: { children: React.ReactNode }) => (
  <div
    className="mb-4 break-all rounded-lg px-4 py-3 font-mono text-[11px]"
    style={{
      backgroundColor: "var(--bai-bg)",
      color: "var(--bai-text-secondary)",
    }}
  >
    {children}
  </div>
);

/** An entry's name as printed in prose. `data-ref` is what the guide's test checks against the real lists. */
function Ref({ kind, id, label }: { kind: "menu" | "create"; id: string; label: string }) {
  return (
    <b data-ref={`${kind}:${id}`} style={{ color: "var(--bai-text)", fontWeight: 500 }}>
      {label}
    </b>
  );
}

/** "A, B and C" over entries. */
function Entries({
  kind,
  items,
}: {
  kind: "menu" | "create";
  items: ReadonlyArray<VaultMenuItem>;
}) {
  return (
    <>
      {items.map((item, i) => (
        <span key={item.key}>
          {i === 0 ? "" : i === items.length - 1 ? " and " : ", "}
          <Ref kind={kind} id={item.key} label={item.label} />
        </span>
      ))}
    </>
  );
}

/** One named entry, found by key; nothing when the key does not exist. */
function Entry({
  kind,
  items,
  k,
}: {
  kind: "menu" | "create";
  items: ReadonlyArray<VaultMenuItem>;
  k: string;
}) {
  const item = items.find((i) => i.key === k);
  return item ? <Ref kind={kind} id={item.key} label={item.label} /> : null;
}

function OverviewSection({ places, menu, createItems }: GuideLists) {
  const desktop = isDesktopHost();
  return (
    <div>
      <H>What is the Knowledge Vault?</H>
      <P>
        A structured knowledge management system where raw content (articles,
        notes, transcripts) is processed into atomic claims, connected into a
        knowledge graph, and maintained over time.
      </P>

      <H>Find your way</H>
      <div className="mb-4 space-y-2">
        {places.map((p) => (
          <div
            key={p.id}
            data-guide-place={p.id}
            className="flex gap-2 rounded-lg px-3 py-2"
            style={{ backgroundColor: "var(--bai-bg)" }}
          >
            <span
              className="w-28 shrink-0 text-xs font-semibold"
              style={{ color: "var(--bai-accent)" }}
            >
              {p.label}
            </span>
            <span className="text-xs" style={{ color: "var(--bai-text-tertiary)" }}>
              {PLACE_DESC[p.id] ?? ""}
            </span>
          </div>
        ))}
      </div>

      <H>The vault menu</H>
      <P>
        {"Under the vault's name, and at the foot (Vault settings): "}
        <Entries kind="menu" items={menu} />.
      </P>

      <H>Search</H>
      <P>Search (Ctrl K, or ⌘ K on a Mac) finds notes, topics, sources and chats.</P>

      <H>Adding</H>
      <P>
        {"Add sources takes files; the arrow beside it offers "}
        <Entries kind="create" items={createItems} />.
      </P>

      <H>{desktop ? "Quick start on the desktop" : "Quick start on the web"}</H>
      <Step n={1} title="Add sources">
        drop files on the window or press Add sources.
      </Step>
      <Step n={2} title="Processing">
        {desktop
          ? "the app reads each source in the background and writes its notes; the status at the top of the window says how it is going."
          : "if this vault's server runs the pipeline, sources are processed on their own; otherwise an AI agent processes them (see AI agent)."}
      </Step>
      <Step n={3} title="Review">
        new notes wait in review; open one, check it, and Approve it.
      </Step>
      <Step n={4} title="Ask">
        the answer names the notes it used.
      </Step>
    </div>
  );
}

function SourcesSection() {
  return (
    <div>
      <H>Adding sources</H>
      <P>
        Add sources converts a PDF, a Word file, a web page or a book, and shows
        the sources it would create before anything is written. Each one is
        queued for processing.
      </P>
      <P>Paste text as a source, which is queued when added.</P>

      <H>What happens to a source</H>
      <P>Inbox → Extracting → Extracted, or Archived.</P>

      <Tip>Editing a source returns it to Inbox.</Tip>

      <H>Deleting a source</H>
      <P>{"\"Delete source\" is on each source's row."}</P>
    </div>
  );
}

function NotesSection({ createItems }: { createItems: ReadonlyArray<VaultMenuItem> }) {
  return (
    <div>
      <H>Knowledge notes</H>
      <P>
        Each note is an atomic claim — one idea, one point. Notes have
        declarative titles that read as complete sentences.
      </P>

      <H>Note structure</H>
      <div className="mb-4 space-y-1">
        {[
          {
            field: "Title",
            desc: 'A clear, declarative statement (e.g., "local-first architecture executes operations immediately")',
          },
          {
            field: "Description",
            desc: "~150 character summary for progressive disclosure",
          },
          {
            field: "Content",
            desc: "Full markdown body with arguments and evidence",
          },
          {
            field: "Type",
            desc: "concept, pattern, architecture, decision, observation, procedure, etc.",
          },
          {
            field: "Status",
            desc: "DRAFT → IN_REVIEW → CANONICAL → ARCHIVED",
          },
          {
            field: "Links",
            desc: "Typed connections to other notes (RELATES_TO, BUILDS_ON, CONTRADICTS, etc.). A link needs a reason.",
          },
          { field: "Topics", desc: "Tags for navigation and MOC grouping" },
        ].map((item) => (
          <Row key={item.field} name={item.field} nameWidth="w-20">
            {item.desc}
          </Row>
        ))}
      </div>

      <Tip>
        Most notes are written while a source is processed. To write one
        yourself, use <Entry kind="create" items={createItems} k="note" />,
        under the arrow beside Add sources.
      </Tip>

      <H>Writing a note</H>
      <Step n={1} title="Open the arrow beside Add sources">
        choose <Entry kind="create" items={createItems} k="note" /> and give the
        note a declarative title.
      </Step>
      <Step n={2} title="Fill in the editor">
        add description, content, type, and topics.
      </Step>
      <Step n={3} title="Add links">
        use the Links section to connect it to a related note, and say why.
      </Step>
    </div>
  );
}

function ProcessingSection({ menu }: { menu: ReadonlyArray<VaultMenuItem> }) {
  const desktop = isDesktopHost();
  return (
    <div>
      <H>Processing</H>
      <P>
        Processing turns a source into connected notes. Each source goes
        through four steps.
      </P>

      <div className="mb-4 space-y-2">
        {[
          {
            step: "Extract",
            phase: "create",
            color: "bg-amber-400",
            desc: "Write atomic notes from the source",
          },
          {
            step: "Connect",
            phase: "reflect",
            color: "bg-blue-400",
            desc: "Find connections between the new notes and existing ones",
          },
          {
            step: "Place in topics",
            phase: "reweave",
            color: "bg-purple-400",
            desc: "Add the new notes to your topics' maps",
          },
          {
            step: "Verify",
            phase: "verify",
            color: "bg-emerald-400",
            desc: "Check schema, links and descriptions",
          },
        ].map((item) => (
          <div
            key={item.step}
            className="flex items-center gap-3 rounded-lg px-3 py-2"
            style={{ backgroundColor: "var(--bai-bg)" }}
          >
            <span className={`h-2.5 w-8 shrink-0 rounded-full ${item.color}`} />
            <span
              className="w-28 shrink-0 text-xs font-medium"
              style={{ color: "var(--bai-text)" }}
            >
              {item.step}
            </span>
            <span
              className="w-14 shrink-0 font-mono text-[10px]"
              style={{ color: "var(--bai-text-muted)" }}
            >
              {item.phase}
            </span>
            <span className="text-[10px]" style={{ color: "var(--bai-text-muted)" }}>
              {item.desc}
            </span>
          </div>
        ))}
      </div>

      <P>
        {desktop
          ? "It runs on its own; See runs, at the top of the window, opens each run in Workflows."
          : "It runs where this vault's server runs the pipeline, or from an AI agent."}
      </P>
      <P>
        <Entry kind="menu" items={menu} k="pipeline" /> is in the vault menu.
      </P>

      <Tip>
        The Verify step finishes a source&apos;s task; its notes stay in review for
        you.
      </Tip>
    </div>
  );
}

function GraphSection({ menu }: { menu: ReadonlyArray<VaultMenuItem> }) {
  return (
    <div>
      <H>Knowledge graph</H>
      <P>
        The graph shows how your notes are connected. Each node is a note, each
        edge is a typed link. Find a note, or hide kinds of notes from the
        legend.
      </P>

      <H>Link types</H>
      <div className="mb-4 space-y-1">
        {[
          {
            type: "RELATES_TO",
            desc: "General connection between related concepts",
          },
          {
            type: "BUILDS_ON",
            desc: "This note extends or deepens the target",
          },
          { type: "CONTRADICTS", desc: "This note conflicts with the target" },
          { type: "SUPERSEDES", desc: "This note replaces an outdated claim" },
          {
            type: "DERIVED_FROM",
            desc: "This note was extracted from the target source",
          },
        ].map((item) => (
          <Row key={item.type} name={item.type} nameWidth="w-28" mono>
            {item.desc}
          </Row>
        ))}
      </div>

      <H>Health</H>
      <P>
        <Entry kind="menu" items={menu} k="health" /> (in the vault menu) shows
        orphans, link density and dangling links.
      </P>

      <Tip>The graph updates on its own when notes change.</Tip>
    </div>
  );
}

const PLUGIN_COMMANDS: { cmd: string; desc: string }[] = [
  { cmd: "setup", desc: "Point the plugin at this vault" },
  { cmd: "seed", desc: "Ingest source material for processing" },
  { cmd: "extract", desc: "Extract atomic claims from a source" },
  { cmd: "connect", desc: "Find and create links between notes" },
  { cmd: "verify", desc: "Run quality checks on notes" },
  {
    cmd: "pipeline",
    desc: "Run the full extract → connect → reweave → verify flow",
  },
  { cmd: "health", desc: "Get vault health diagnostics" },
  { cmd: "graph", desc: "Structural analysis (triangles, bridges, clusters)" },
  { cmd: "search", desc: "Find notes by content, title, or topic" },
];

function PluginSection() {
  const desktop = isDesktopHost();
  return (
    <div>
      <H>AI agent (optional)</H>
      <P>
        The powerhouse-knowledge plugin connects Claude Code to your vault. The
        AI agent can extract claims, find connections, verify quality, and
        analyze the graph.
      </P>

      <H>Connect it to this vault</H>
      {desktop ? (
        <P>
          Settings › Diagnostics shows the two things an agent needs: the
          Switchboard CLI command for this vault and the MCP address.
        </P>
      ) : (
        <>
          <P>Point the Switchboard CLI at this vault:</P>
          <Code>
            {`switchboard init --url ${resolveReactorEndpoint()} --name `}
            {"<vault>"}
            {" --use-profile"}
          </Code>
        </>
      )}

      <H>Install the plugin</H>
      <Code>
        claude plugin marketplace add liberuum/powerhouse-knowledge
        <br />
        claude plugin install powerhouse-knowledge@powerhouse-knowledge
      </Code>

      <H>Commands</H>
      <div className="mb-4 space-y-1">
        {PLUGIN_COMMANDS.map((item) => (
          <Row
            key={item.cmd}
            name={`/powerhouse-knowledge:${item.cmd}`}
            nameWidth="w-52"
            mono
          >
            {item.desc}
          </Row>
        ))}
      </div>
    </div>
  );
}
```

  Check against the test while writing: the desktop "Settings › Diagnostics ..." line sits in one `<P>` with a JSX line break, which collapses to a single space (JSX trims line-ending whitespace and joins lines with one space), so the test's string matches. The web command is three adjacent text nodes with no tags between them, so `text()` reads `switchboard init --url /graphql --name <vault> --use-profile` (static markup escapes `<vault>`, `text()` decodes it). Confirm that in Step 4; if the renderer inserts `<!-- -->` comment markers between adjacent text nodes, the `text()` helper's tag stripping already removes them (they match `<[^>]+>`).

- [ ] **Step 4: run** — `bunx vitest run editors/knowledge-vault/components/GettingStarted.test.tsx editors/knowledge-vault/components/GuideSources.test.tsx editors/knowledge-vault/components/VaultPlaces.test.tsx` then `bun run tsc 2>&1 | tail -20` and `bun run lint:fix 2>&1 | tail -20`.
  Expected: all tests pass (12 in GettingStarted.test.tsx — see the `it` list; 2 in GuideSources; VaultPlaces unchanged); tsc clean (the F1 `<GettingStartedModal>` props now exist); lint clean. If lint flags `react/jsx-no-comment-textnodes` or a missing `key`, fix in place; do not change the test.
  Manual check, after the build: open the guide on the desktop host and the web build; each of the six sections reads as the spec's copy, and no "Pipeline tab" / "Bridges" remains.

- [ ] **Step 5: commit** — `git add editors/knowledge-vault/components/GettingStarted.tsx editors/knowledge-vault/components/GettingStarted.test.tsx` (plus the F1 paths if F1 was not committed separately) with the message:

```
feat(guide): the Getting started guide describes the app as it is

The places, the vault menu and the create items are printed from the code
that builds them, so a rename renames the guide. Stale tabs, the Queue for
Processing step, Bridges, --plugin-dir, .mcp.json and the Ars Contexta
passages are gone; the AI agent section installs from the marketplace.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

---

### Task 26: Release the vault package
**Repo:** bai-knowledge-note (branch ui-upgrade). **Files:** `package.json` (version).
Build and publish from a clean worktree of HEAD, never from the working checkout (it may hold another session's uncommitted work).
- [ ] **Step 1:** `git worktree add --detach ../.kn-publish-wt HEAD`, then in it `bun install --frozen-lockfile`.
- [ ] **Step 2:** Set `"version"` to the next dev version: `npm view @powerhousedao/knowledge-note versions --json --registry https://registry.vetra.io | tail -3` — the highest is `1.0.54-dev.37` at the time of writing, so `1.0.54-dev.38`.
- [ ] **Step 3:** Run `bun run tsc && bun run lint && TMPDIR=$HOME/.cache/vt-tmp bun run test`. Expected: no errors, all tests pass. Fix anything before going on.
- [ ] **Step 4:** Commit `package.json` ("chore: 1.0.54-dev.38 — app polish: links, scopes, graph find and filter, Activity, guide, wording"), then `bun run build`. Expected: build succeeds; `grep -rl "Work breakdowns outside any scope" dist | head -1` finds a file.
- [ ] **Step 5:** `npm whoami --registry https://registry.vetra.io` (if it fails, ask the user to log in and wait), then `ph publish --tag dev`. Expected: the registry's `dev` tag is `1.0.54-dev.38`.
- [ ] **Step 6:** Bring ui-upgrade to the new commit (`git merge --ff-only <sha>` in the main checkout when it is clean; otherwise `git update-ref` plus `git reset -q -- package.json` and the same one-line version edit in the working copy). Remove the worktree. The processor change (Activity link rows) reaches a running engine only after this package is installed and the engine restarts.

## Part 2: Update in place (§2)

# Part 2 — Update keeps the pipeline and its runs (spec §2)

Repo for every task: **`knowledge-vault-app`** (branch `dev`). Commands run from that repo's root
(`/home/beast/Documents/Powerhouse/knowledge-vault-app`).

## Notes for the assembler

- **The spec's single `execute` would publish a half-made workflow.** The reactor applies a batch past a
  rejected operation: a reducer's throw is recorded as the operation's `error` and the next action still
  runs (`node_modules/.bun/@powerhousedao+shared@6.2.3-dev.60+…/dist/document-model/index.js:3791-3798`;
  the job loop only stops on job-level errors, `@powerhousedao+reactor@6.2.3-dev.60+…/dist/drive-container-types-BAfFzBOf.js:3026-3045`).
  If `PUBLISH_WORKFLOW` sat in the same batch as a rejected `ADD_EDGE`, the broken draft would be
  published, and `REVERT_TO_PUBLISHED` would then restore that broken publish. The plan sends **two** batches:
  first the removals and the template's edits, with no `PUBLISH_WORKFLOW` and no `SET_WORKFLOW_STATUS`. After
  every edit is accepted, the second batch sends `PUBLISH_WORKFLOW` + `SET_WORKFLOW_STATUS`. A failure in
  either batch sends `REVERT_TO_PUBLISHED`.
- **Template order is collapsed (decision).** The template sequence "…policy, publish, trigger again, publish again, enable"
  is sent as both `SET_TRIGGER`s inside the edits batch, followed by one publish. The published result is the same,
  because the second `SET_TRIGGER` wins. Creation (`instantiatePipeline`) still replays the template verbatim.
- **Spec step 4 says "the connection still holds its old, working secrets". That is wrong if the template replay
  landed before the model write failed.** The plan folds the model settings into the replay's `SET_CONFIG`
  (one `execute`, not replay + `updateConnectionModels`). On any failure after that write was sent, it
  points the connection's `SET_SECRET_REF`s back at the record's refs **before** deleting the new secrets.
  If that restore fails too, the new secrets are kept and a warning is logged. A leaked secret is better
  than a dead connection.
- **`execute` matches by action id, not by tail position (decision).** The runtime writes to a workflow
  document at the same time (`SET_LAST_RUN`; `SetLastRunInput`, `workflow/…/gen/schema/types.d.ts:247`). A tail
  check could therefore mistake the runtime's operation for ours. The new read is
  `operations(filter: { scopes: ["global"], sinceRevision: $since }, paging: { limit: 500 })`, with `since` set to
  the global `revisionsList` entry read before the write. Each action is then found by `action { id }`.
  Verified in the stack: `DocumentOperationsFilterInput.sinceRevision: Int`, `PHDocument.revisionsList`, and
  `Action.id: String!` (`@powerhousedao+reactor-api@6.2.3-dev.60+…/dist/base-document-models-69WRTSfH.mjs:1216`, schema
  string). The filter is `index >= sinceRevision` (`@powerhousedao+reactor@6.2.3-dev.60+…/dist/forwarding-logger-B9LLXItm.js:2853`),
  and a scope's revision is its next index (same file `:1948`).
- **`workflowStatus()` today reads any error as "deleted"** (`pipelines.ts:226`, `.catch(() => null)`). An
  in-place Update decides between "update" and "re-create" on that answer, so with today's code a passing
  engine hiccup would throw away the runs. The plan makes it return `null` only on the reactor's own
  answers, "Document … not found" or "… deleted" (`DocumentNotFoundError`, `forwarding-logger-B9LLXItm.js:278-287`).
  Every other error now throws. Side effect in `followReweave`: an unreadable Reweave workflow is now reported
  `failed` and tried again at the next start. Today its digest is recorded and it is skipped for good.
- **Workflow model verified** (installed `sidecar/node_modules/@powerhousedao/workflow`, `package.json` version
  `6.2.3-dev.60`):
  - `REMOVE_EDGE { id: OID }`: `RemoveEdgeInput`, `dist/types/document-models/workflow/v1/gen/schema/types.d.ts:225-227`;
    action `gen/edges/actions.d.ts:12`. Reducer `dist/node/module-DPg8IYIn.mjs:1064-1069` throws `EdgeNotFoundError`
    on an unknown id. Dispatch at `:1575`.
  - `REMOVE_STEP { id: OID }`: `RemoveStepInput`, `types.d.ts:228-230`; action `gen/steps/actions.d.ts:16`. Reducer
    `module-DPg8IYIn.mjs:1300-1306` also drops every edge to or from the step, which is **why edges go first**:
    removing an edge that is already gone is rejected. Dispatch at `:1563`.
  - `REVERT_TO_PUBLISHED { _?: Boolean }`, sent as `{}`: `RevertToPublishedInput`, `types.d.ts:243-245`; action
    `gen/publishing/actions.d.ts:12`. Reducer `module-DPg8IYIn.mjs:1130-1139` restores trigger, steps, edges,
    variables, policy and version. It does **not** restore name, description or status, and it throws
    `NothingPublishedError` when the workflow was never published. Dispatch at `:1603`.
  - Related: `ADD_STEP`/`ADD_EDGE` reject duplicate ids (`:1237`, `:1051`). That is why removal must come
    first; the template's ids are fixed. `SET_WORKFLOW_STATUS ENABLED` needs a publish (`:1502-1505`).
  - `SET_CONNECTOR` (connection model, `module-Bl_4mnxR.mjs:474-488`) sets the connection's status to
    `UNCONFIGURED` even with the same connector. That is the same as at creation. It only clears config and secrets
    when the connector id changes.
- **Update overwrites unpublished Studio edits on the workflow.** It removes everything and replays.
  `followTemplate()` skips such a workflow, but Update is an explicit reset to the template. Workflow
  variables are left alone, because the template adds none.
- **Spec vs constraint:** decision 2 says "the template's stale description is fixed in that same change". The
  drafting rules forbid any `pipeline.json` change, and §8 says the description stays. The plan does not
  touch it.
- **Cross-part interfaces:**
  - `sidecar/src/pipelines.ts`: §1 edits `status()`, `PipelineStatus` and the deps. This part touches
    **only**:
    - the comment above `LOCAL_PLACEHOLDER_KEY` (`:92`);
    - `workflowStatus()` (`:219-229`, replaced by `documentGone` + `globalState()` + `workflowStatus()`);
    - `ensureReweave()` (`:231-271`);
    - `ensure()` (`:273-333`) and a new `updateInPlace()` right after it;
    - a new `modelConfig` const with `updateConnectionModels()` (`:335-361`) using it;
    - `followReweave()` (`:473-482`);
    - `applyModels()`'s doc comment (`:484-488`, no code);
    - the import lines `:5` and `:7`.
  - `sidecar/src/pipelines.test.ts`: §1 rewrites the status tests and probably `fakeEngine`'s
    `triggerStates`/`runsPage` answer. Task F2.1 replaces the whole `fakeEngine` (`:11-38`), so merge §1's
    `runsPage`/queue answers into the new version.
  - `host/src/components/PipelineChip.tsx`: §1 edits the tooltip (`:55`) and this part edits the button label
    (`:71`). `PipelineChip.test.tsx`: §1 rewrites the `lastRun` tests, and this part only adds one test.
  - `sidecar/src/main.ts` is not touched. `followReweave()` gains an `updated` list that main's log (`:549-552`)
    ignores, so in-place Reweave updates log nothing. If the assembler wants a line, it fits beside §8's
    comment edits.
  - `applyModels()` still returns `{ updated, recreated }`. The `recreated` key is typed in `control.ts:84` and
    `control.test.ts:86`, which §9 also edits, so it is kept even though older pipelines are now updated in place.
- **Spec line numbers checked against the current code:**
  - `ensure()` is `pipelines.ts:274-333`: the record is removed at `:282-287`, and `discard` is `:184-187`.
  - `ensureReweave()` is `:237-271`, with its delete at `:253`.
  - `applyModels()` calls `ensure()` at `:506`.
  - `followGateway()` is `:373-406` and `followTemplate()` is `:417-471`.
  - `templates.ts:66-104` matches.
  - `reactor-gql.ts`: `execute` is `:53-69`, with the 500 limit at `:60`.
  - `PipelineChip.tsx:71` matches.
- **`execute` is shared:** `connections.ts`, `queue-watchdog.ts`, `vault-structure.ts` and `starters.ts` also call it, so
  F2.1 updates those test files' fakes to answer `revisionsList` and return `action { id }`. Their behaviour is unchanged.

---

### Task 27: `execute` checks only the operations it wrote (part 2, draft label F2.1)

**Files** (repo `knowledge-vault-app`):
- Modify `sidecar/src/reactor-gql.ts`: `OperationItem` and `execute()`, `:45-69`.
- Test `sidecar/src/reactor-gql.test.ts`: `fakeReactor`, `:5-48`, plus a new test after `:77`.
- Fakes that must follow the new read:
  - `sidecar/src/pipelines.test.ts`: `fakeEngine`, `:11-38`; the `followTemplate` test's fetch, `:392-405`.
  - `sidecar/src/connections.test.ts`: `:7`, `:19-23`.
  - `sidecar/src/vault-structure.test.ts`: `:9`, `:17-18`.
  - `sidecar/src/starters.test.ts`: `:8`, `:48`.
  - `sidecar/src/queue-watchdog.test.ts`: `:89-95`.

**Interfaces:**
- Produces `execute(origin, documentId, actions, fetchImpl?)`, with an unchanged signature. It throws
  `Operation <TYPE> was rejected: <error>` (unchanged), or `Expected N new operations on <id>, found M`.
- Produces test helper `fakeReactor(opts?: { rejectType?; rejectWith?; history?: number; writeAfter?: string; states?: Record<string, unknown> })`.
  F2.2 uses `states`.
- Produces test helper `fakeEngine()` in `pipelines.test.ts`. It returns
  `{ fetchImpl, calls, connectionConfig, failExecuteFor, rejectTypes, states, gone, unreadable }`, which F2.3 and F2.4 rely on.

- [ ] **Step 1: write the failing test.** In `sidecar/src/reactor-gql.test.ts`, replace lines 5-48 (from
  `type Op = …` through the closing `}` of `fakeReactor`) with:

```ts
type Op = { index: number; scope: "document" | "global"; error: string | null; action: { id: string; type: string } };
/**
 * A reactor like the installed one. A fresh document already holds CREATE_DOCUMENT and UPGRADE_DOCUMENT in the
 * `document` scope, with their own index sequence. Executed actions land in `global` with theirs. A rejected action is
 * recorded with its error, and the rest of the batch still applies. `operations()` answers every scope unless
 * `filter: { scopes: […] }` narrows it, from `$since` on when given, and at most `paging.limit` items.
 * `history` gives a document that many earlier global operations. `writeAfter` has another writer add a failed
 * operation right after each batch, as the runtime records runs on a workflow. `states` answers `document { state }`.
 */
export function fakeReactor(opts: { rejectType?: string; rejectWith?: string; history?: number; writeAfter?: string; states?: Record<string, unknown> } = {}) {
  const calls: Call[] = [];
  const ops = new Map<string, Op[]>();
  let n = 0;
  const opsOf = (id: string): Op[] => {
    let list = ops.get(id);
    if (!list) {
      list = Array.from({ length: opts.history ?? 0 }, (_, i): Op => ({ index: i, scope: "global", error: null, action: { id: `earlier-${i}`, type: "SET_WORKFLOW_NAME" } }));
      ops.set(id, list);
    }
    return list;
  };
  const globalCount = (id: string) => opsOf(id).filter((o) => o.scope === "global").length;
  const reply = (data: unknown) => ({ ok: true, json: async () => ({ data }) });
  const fetchImpl = vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body)) as Call;
    calls.push(body);
    const q = body.query;
    const ns = /(Connection|Workflow)\s*\{/.exec(q)?.[1];
    if (q.includes("createDocument") && ns) {
      const id = `doc${++n}`;
      ops.set(id, [
        { index: 0, scope: "document", error: null, action: { id: `create-${id}`, type: "CREATE_DOCUMENT" } },
        { index: 1, scope: "document", error: null, action: { id: `upgrade-${id}`, type: "UPGRADE_DOCUMENT" } },
      ]);
      return reply({ [ns]: { createDocument: { id } } });
    }
    if (q.includes("execute(")) {
      const id = body.variables.id as string;
      const list = opsOf(id);
      for (const a of body.variables.a as Array<{ id: string; type: string }>) list.push({ index: globalCount(id), scope: "global", error: a.type === opts.rejectType ? (opts.rejectWith ?? "rejected") : null, action: { id: a.id, type: a.type } });
      if (opts.writeAfter) list.push({ index: globalCount(id), scope: "global", error: "another writer's failure", action: { id: `other-${list.length}`, type: opts.writeAfter } });
      return reply({ execute: { id } });
    }
    if (q.includes("revisionsList")) {
      const id = body.variables.id as string;
      return reply({ document: { document: { revisionsList: [{ scope: "document", revision: opsOf(id).filter((o) => o.scope === "document").length }, { scope: "global", revision: globalCount(id) }] } } });
    }
    if (q.includes("operations(")) {
      const id = body.variables.id as string;
      const scoped = /scopes:\s*\[\s*"global"\s*\]/.test(q) ? opsOf(id).filter((o) => o.scope === "global") : opsOf(id);
      const since = typeof body.variables.since === "number" ? body.variables.since : 0;
      const limit = Number(/limit:\s*(\d+)/.exec(q)?.[1] ?? Infinity);
      const items = [...scoped].filter((o) => o.index >= since).sort((a, b) => a.index - b.index).slice(0, limit).map(({ index, error, action }) => ({ index, error, action }));
      return reply({ document: { document: { operations: { items, hasNextPage: false, cursor: null } } } });
    }
    if (q.includes("document { state }")) return reply({ document: { document: { state: { global: opts.states?.[body.variables.id as string] ?? {} } } } });
    if (q.includes("deleteDocument")) return reply({ deleteDocument: true });
    throw new Error(`unexpected query: ${q}`);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls, ops };
}
```

Then, after the test `"reads back only the global scope, so a rejected FIRST operation is seen and named"`
(which ends at line 77), insert:

```ts
  it("reads back only what was written after the revision it read first, matched to the batch by action id", async () => {
    // 600 earlier operations: a read of the first 500 would never reach the batch, and its rejection would go unseen
    const long = fakeReactor({ history: 600, rejectType: "ADD_STEP", rejectWith: "A step with this id already exists" });
    await expect(execute(ORIGIN, "wf", toActions([{ type: "REMOVE_STEP", input: { id: "s1" } }, { type: "ADD_STEP", input: { id: "s1" } }]), long.fetchImpl)).rejects.toThrow(/ADD_STEP.*already exists/);
    const readBack = long.calls.find((c) => c.query.includes("operations("))!;
    expect(readBack.query).toMatch(/sinceRevision:\s*\$since/);
    expect(readBack.variables).toEqual({ id: "wf", since: 600 });
    // the revision is read before the write
    const revisionRead = long.calls.findIndex((c) => c.query.includes("revisionsList"));
    expect(revisionRead).toBeGreaterThanOrEqual(0);
    expect(revisionRead).toBeLessThan(long.calls.findIndex((c) => c.query.includes("execute(")));
    // another writer's operation after the batch (the runtime records each run on its workflow) is not taken for one of ours
    const busy = fakeReactor({ writeAfter: "SET_LAST_RUN" });
    await expect(execute(ORIGIN, "wf", toActions([{ type: "SET_WORKFLOW_NAME", input: { name: "W" } }]), busy.fetchImpl)).resolves.toBeUndefined();
  });
```

- [ ] **Step 2: run.** `bunx vitest run sidecar/src/reactor-gql.test.ts`
  Expected: 1 failed, with `AssertionError: promise resolved "undefined" instead of rejecting`. Today's read of the
  first 500 operations never sees the rejected `ADD_STEP`. The other 4 tests pass.

- [ ] **Step 3: implement.** In `sidecar/src/reactor-gql.ts`, replace lines 45-69, from
  `type OperationItem = { index: number; error: string | null; action: { type: string } };` through the closing `}`
  of `execute`, with:

```ts
type OperationItem = { index: number; error: string | null; action: { id: string; type: string } };

/**
 * Replay a batch. `execute` answers with the document, not with per-operation results. A reducer that rejects an
 * action still records the operation, with its `error`, and the rest of the batch still applies. So the document's
 * global revision is read first; only the operations written from it on are read back, and each is matched to the
 * batch by action id. Two things can then never hide a rejection: a long history (a workflow updated in place many
 * times) pushing the batch past the page, and an operation another writer adds meanwhile (the runtime records each
 * run on its workflow) being taken for one of ours.
 */
export async function execute(origin: string, documentId: string, actions: ActionInput[], fetchImpl: typeof fetch = fetch): Promise<void> {
  if (actions.length === 0) return;
  const head = await gql<{ document: { document: { revisionsList?: Array<{ scope: string; revision: number }> } | null } | null }>(
    origin,
    `query($id: String!) { document(idOrSlug: $id) { document { revisionsList { scope revision } } } }`,
    { id: documentId },
    fetchImpl,
  );
  const since = head.document?.document?.revisionsList?.find((r) => r.scope === "global")?.revision ?? 0;
  await gql(origin, `mutation($id: String!, $a: [ActionInput!]!) { execute(documentIdOrSlug: $id, actions: $a) { id } }`, { id: documentId, a: actions }, fetchImpl);
  const data = await gql<{ document: { document: { operations: { items: OperationItem[] } } } }>(
    origin,
    // The global scope only: a fresh document also holds CREATE_DOCUMENT / UPGRADE_DOCUMENT in the `document` scope,
    // with their own indexes.
    `query($id: String!, $since: Int!) { document(idOrSlug: $id) { document { operations(filter: { scopes: ["global"], sinceRevision: $since }, paging: { limit: 500 }) { items { index error action { id type } } } } } }`,
    { id: documentId, since },
    fetchImpl,
  );
  const byId = new Map(data.document.document.operations.items.map((op) => [op.action.id, op]));
  const found = actions.filter((a) => byId.has(a.id)).length;
  if (found !== actions.length) throw new Error(`Expected ${actions.length} new operations on ${documentId}, found ${found}`);
  const rejected = actions.map((action) => ({ action, op: byId.get(action.id)! })).find(({ op }) => op.error);
  if (rejected) throw new Error(`Operation ${rejected.action.type} was rejected: ${rejected.op.error}`);
}
```

  Make the other fakes answer the new read (each is a literal edit):

  1. `sidecar/src/pipelines.test.ts`: replace lines 11-38 (the doc comment `/** The engine's GraphQL as the manager sees it…` through `return { fetchImpl, calls, connectionConfig, failExecuteFor };` and its `}`) with the version below. It also carries the `states` / `gone` / `unreadable` / `rejectTypes` / `createDocument` answers that F2.3 and F2.4 use. **§1 merge note:** keep §1's own `triggerStates`/`runsPage`/queue answers in place of the `triggerStates` branch here.

```ts
/** The engine's GraphQL as the manager sees it: secrets, documents and their operations, trigger states, runs. */
function fakeEngine(triggers: Array<{ workflowId: string; status: string }> = []) {
  const calls: Call[] = [];
  let secrets = 0;
  const connectionConfig: Record<string, unknown> = { base_url: "http://127.0.0.1:4201", llm_base_url: "https://openrouter.ai/api/v1", llm_default_model: "openai/gpt-6-luna", llm_api_key: "secret://v1:2" };
  /** Documents whose writes (`execute`) the engine refuses, the way it answers a refused request: a GraphQL `errors` array. */
  const failExecuteFor = new Set<string>();
  /** Operation types a reducer rejects: the operation is recorded with its error and the rest of the batch still applies, as in the reactor. */
  const rejectTypes = new Set<string>();
  /** A document's global state by id; any other answers as a connection holding `connectionConfig`. */
  const states: Record<string, Record<string, unknown>> = {};
  /** Documents deleted in Studio: reading one gets the reactor's "not found". */
  const gone = new Set<string>();
  /** Documents the engine cannot read just now. */
  const unreadable = new Set<string>();
  const ops = new Map<string, Array<{ index: number; error: string | null; action: { id: string; type: string } }>>();
  const reply = (data: unknown) => ({ ok: true, json: async () => ({ data }) });
  const refuse = (message: string) => ({ ok: true, json: async () => ({ errors: [{ message }] }) });
  const fetchImpl = vi.fn(async (_u: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body)) as Call;
    calls.push(body);
    const q = body.query;
    const id = String(body.variables.id);
    if (q.includes("createSecret")) return reply({ workflowRuntime: { createSecret: { ref: `secret://v1:${++secrets}` } } });
    if (q.includes("deleteSecret")) return reply({ workflowRuntime: { deleteSecret: true } });
    if (q.includes("deleteDocument")) return reply({ deleteDocument: true });
    if (q.includes("createDocument")) return reply({ Connection: { createDocument: { id: "conn-new" } } });
    if (q.includes("execute(")) {
      if (failExecuteFor.has(id)) return refuse(`the engine refused the write to ${id}`);
      const list = ops.get(id) ?? [];
      for (const a of body.variables.a as Array<{ id: string; type: string }>) list.push({ index: list.length, error: rejectTypes.has(a.type) ? `${a.type} refused` : null, action: { id: a.id, type: a.type } });
      ops.set(id, list);
      return reply({ execute: { id } });
    }
    if (q.includes("revisionsList")) return reply({ document: { document: { revisionsList: [{ scope: "global", revision: (ops.get(id) ?? []).length }] } } });
    if (q.includes("operations(")) return reply({ document: { document: { operations: { items: (ops.get(id) ?? []).filter((o) => o.index >= Number(body.variables.since ?? 0)), hasNextPage: false, cursor: null } } } });
    if (q.includes("document { state }")) {
      if (gone.has(id)) return refuse(`Failed to fetch document: Document ${id} not found`);
      if (unreadable.has(id)) return refuse("connect ECONNREFUSED 127.0.0.1:4201");
      return reply({ document: { document: { state: { global: states[id] ?? { config: connectionConfig } } } } });
    }
    if (q.includes("triggerStates")) {
      return reply({ workflowRuntime: { triggerStates: triggers.map((t) => ({ ...t, lastPollAt: "2026-10-07T10:00:00.000Z", lastError: null })), runsPage: { items: [{ id: `run-${body.variables.w}`, status: "FAILED", startedAt: "2026-10-07T09:59:00.000Z", endedAt: "2026-10-07T09:59:30.000Z", error: "no model here" }] } } });
    }
    throw new Error(`unexpected query: ${q}`);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls, connectionConfig, failExecuteFor, rejectTypes, states, gone, unreadable };
}
```

  2. `sidecar/src/pipelines.test.ts`, the `followTemplate` test's own fetch: replace lines 392-405, from
     `const executed: Array<{ id: string; types: string[]; inputs: unknown[] }> = [];` through
     `}) as unknown as typeof fetch;`, with:

```ts
    const executed: Array<{ id: string; types: string[]; inputs: unknown[] }> = [];
    let lastWrite: Array<{ id: string; type: string }> = [];
    const fetchImpl = vi.fn(async (_u: unknown, init?: { body?: unknown }) => {
      const body = JSON.parse(String(init?.body)) as { query: string; variables: { id: string; a?: Array<{ id: string; type: string; input: unknown }> } };
      const reply = (data: unknown) => ({ ok: true, json: async () => ({ data }) });
      if (body.query.includes("execute(")) {
        lastWrite = body.variables.a!;
        executed.push({ id: body.variables.id, types: body.variables.a!.map((a) => a.type), inputs: body.variables.a!.map((a) => a.input) });
        return reply({ execute: { id: body.variables.id } });
      }
      if (body.query.includes("revisionsList")) return reply({ document: { document: { revisionsList: [{ scope: "global", revision: 10 }] } } });
      if (body.query.includes("operations(")) return reply({ document: { document: { operations: { items: lastWrite.map((a, i) => ({ index: 10 + i, error: null, action: { id: a.id, type: a.type } })) } } } });
      if (body.query.includes("document { state }")) return reply({ document: { document: { state: { global: workflows[body.variables.id] } } } });
      throw new Error(`unexpected query: ${body.query}`);
    }) as unknown as typeof fetch;
```

  3. `sidecar/src/connections.test.ts`:
     - Line 7: `const executed: { type: string; input: Record<string, unknown> }[] = [];` becomes
       `const executed: { id: string; type: string; input: Record<string, unknown> }[] = [];`
     - Line 20: `executed.push(...(variables.a as { type: string; input: Record<string, unknown> }[]));` becomes
       `executed.push(...(variables.a as { id: string; type: string; input: Record<string, unknown> }[]));`
     - Line 23: `action: { type: a.type }` becomes `action: { id: a.id, type: a.type }`.
     - The revision read falls into the `document(` branch. It answers without `revisionsList`, so `since` is 0.

  4. `sidecar/src/vault-structure.test.ts`:
     - Line 9: `const ops: Array<{ index: number; error: null; action: { type: string } }> = [];` becomes
       `const ops: Array<{ index: number; error: null; action: { id: string; type: string } }> = [];`
     - Line 18: `ops.push({ index: ops.length, error: null, action: { type: a.type } });` becomes
       `ops.push({ index: ops.length, error: null, action: { id: a.id, type: a.type } });`

  5. `sidecar/src/starters.test.ts`:
     - Line 8: `type Op = { index: number; error: string | null; action: { type: string; input?: unknown } };` becomes
       `type Op = { index: number; error: string | null; action: { id?: string; type: string; input?: unknown } };`
     - Line 48: in `doc.ops.map(({ index, error, action }) => ({ index, error, action: { type: action.type } }))`,
       replace `action: { type: action.type }` with `action: { id: action.id, type: action.type }`.

  6. `sidecar/src/queue-watchdog.test.ts`: replace lines 90-95 (the `operations(` branch) with:

```ts
      if (body.query.includes("revisionsList")) return { ok: true, json: async () => ({ data: { document: { document: { revisionsList: [] } } } }) };
      if (body.query.includes("operations(")) {
        // the operations the last execute sent, none rejected
        const last = [...calls].reverse().find((c) => c.query.includes("execute("));
        const sent = (last?.variables.a as Array<{ id: string; type: string }>) ?? [];
        return { ok: true, json: async () => ({ data: { document: { document: { operations: { items: sent.map((a, index) => ({ index, error: null, action: { id: a.id, type: a.type } })), hash: "" } } } } }) };
      }
```

- [ ] **Step 4: run.** `bunx vitest run sidecar/src`, then `bun run check`.
  Expected: every sidecar test file passes, including the new `reactor-gql` test, and the type check is clean.

- [ ] **Step 5: commit.**

```bash
git add sidecar/src/reactor-gql.ts sidecar/src/reactor-gql.test.ts sidecar/src/pipelines.test.ts sidecar/src/connections.test.ts sidecar/src/vault-structure.test.ts sidecar/src/starters.test.ts sidecar/src/queue-watchdog.test.ts
git commit -m "fix(sidecar): execute checks only the operations it wrote

It reads the global revision before writing, reads back from there, and
matches each action by id. A long history or another writer's operation
can no longer hide a rejection.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

---

### Task 28: Template helpers for an Update in place (part 2, draft label F2.2)

**Files** (repo `knowledge-vault-app`):
- Modify `sidecar/src/templates.ts`:
  - import line 1;
  - `instantiatePipeline` and its doc comment, `:59-104`;
  - `instantiateWorkflow`, `:135-155`;
  - new exports after it.
- Test `sidecar/src/templates.test.ts`: import line 2, plus a new `describe` at the end of the file.

**Interfaces (produces):**
- `type PipelineFillOptions = Omit<InstantiateOptions, "workflowsDriveId" | "fetchImpl">`
- `fillPipeline(opts: PipelineFillOptions, connectionId: string): { connection: TemplateOp[]; workflow: TemplateOp[] }`:
  steps get `{{LLM_MODEL}}` = `""`. Throws `Unknown placeholder …`.
- `createPipelineConnection(opts: InstantiateOptions): Promise<string>`: creates the connection and replays its operations.
  The document is deleted again if an operation is rejected.
- `type WorkflowFillOptions = Omit<InstantiateWorkflowOptions, "origin" | "workflowsDriveId" | "fetchImpl">`
- `fillWorkflow(opts: WorkflowFillOptions): TemplateOp[]`
- `replaceWorkflowInPlace(opts: { origin: string; workflowId: string; operations: TemplateOp[]; status: "ENABLED" | "DISABLED"; now?: () => string; fetchImpl?: typeof fetch }): Promise<void>`
- **Consumes:** `execute` (F2.1), and `fakeReactor({ states })` (F2.1).

- [ ] **Step 1: write the failing tests.** In `sidecar/src/templates.test.ts`, change line 2 to:

```ts
import { createPipelineConnection, fillPipeline, fillPlaceholders, fillWorkflow, instantiatePipeline, PLACEHOLDERS, replaceWorkflowInPlace, type PipelineTemplate, type PlaceholderValues, type WorkflowTemplate } from "./templates.js";
```

and append at the end of the file:

```ts
describe("Update in place", () => {
  const fill = { origin: "http://127.0.0.1:4201", template, vaultName: "Research", driveId: "vault1", secretRefs: { token: "secret://v1:cccc", llm: "secret://v1:dddd" }, llm: { baseUrl: "http://127.0.0.1:4202/llm/v1", model: "openai/gpt-6-luna" }, pieceVersion: "1.0.54-dev.24", now: () => "2026-10-16T10:00:00.000Z" };
  /** A pipeline workflow as Studio left it: switched off, with a step of its own and an edge. */
  const studio = { wf9: { status: "DISABLED", steps: [{ id: "s1" }, { id: "s-studio" }], edges: [{ id: "e-studio" }], published: { version: 4 } } };
  const sent = (calls: Array<{ query: string; variables: Record<string, unknown> }>) => calls.filter((c) => c.query.includes("execute(")).map((c) => c.variables.a as Array<{ type: string; input: unknown }>);
  const editTypes = ["REMOVE_EDGE", "REMOVE_STEP", "REMOVE_STEP", "SET_WORKFLOW_NAME", "SET_TRIGGER", "ADD_STEP"];

  it("fills the template for one connection: the steps leave the model to it, the connection names the given secrets", () => {
    const filled = fillPipeline(fill, "conn-7");
    expect(filled.workflow.find((o) => o.type === "ADD_STEP")!.input).toEqual({ id: "s1", config: { drive: "vault1", model: "", source_id: "{{trigger.payload.source_id}}" }, connectionId: "conn-7" });
    expect(filled.connection.find((o) => o.type === "SET_CONFIG")!.input).toEqual({ config: { base_url: "http://127.0.0.1:4201", llm_default_model: "openai/gpt-6-luna", llm_base_url: "http://127.0.0.1:4202/llm/v1" } });
    expect(filled.connection.filter((o) => o.type === "SET_SECRET_REF").map((o) => o.input)).toEqual([{ id: "bccb", ref: "secret://v1:cccc", name: "token" }, { id: "6491", ref: "secret://v1:dddd", name: "llm_api_key" }]);
  });

  it("removes the workflow's edges, then its steps, replays the template's edits, and only then publishes and sets the status", async () => {
    const { fetchImpl, calls } = fakeReactor({ states: studio });
    await replaceWorkflowInPlace({ origin: fill.origin, workflowId: "wf9", operations: fillPipeline(fill, "conn-7").workflow, status: "DISABLED", now: fill.now, fetchImpl });
    const batches = sent(calls);
    expect(batches).toHaveLength(2);
    expect(batches[0]!.map((a) => a.type)).toEqual(editTypes);
    expect(batches[0]!.slice(0, 3).map((a) => a.input)).toEqual([{ id: "e-studio" }, { id: "s1" }, { id: "s-studio" }]);
    expect(batches[1]!.map((a) => [a.type, a.input])).toEqual([["PUBLISH_WORKFLOW", { publishedAt: "2026-10-16T10:00:00.000Z" }], ["SET_WORKFLOW_STATUS", { status: "DISABLED" }]]);
  });

  it("on a rejected edit puts the workflow back as last published and never publishes", async () => {
    const { fetchImpl, calls } = fakeReactor({ states: studio, rejectType: "ADD_STEP", rejectWith: "A step with this id already exists" });
    await expect(replaceWorkflowInPlace({ origin: fill.origin, workflowId: "wf9", operations: fillPipeline(fill, "conn-7").workflow, status: "ENABLED", now: fill.now, fetchImpl })).rejects.toThrow(/ADD_STEP.*already exists/);
    expect(sent(calls).map((b) => b.map((a) => a.type))).toEqual([editTypes, ["REVERT_TO_PUBLISHED"]]);
    expect(sent(calls)[1]![0]!.input).toEqual({});
  });

  it("makes a connection from the template, and deletes it again when an operation is rejected", async () => {
    const ok = fakeReactor();
    expect(await createPipelineConnection({ ...fill, workflowsDriveId: "wfdrive", fetchImpl: ok.fetchImpl })).toBe("doc1");
    expect(ok.calls.find((c) => c.query.includes("createDocument"))!.variables).toEqual({ name: "Research — Knowledge Vault", parent: "wfdrive" });
    expect(sent(ok.calls)[0]!.map((a) => a.type)).toEqual(["SET_CONNECTION_NAME", "SET_CONNECTOR", "SET_CONFIG", "SET_SECRET_REF", "SET_SECRET_REF"]);
    const bad = fakeReactor({ rejectType: "SET_CONNECTOR", rejectWith: "The reactor connector id goes only with authType REACTOR" });
    await expect(createPipelineConnection({ ...fill, workflowsDriveId: "wfdrive", fetchImpl: bad.fetchImpl })).rejects.toThrow(/SET_CONNECTOR/);
    expect(bad.calls.filter((c) => c.query.includes("deleteDocument")).map((c) => c.variables.id)).toEqual(["doc1"]);
  });

  it("fills a workflow template with the workflow's own values, the model left to the connection", () => {
    const reweave: WorkflowTemplate = { version: 1, exportedAt: "x", placeholders: [], workflow: { documentType: "powerhouse/workflow", operations: [{ type: "SET_WORKFLOW_NAME", input: { name: "{{WORKFLOW_NAME}}" } }, { type: "ADD_STEP", input: { id: "r1", config: { drive: "{{DRIVE_ID}}", model: "{{LLM_MODEL}}" }, connectionId: "{{CONNECTION_ID}}" } }] } };
    expect(fillWorkflow({ template: reweave, name: "Research — Reweave notes", driveId: "vault1", connectionId: "conn-7", pieceVersion: "1.0.54-dev.24" }).map((o) => o.input)).toEqual([{ name: "Research — Reweave notes" }, { id: "r1", config: { drive: "vault1", model: "" }, connectionId: "conn-7" }]);
  });
});
```

- [ ] **Step 2: run.** `bunx vitest run sidecar/src/templates.test.ts`
  Expected: the 5 new tests fail with `TypeError: fillPipeline is not a function` (likewise
  `replaceWorkflowInPlace`, `createPipelineConnection` and `fillWorkflow`). The 5 existing tests pass.

- [ ] **Step 3: implement** in `sidecar/src/templates.ts`.

  Line 1 becomes:

```ts
import { createDocument, deleteDocument, execute, gql, toActions } from "./reactor-gql.js";
```

  Replace lines 59-104, from the doc comment `/**\n * Create the connection, then the workflow, in the Workflows drive, replaying`
  through the closing `}` of `instantiatePipeline`, with:

```ts
/** What fillPipeline needs: everything instantiatePipeline takes except where the documents go and how to reach the engine. */
export type PipelineFillOptions = Omit<InstantiateOptions, "workflowsDriveId" | "fetchImpl">;

/**
 * The template's connection and workflow operations, filled for this vault and one connection. The connection carries
 * the model (llm_default_model). The steps leave theirs empty so the piece falls back to it (runner.ts), which makes a
 * model change in Settings one config write, not a new workflow. Throws on a placeholder it does not know.
 */
export function fillPipeline(opts: PipelineFillOptions, connectionId: string): { connection: TemplateOp[]; workflow: TemplateOp[] } {
  const now = opts.now ?? (() => new Date().toISOString());
  const values: PlaceholderValues = {
    "{{DRIVE_ID}}": opts.driveId,
    "{{CONNECTION_ID}}": connectionId,
    "{{SWITCHBOARD_ORIGIN}}": opts.origin,
    "{{TOKEN_SECRET_REF}}": opts.secretRefs.token,
    "{{LLM_SECRET_REF}}": opts.secretRefs.llm,
    "{{LLM_BASE_URL}}": opts.llm.baseUrl,
    "{{LLM_MODEL}}": opts.llm.model,
    "{{PIECE_VERSION}}": opts.pieceVersion,
    "{{WORKFLOW_NAME}}": `${opts.vaultName} — Vault pipeline`,
    "{{CONNECTION_NAME}}": `${opts.vaultName} — Knowledge Vault`,
    "{{NOW}}": now(),
  };
  const stepValues: PlaceholderValues = { ...values, "{{LLM_MODEL}}": "" };
  const fill = (ops: TemplateOp[], v: PlaceholderValues) => ops.map((o) => ({ type: o.type, input: fillPlaceholders(o.input, v) }));
  return { connection: fill(opts.template.connection.operations, values), workflow: fill(opts.template.workflow.operations, stepValues) };
}

/**
 * Create the pipeline's connection in the Workflows drive and replay its operations. Used at setup, and by an Update
 * whose connection was deleted in Studio. Every placeholder is checked before the reactor is touched; a rejected
 * operation deletes the connection again.
 */
export async function createPipelineConnection(opts: InstantiateOptions): Promise<string> {
  const f = opts.fetchImpl ?? fetch;
  const now = opts.now ?? (() => new Date().toISOString());
  fillPipeline(opts, "probe");
  const connectionId = await createDocument(opts.origin, opts.template.connection.documentType, `${opts.vaultName} — Knowledge Vault`, opts.workflowsDriveId, f);
  try {
    await execute(opts.origin, connectionId, toActions(fillPipeline(opts, connectionId).connection, now), f);
    return connectionId;
  } catch (error) {
    await deleteDocument(opts.origin, connectionId, f).catch(() => undefined);
    throw error;
  }
}

/**
 * Create the connection, then the workflow, in the Workflows drive, replaying each document's operations with the
 * placeholders filled. The template is validated first: an unknown placeholder aborts before anything is created.
 * When the reactor rejects an operation, both documents are deleted.
 */
export async function instantiatePipeline(opts: InstantiateOptions): Promise<{ workflowId: string; connectionId: string }> {
  const f = opts.fetchImpl ?? fetch;
  const now = opts.now ?? (() => new Date().toISOString());
  // Every placeholder the template uses must be one we fill — checked before the reactor is touched.
  fillPipeline(opts, "probe");
  const connectionId = await createPipelineConnection(opts);
  let workflowId: string | undefined;
  try {
    workflowId = await createDocument(opts.origin, opts.template.workflow.documentType, `${opts.vaultName} — Vault pipeline`, opts.workflowsDriveId, f);
    await execute(opts.origin, workflowId, toActions(fillPipeline(opts, connectionId).workflow, now), f);
    return { workflowId, connectionId };
  } catch (error) {
    for (const id of [connectionId, ...(workflowId ? [workflowId] : [])]) await deleteDocument(opts.origin, id, f).catch(() => undefined);
    throw error;
  }
}
```

  Replace `instantiateWorkflow` (lines 130-155, from its doc comment `/**\n * Create one workflow in the Workflows drive and replay`
  through its closing `}`) with the block below. It includes the new functions after it:

```ts
/** What fillWorkflow needs: everything instantiateWorkflow takes except the engine and the Workflows drive. */
export type WorkflowFillOptions = Omit<InstantiateWorkflowOptions, "origin" | "workflowsDriveId" | "fetchImpl">;

/** A workflow template's operations, filled for one vault and connection. The steps leave the model to the connection. */
export function fillWorkflow(opts: WorkflowFillOptions): TemplateOp[] {
  const now = opts.now ?? (() => new Date().toISOString());
  const values: Partial<PlaceholderValues> = {
    "{{DRIVE_ID}}": opts.driveId,
    "{{CONNECTION_ID}}": opts.connectionId,
    "{{LLM_MODEL}}": "",
    "{{PIECE_VERSION}}": opts.pieceVersion,
    "{{WORKFLOW_NAME}}": opts.name,
    "{{NOW}}": now(),
  };
  return opts.template.workflow.operations.map((o) => ({ type: o.type, input: fillPlaceholders(o.input, values) }));
}

/**
 * Create one workflow in the Workflows drive and replay its operations on an existing connection. Its steps leave the
 * model empty, so the connection's model applies. A placeholder this cannot fill (a secret, a base URL) aborts before
 * anything is created; a rejected operation deletes the workflow again.
 */
export async function instantiateWorkflow(opts: InstantiateWorkflowOptions): Promise<{ workflowId: string }> {
  const f = opts.fetchImpl ?? fetch;
  const now = opts.now ?? (() => new Date().toISOString());
  const actions = toActions(fillWorkflow(opts), now);
  const workflowId = await createDocument(opts.origin, opts.template.workflow.documentType, opts.name, opts.workflowsDriveId, f);
  try {
    await execute(opts.origin, workflowId, actions, f);
    return { workflowId };
  } catch (error) {
    await deleteDocument(opts.origin, workflowId, f).catch(() => undefined);
    throw error;
  }
}

export type ReplaceWorkflowOptions = {
  origin: string;
  workflowId: string;
  /** The template's operations, already filled (fillPipeline / fillWorkflow). */
  operations: TemplateOp[];
  /** What the workflow is switched to once published. */
  status: "ENABLED" | "DISABLED";
  now?: () => string;
  fetchImpl?: typeof fetch;
};

/** Template operations that publish or switch a workflow. Update sends them once, after every edit was accepted. */
const PUBLISHING = new Set(["PUBLISH_WORKFLOW", "SET_WORKFLOW_STATUS"]);

/**
 * Bring an existing workflow to a template in place (spec §2, Update). The workflow keeps its id, its runs and its
 * place in the Workflows drive.
 *
 * Every current edge is removed, then every step. Edges go first because REMOVE_STEP drops a step's edges and
 * REMOVE_EDGE refuses an edge that is gone. The template's edits are then replayed. Its step and edge ids are fixed,
 * so the same ids come back. Only then is the workflow published and switched to `status`.
 *
 * The reactor applies a batch past a rejected operation, so publishing waits for a batch in which every edit was
 * accepted. A rejection, or any failure before the publish lands, sends REVERT_TO_PUBLISHED. That puts the trigger,
 * steps, edges, variables and policy back as last published. The runtime runs the published workflow, so processing
 * never sees a half-made one.
 */
export async function replaceWorkflowInPlace(opts: ReplaceWorkflowOptions): Promise<void> {
  const f = opts.fetchImpl ?? fetch;
  const now = opts.now ?? (() => new Date().toISOString());
  const data = await gql<{ document: { document: { state: { global: { steps?: Array<{ id: string }>; edges?: Array<{ id: string }> } } } | null } | null }>(
    opts.origin,
    `query($id: String!) { document(idOrSlug: $id) { document { state } } }`,
    { id: opts.workflowId },
    f,
  );
  const global = data.document?.document?.state.global;
  if (!global) throw new Error(`Workflow ${opts.workflowId} no longer exists`);
  const edits: TemplateOp[] = [
    ...(global.edges ?? []).map((e) => ({ type: "REMOVE_EDGE", input: { id: e.id } })),
    ...(global.steps ?? []).map((s) => ({ type: "REMOVE_STEP", input: { id: s.id } })),
    ...opts.operations.filter((o) => !PUBLISHING.has(o.type)),
  ];
  try {
    await execute(opts.origin, opts.workflowId, toActions(edits, now), f);
    await execute(opts.origin, opts.workflowId, toActions([{ type: "PUBLISH_WORKFLOW", input: { publishedAt: now() } }, { type: "SET_WORKFLOW_STATUS", input: { status: opts.status } }], now), f);
  } catch (error) {
    await execute(opts.origin, opts.workflowId, toActions([{ type: "REVERT_TO_PUBLISHED", input: {} }], now), f).catch(() => undefined);
    throw error;
  }
}
```

- [ ] **Step 4: run.** `bunx vitest run sidecar/src/templates.test.ts sidecar/src/pipelines.test.ts`, then `bun run check`.
  Expected: all pass. The existing `instantiatePipeline` tests still see the same two `execute` payloads and the same
  deletions.

- [ ] **Step 5: commit.**

```bash
git add sidecar/src/templates.ts sidecar/src/templates.test.ts
git commit -m "feat(sidecar): template helpers to bring a workflow to its template in place

fillPipeline, createPipelineConnection, fillWorkflow and replaceWorkflowInPlace.
The edits go in one batch and the publish follows only when every edit was
accepted. A rejection reverts the workflow to its last publish.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

---

### Task 29: Reweave notes is updated in place (part 2, draft label F2.3)

**Files** (repo `knowledge-vault-app`):
- Modify `sidecar/src/pipelines.ts`:
  - line 7 (import);
  - `workflowStatus()`, `:219-229`;
  - `ensureReweave()`, `:231-271`;
  - `followReweave()`, `:473-482`.
- Test `sidecar/src/pipelines.test.ts`:
  - move the `reweaveTemplate` const (`:431`) to module level;
  - replace the Reweave test (`:433-468`);
  - add one test.

**Interfaces:**
- Consumes `fillWorkflow` and `replaceWorkflowInPlace` (F2.2), and the `fakeEngine` `states`/`gone`/`unreadable` (F2.1).
- Produces, inside the manager:
  - `globalState(id): Promise<{ status?: string } | null>`, which is `null` only when the document is gone;
  - `workflowStatus(id): Promise<string | null>`, with the same rule;
  - `ensureReweave(vaultId, opts?: { force?: boolean; enable?: boolean }): Promise<"created" | "updated" | "current" | "skipped" | "failed">`.
- Produces publicly `followReweave(): Promise<{ created: string[]; updated: string[]; failed: string[] }>`.
- F2.4 calls `ensureReweave(vaultId, { force: true, enable })` and `globalState`.

- [ ] **Step 1: write the failing tests.** In `sidecar/src/pipelines.test.ts`:
  - Delete line 431 (`  const reweaveTemplate = …`, inside `describe("pipeline manager — the Reweave notes workflow"`).
  - Insert it at module level directly after line 8 (`const template = …`):

```ts
const reweaveTemplate = { version: 1, exportedAt: "x", placeholders: [], workflow: { documentType: "powerhouse/workflow", operations: [{ type: "SET_WORKFLOW_NAME", input: { name: "{{WORKFLOW_NAME}}" } }] } } as unknown as WorkflowTemplate;
/** The batches written to one document, in order. */
const batches = (calls: Call[], id: string) => calls.filter((c) => c.query.includes("execute(") && c.variables.id === id).map((c) => c.variables.a as Array<{ type: string; input: unknown }>);
```

  Replace the test `"is made with the pipeline on its connection, added to vaults set up before it, remade from a newer template (still off if it was off) and removed with the vault"`
  (lines 433-468) with these two tests:

```ts
  it("is made with the pipeline on its connection, added to vaults set up before it, brought to a newer template in place (still off if it was off) and removed with the vault", async () => {
    let made = 0;
    const instantiateReweave = vi.fn(async () => ({ workflowId: `rw-${++made}` }));
    const { manager, dataDir, engine } = deps({ reweaveTemplate, instantiateReweave });
    // vault2's Reweave notes workflow, switched off in Studio, with a step and an edge of an older template
    engine.states["rw-old"] = { status: "DISABLED", steps: [{ id: "rw-step" }], edges: [{ id: "rw-edge" }], published: { version: 2 } };

    // A new pipeline gets its Reweave notes workflow on the same connection.
    expect((await manager.ensure("vault1")).state).toBe("ready");
    expect(instantiateReweave).toHaveBeenLastCalledWith(expect.objectContaining({ name: "Research — Reweave notes", driveId: "vault1", connectionId: "conn-1", workflowsDriveId: "wfdrive", pieceVersion: "1.0.54-dev.23" }));
    expect(readPipelines(dataDir).vault1?.reweave).toEqual({ workflowId: "rw-1", digest: workflowDigest(reweaveTemplate) });

    // At start: a current one is left alone, a vault set up before it gets one, an older one is brought to the template in place.
    const base: PipelineRecord = { workflowId: "wf-2", connectionId: "conn-2", secretRefs: { token: "secret://v1:8", llm: "secret://v1:9" }, createdAt: "2026-10-01T00:00:00.000Z" };
    writePipelines(dataDir, { ...readPipelines(dataDir), vault2: { ...base, reweave: { workflowId: "rw-old", digest: "older" } }, vault3: { ...base, connectionId: "conn-3", workflowId: "wf-3" }, vault4: { ...base, disabled: "the model key was removed" } });
    expect(await manager.followReweave()).toEqual({ created: ["vault3"], updated: ["vault2"], failed: [] });
    const records = readPipelines(dataDir);
    expect(records.vault1?.reweave?.workflowId).toBe("rw-1");
    expect(records.vault2?.reweave).toEqual({ workflowId: "rw-old", digest: workflowDigest(reweaveTemplate) }); // same workflow, same runs
    expect(records.vault3?.reweave).toEqual({ workflowId: "rw-2", digest: workflowDigest(reweaveTemplate) });
    expect(records.vault4?.reweave).toBeUndefined();
    expect(engine.calls.filter((c) => c.query.includes("deleteDocument"))).toEqual([]);
    const old = batches(engine.calls, "rw-old");
    expect(old.map((b) => b.map((a) => a.type))).toEqual([["REMOVE_EDGE", "REMOVE_STEP", "SET_WORKFLOW_NAME"], ["PUBLISH_WORKFLOW", "SET_WORKFLOW_STATUS"]]);
    expect(old[0]![2]!.input).toEqual({ name: "Team wiki — Reweave notes" });
    expect(old[1]![1]!.input).toEqual({ status: "DISABLED" }); // switched off in Studio: stays off

    // Removing the vault removes its Reweave notes workflow too.
    await manager.remove("vault1");
    expect(engine.calls.filter((c) => c.query.includes("deleteDocument")).map((c) => c.variables.id)).toContain("rw-1");
  });

  it("at start, one deleted in Studio stays deleted; one the engine cannot read is tried again later, never taken for deleted", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const instantiateReweave = vi.fn(async () => ({ workflowId: "rw-new" }));
    const { manager, dataDir, engine } = deps({ reweaveTemplate, instantiateReweave });
    const base: PipelineRecord = { workflowId: "wf-2", connectionId: "conn-2", secretRefs: { token: "t", llm: "l" }, createdAt: "2026-10-01T00:00:00.000Z" };
    writePipelines(dataDir, { vault2: { ...base, reweave: { workflowId: "rw-gone", digest: "older" } }, vault3: { ...base, reweave: { workflowId: "rw-down", digest: "older" } } });
    engine.gone.add("rw-gone");
    engine.unreadable.add("rw-down");
    expect(await manager.followReweave()).toEqual({ created: [], updated: [], failed: ["vault3"] });
    expect(readPipelines(dataDir).vault2?.reweave).toEqual({ workflowId: "rw-gone", digest: workflowDigest(reweaveTemplate) });
    expect(readPipelines(dataDir).vault3?.reweave).toEqual({ workflowId: "rw-down", digest: "older" });
    expect(instantiateReweave).not.toHaveBeenCalled();
    warn.mockRestore();
  });
```

- [ ] **Step 2: run.** `bunx vitest run sidecar/src/pipelines.test.ts -t "Reweave"`
  Expected: 2 failed.
  - The first fails at `followReweave()`: it expected `{ created: ["vault3"], updated: ["vault2"], failed: [] }` but
    received `{ created: ["vault2", "vault3"], failed: [] }`.
  - The second expected `failed: ["vault3"]` but received `{ created: [], failed: [] }`.

- [ ] **Step 3: implement** in `sidecar/src/pipelines.ts`.

  Line 7 becomes:

```ts
import { createPipelineConnection, fillPipeline, fillWorkflow, instantiatePipeline, instantiateWorkflow, replaceWorkflowInPlace, type PipelineTemplate, type TemplateOp, type WorkflowTemplate } from "./templates.js";
```

  (`createPipelineConnection`, `fillPipeline` and `TemplateOp` are used from F2.4 on. If the type check flags them
  unused at this step, add them in F2.4 instead.)

  Replace lines 219-229, from `/** A workflow's status, or null when it no longer exists (deleted in Studio). */` through the closing `}` of
  `workflowStatus`, with:

```ts
  /** The engine's answer for a document that is gone (deleted in Studio), as opposed to one it could not read just now. */
  const documentGone = (error: unknown) => /not found|has been deleted|was deleted at/i.test(error instanceof Error ? error.message : String(error));

  /**
   * A document's global state, or null when it no longer exists (deleted in Studio). Any other failure to read it
   * throws, so an engine that did not answer never reads as a deleted document. Update decides between "in place" and
   * "make it again" on this answer, and a wrong "gone" would throw the runs away.
   */
  async function globalState(id: string): Promise<{ status?: string } | null> {
    try {
      const data = await gql<{ document: { document: { state: { global: { status?: string } } } | null } | null }>(
        deps.origin,
        `query($id: String!) { document(idOrSlug: $id) { document { state } } }`,
        { id },
        f,
      );
      return data.document?.document?.state.global ?? null;
    } catch (error) {
      if (documentGone(error)) return null;
      throw error;
    }
  }

  /** A workflow's status, or null when it no longer exists (deleted in Studio). */
  async function workflowStatus(workflowId: string): Promise<string | null> {
    const global = await globalState(workflowId);
    return global ? (global.status ?? "UNKNOWN") : null;
  }
```

  Replace lines 231-271, from the doc comment `/**\n   * The vault's Reweave notes workflow, on its pipeline's connection: made when the record has none`
  through the closing `}` of `ensureReweave`, with:

```ts
  /**
   * The vault's Reweave notes workflow, on its pipeline's connection. It is made when the record has none (a vault set
   * up before it existed, or an earlier try failed). From a newer template it is brought up to date in place, keeping
   * its id and its runs.
   *
   * `force` (an Update) brings it to the template even when its digest is current, because the connection may be new,
   * and makes it again when it was deleted in Studio. Without `force`, one deleted in Studio stays deleted. One switched
   * off in Studio stays off, unless `enable`: the app had switched it off. Never throws, because the pipeline works
   * without it.
   */
  async function ensureReweave(vaultId: string, opts: { force?: boolean; enable?: boolean } = {}): Promise<"created" | "updated" | "current" | "skipped" | "failed"> {
    const template = deps.reweaveTemplate;
    const record = readPipelines(deps.dataDir)[vaultId];
    if (!template || !record || record.disabled) return "skipped";
    const digest = workflowDigest(template);
    const name = async () => `${await deps.vaultName(vaultId)} — Reweave notes`;
    try {
      if (record.reweave) {
        if (record.reweave.digest === digest && !opts.force) return "current";
        const workflowId = record.reweave.workflowId;
        const status = await workflowStatus(workflowId);
        if (status !== null) {
          const operations = fillWorkflow({ template, name: await name(), driveId: vaultId, connectionId: record.connectionId, pieceVersion: deps.pieceVersion, now });
          const off = status === "DISABLED" && !opts.enable;
          await replaceWorkflowInPlace({ origin: deps.origin, workflowId, operations, status: off ? "DISABLED" : "ENABLED", now, fetchImpl: f });
          save(vaultId, (r) => ({ ...r, reweave: { workflowId, digest } }));
          return "updated";
        }
        if (!opts.force) {
          save(vaultId, (r) => ({ ...r, reweave: { workflowId, digest } }));
          return "skipped";
        }
        save(vaultId, ({ reweave: _gone, ...r }) => r);
      }
      const { id: workflowsDriveId } = await deps.workflowsDrive();
      const { workflowId } = await instantiateReweave({ origin: deps.origin, template, name: await name(), driveId: vaultId, connectionId: record.connectionId, workflowsDriveId, pieceVersion: deps.pieceVersion, now, fetchImpl: f });
      if (readPipelines(deps.dataDir)[vaultId]?.connectionId !== record.connectionId) {
        // The pipeline was set up again, or removed, meanwhile: this workflow belongs to nothing.
        await deleteDocument(deps.origin, workflowId, f).catch(() => undefined);
        return "skipped";
      }
      save(vaultId, (r) => ({ ...r, reweave: { workflowId, digest } }));
      return "created";
    } catch (error) {
      console.warn(`[pipelines] could not set up the Reweave notes workflow of vault ${vaultId}: ${error instanceof Error ? error.message : String(error)}`);
      return "failed";
    }
  }
```

  Replace `followReweave` (lines 473-482, from `/** At start: every vault's pipeline gets its Reweave notes workflow, or one from a newer template (ensureReweave). */`
  through its closing `},`) with:

```ts
    /** At start: every vault's pipeline gets its Reweave notes workflow, or has it brought to a newer template in place (ensureReweave). */
    async followReweave(): Promise<{ created: string[]; updated: string[]; failed: string[] }> {
      const out = { created: [] as string[], updated: [] as string[], failed: [] as string[] };
      for (const vaultId of Object.keys(readPipelines(deps.dataDir))) {
        const result = await ensureReweave(vaultId);
        if (result === "created") out.created.push(vaultId);
        if (result === "updated") out.updated.push(vaultId);
        if (result === "failed") out.failed.push(vaultId);
      }
      return out;
    },
```

- [ ] **Step 4: run.** `bunx vitest run sidecar/src/pipelines.test.ts`, then `bun run check`.
  Expected: all pass. `main.ts:549-552` still compiles, because it reads only `created` and `failed`.

- [ ] **Step 5: commit.**

```bash
git add sidecar/src/pipelines.ts sidecar/src/pipelines.test.ts
git commit -m "feat(sidecar): Reweave notes is brought to a newer template in place, keeping its runs

A workflow reads as deleted only when the engine says so. One it cannot read
is tried again at the next start.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

---

### Task 30: Update brings the pipeline to the template in place (part 2, draft label F2.4)

**Files** (repo `knowledge-vault-app`):
- Modify `sidecar/src/pipelines.ts`:
  - the comment at `:92`;
  - `ensure()`, `:273-333` (current numbering before F2.3; anchor on its text);
  - a new `updateInPlace()` right after `ensure()`;
  - a new `modelConfig` const and `updateConnectionModels()`, `:335-361`;
  - `applyModels()`'s doc comment, `:484-488`.
- Test `sidecar/src/pipelines.test.ts`:
  - replace `"re-creating a pipeline removes the previous documents and secrets first"` (`:113-121`);
  - delete `"re-creating a pipeline that then fails leaves no stale record"` (`:175-183`);
  - edit the `applyModels` test (`:245-246`);
  - add a new `describe`.

**Interfaces:**
- Consumes:
  - `fillPipeline`, `createPipelineConnection` and `replaceWorkflowInPlace` (F2.2);
  - `globalState`, `workflowStatus` and `ensureReweave(vaultId, { force, enable })` (F2.3);
  - `fakeEngine` with `states` / `gone` / `rejectTypes` / `createDocument` (F2.1).
- Produces `ensure(vaultId): Promise<EnsureResult>`, with an unchanged signature. A record whose workflow exists
  keeps `workflowId` and, unless its connection was deleted, `connectionId`. `control.ts:350` and `:376` are unchanged.

- [ ] **Step 1: write the failing tests.** In `sidecar/src/pipelines.test.ts`:

  Delete the test `"re-creating a pipeline that then fails leaves no stale record"` (lines 175-183).

  In the `applyModels` test, replace lines 245-246:

```ts
    expect(h.instantiate).toHaveBeenCalledTimes(1); // only the older pipeline was set up again
    expect(records.vault2).toMatchObject({ workflowId: "wf-1", modelFromConnection: true, models: { model: "anthropic/claude-sonnet-5.5" } });
```

  with:

```ts
    expect(h.instantiate).not.toHaveBeenCalled(); // the older pipeline is brought to the template in place
    expect(records.vault2).toMatchObject({ workflowId: "wf-old", connectionId: "conn-old", modelFromConnection: true, models: { model: "anthropic/claude-sonnet-5.5" } });
```

  Replace the test `"re-creating a pipeline removes the previous documents and secrets first"` (lines 113-121) with:

```ts
  it("an Update of a pipeline whose workflow was deleted in Studio creates it anew, removing what was left first", async () => {
    const { manager, engine, instantiate } = deps();
    await manager.ensure("vault1");
    engine.gone.add("wf-1");
    await manager.ensure("vault1");
    expect(instantiate).toHaveBeenCalledTimes(2);
    expect(engine.calls.filter((c) => c.query.includes("deleteDocument")).map((c) => c.variables.id).sort()).toEqual(["conn-1", "wf-1"]);
    expect(engine.calls.filter((c) => c.query.includes("deleteSecret")).map((c) => c.variables.ref).sort()).toEqual(["secret://v1:1", "secret://v1:2"]);
  });
```

  Insert a new `describe` right before `describe("pipeline manager — status and removal"` (current line 124):

```ts
describe("pipeline manager — Update in place", () => {
  afterEach(() => vi.restoreAllMocks());
  /** A template with what an Update replays: the connection's name, config and secrets; the workflow's trigger, step, edge and policy. */
  const inPlace = {
    version: 1,
    exportedAt: "x",
    placeholders: [],
    connection: {
      documentType: "powerhouse/connection",
      operations: [
        { type: "SET_CONNECTION_NAME", input: { name: "{{CONNECTION_NAME}}" } },
        { type: "SET_CONFIG", input: { config: { base_url: "{{SWITCHBOARD_ORIGIN}}", llm_default_model: "{{LLM_MODEL}}", llm_base_url: "{{LLM_BASE_URL}}" } } },
        { type: "SET_SECRET_REF", input: { id: "tok", ref: "{{TOKEN_SECRET_REF}}", name: "token" } },
        { type: "SET_SECRET_REF", input: { id: "llm", ref: "{{LLM_SECRET_REF}}", name: "llm_api_key" } },
      ],
    },
    workflow: {
      documentType: "powerhouse/workflow",
      operations: [
        { type: "SET_WORKFLOW_NAME", input: { name: "{{WORKFLOW_NAME}}" } },
        { type: "SET_TRIGGER", input: { id: "trig", config: { drive: "{{DRIVE_ID}}" }, connectionId: "{{CONNECTION_ID}}" } },
        { type: "ADD_STEP", input: { id: "s1", config: { model: "{{LLM_MODEL}}" }, connectionId: "{{CONNECTION_ID}}" } },
        { type: "ADD_EDGE", input: { id: "e1", from: "trig", to: "s1", port: "next" } },
        { type: "SET_POLICY", input: { concurrency: "PARALLEL" } },
        { type: "PUBLISH_WORKFLOW", input: { publishedAt: "{{NOW}}" } },
        { type: "SET_WORKFLOW_STATUS", input: { status: "ENABLED" } },
      ],
    },
  } as unknown as PipelineTemplate;
  /** The pipeline's workflow as it runs: published, with the template's step and edge. */
  const running = { status: "ENABLED", steps: [{ id: "s1" }], edges: [{ id: "e1" }], published: { version: 3 } };
  const editTypes = ["REMOVE_EDGE", "REMOVE_STEP", "SET_WORKFLOW_NAME", "SET_TRIGGER", "ADD_STEP", "ADD_EDGE", "SET_POLICY"];
  const deletedSecrets = (calls: Call[]) => calls.filter((c) => c.query.includes("deleteSecret")).map((c) => c.variables.ref);

  it("keeps the workflow, its id and its connection: new secrets first, the workflow edited then published, the connection, the record, the old secrets last", async () => {
    const h = deps({ template: inPlace });
    await h.manager.ensure("vault1");
    h.engine.states["wf-1"] = { ...running, steps: [{ id: "s1" }, { id: "s-studio" }] };
    const order: string[] = [];
    const fetchImpl = vi.fn(async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const { query, variables } = JSON.parse(String(init?.body)) as Call;
      if (query.includes("createSecret")) order.push("create a secret");
      else if (query.includes("execute(")) order.push(`write ${String(variables.id)}`);
      else if (query.includes("deleteSecret")) order.push(`delete ${String(variables.ref)} (the record holds ${readPipelines(h.dataDir).vault1?.secretRefs.token})`);
      return h.d.fetchImpl(url, init);
    }) as unknown as typeof fetch;

    expect(await createPipelineManager({ ...h.d, fetchImpl }).ensure("vault1")).toEqual({ state: "ready", workflowId: "wf-1", connectionId: "conn-1" });
    expect(order).toEqual([
      "create a secret",
      "create a secret",
      "write wf-1",
      "write wf-1",
      "write conn-1",
      "delete secret://v1:1 (the record holds secret://v1:3)",
      "delete secret://v1:2 (the record holds secret://v1:3)",
    ]);
    expect(h.instantiate).toHaveBeenCalledTimes(1); // the first setup only
    expect(h.engine.calls.filter((c) => c.query.includes("deleteDocument"))).toEqual([]);

    const [edits, publish] = batches(h.engine.calls, "wf-1");
    expect(edits!.map((a) => a.type)).toEqual(["REMOVE_EDGE", "REMOVE_STEP", "REMOVE_STEP", "SET_WORKFLOW_NAME", "SET_TRIGGER", "ADD_STEP", "ADD_EDGE", "SET_POLICY"]);
    expect(edits!.find((a) => a.type === "SET_TRIGGER")!.input).toEqual({ id: "trig", config: { drive: "vault1" }, connectionId: "conn-1" });
    expect(edits!.find((a) => a.type === "ADD_STEP")!.input).toEqual({ id: "s1", config: { model: "" }, connectionId: "conn-1" });
    expect(publish!.map((a) => [a.type, a.input])).toEqual([["PUBLISH_WORKFLOW", { publishedAt: "2026-10-07T10:00:00.000Z" }], ["SET_WORKFLOW_STATUS", { status: "ENABLED" }]]);

    const connection = batches(h.engine.calls, "conn-1").at(-1)!;
    expect(connection.map((a) => a.type)).toEqual(["SET_CONNECTION_NAME", "SET_CONFIG", "SET_SECRET_REF", "SET_SECRET_REF"]);
    expect(connection[1]!.input).toEqual({ config: { base_url: "http://127.0.0.1:4201", llm_default_model: "openai/gpt-6-luna", llm_base_url: "http://127.0.0.1:4202/llm/v1", llm_locality: "hosted" } });
    expect(connection.slice(2).map((a) => a.input)).toEqual([{ id: "tok", ref: "secret://v1:3", name: "token" }, { id: "llm", ref: "secret://v1:4", name: "llm_api_key" }]);

    expect(readPipelines(h.dataDir).vault1).toEqual({
      workflowId: "wf-1",
      connectionId: "conn-1",
      secretRefs: { token: "secret://v1:3", llm: "secret://v1:4" },
      createdAt: "2026-10-07T10:00:00.000Z",
      models: { endpoint: "https://openrouter.ai/api/v1", model: "openai/gpt-6-luna" },
      token: { kind: "minted", expiresAt: "2027-01-05T10:00:00.000Z" },
      modelFromConnection: true,
      templateDigest: templateDigest(inPlace),
      gatewayKeyed: true,
    });
  });

  it("a rejected workflow edit puts the workflow back as last published, never publishes, and leaves the record and the old secrets", async () => {
    const h = deps({ template: inPlace });
    await h.manager.ensure("vault1");
    const before = readPipelines(h.dataDir).vault1;
    h.engine.states["wf-1"] = running;
    h.engine.rejectTypes.add("ADD_EDGE");
    await expect(h.manager.ensure("vault1")).rejects.toThrow(/ADD_EDGE was rejected/);
    expect(batches(h.engine.calls, "wf-1").map((b) => b.map((a) => a.type))).toEqual([editTypes, ["REVERT_TO_PUBLISHED"]]);
    expect(batches(h.engine.calls, "conn-1")).toHaveLength(1); // the first setup's model write only
    expect(readPipelines(h.dataDir).vault1).toEqual(before);
    expect(deletedSecrets(h.engine.calls)).toEqual(["secret://v1:3", "secret://v1:4"]);
  });

  it("a rejected connection write points the connection back at the record's secrets before the new ones go; the record stays", async () => {
    const h = deps({ template: inPlace });
    await h.manager.ensure("vault1");
    const before = readPipelines(h.dataDir).vault1;
    h.engine.states["wf-1"] = running;
    h.engine.rejectTypes.add("SET_CONNECTION_NAME");
    await expect(h.manager.ensure("vault1")).rejects.toThrow(/SET_CONNECTION_NAME was rejected/);
    // the workflow already matches the template, and is published
    expect(batches(h.engine.calls, "wf-1").map((b) => b.map((a) => a.type))).toEqual([editTypes, ["PUBLISH_WORKFLOW", "SET_WORKFLOW_STATUS"]]);
    const restore = batches(h.engine.calls, "conn-1").at(-1)!;
    expect(restore.map((a) => [a.type, a.input])).toEqual([["SET_SECRET_REF", { id: "tok", ref: "secret://v1:1", name: "token" }], ["SET_SECRET_REF", { id: "llm", ref: "secret://v1:2", name: "llm_api_key" }]]);
    expect(deletedSecrets(h.engine.calls)).toEqual(["secret://v1:3", "secret://v1:4"]);
    expect(readPipelines(h.dataDir).vault1).toEqual(before);
  });

  it("a connection deleted in Studio is made again from the template, and the workflow is pointed at it", async () => {
    const h = deps({ template: inPlace });
    await h.manager.ensure("vault1");
    h.engine.states["wf-1"] = running;
    h.engine.gone.add("conn-1");
    expect(await h.manager.ensure("vault1")).toEqual({ state: "ready", workflowId: "wf-1", connectionId: "conn-new" });
    expect(h.engine.calls.find((c) => c.query.includes("createDocument"))!.variables).toEqual({ name: "Research — Knowledge Vault", parent: "wfdrive" });
    const [edits] = batches(h.engine.calls, "wf-1");
    expect(edits!.find((a) => a.type === "SET_TRIGGER")!.input).toMatchObject({ connectionId: "conn-new" });
    expect(readPipelines(h.dataDir).vault1).toMatchObject({ workflowId: "wf-1", connectionId: "conn-new", secretRefs: { token: "secret://v1:3", llm: "secret://v1:4" } });
  });

  it("brings the Reweave notes workflow along: switched on again when the app had switched it off", async () => {
    const instantiateReweave = vi.fn(async () => ({ workflowId: "rw-1" }));
    const h = deps({ template: inPlace, reweaveTemplate, instantiateReweave });
    await h.manager.ensure("vault1");
    await h.manager.disableAll("the model key was removed");
    h.engine.states["rw-1"] = { status: "DISABLED" };
    expect((await h.manager.ensure("vault1")).state).toBe("ready");
    expect(batches(h.engine.calls, "rw-1").at(-1)!.map((a) => [a.type, a.input])).toEqual([["PUBLISH_WORKFLOW", { publishedAt: "2026-10-07T10:00:00.000Z" }], ["SET_WORKFLOW_STATUS", { status: "ENABLED" }]]);
    const record = readPipelines(h.dataDir).vault1!;
    expect(record.disabled).toBeUndefined();
    expect(record.reweave).toEqual({ workflowId: "rw-1", digest: workflowDigest(reweaveTemplate) });
    expect(instantiateReweave).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: run.** `bunx vitest run sidecar/src/pipelines.test.ts`
  Expected: the 5 `Update in place` tests and the `applyModels` test fail. Today's `ensure()` discards and
  re-creates, which gives an `order` with `delete …` before `create a secret`, `instantiate` called twice, and a `deleteDocument` of
  `wf-1`/`conn-1`. `"an Update of a pipeline whose workflow was deleted in Studio…"` passes already, because it is
  today's behaviour.

- [ ] **Step 3: implement** in `sidecar/src/pipelines.ts`.

  Line 92: replace
  `/** The bearer the piece uses lasts long enough to be forgotten about; re-creating the pipeline mints a new one. */`
  with
  `/** The bearer the piece uses lasts long enough to be forgotten about; an Update mints a new one. */`

  Insert `modelConfig` directly after `const keyFor = …` (line 191):

```ts
  /** What a pipeline's connection says about its model: this launch's gateway, the model, and where it runs. */
  const modelConfig = (settings: AppSettings) => ({ llm_base_url: deps.gateway.url(), llm_default_model: settings.models.model, llm_locality: settings.models.local ? "local" : "hosted" });
```

  Replace `ensure()`, from `  /** Create (or re-create) this vault's pipeline. Nothing happens without a model key and a model. */` through
  its closing `  }` (the line before `/** Point a connection at the model settings…`), with:

```ts
  /**
   * Set up this vault's pipeline, or Update it. A pipeline whose workflow still exists is brought to the template in
   * place (updateInPlace): the workflow, its id and its runs stay. Without a record, or when the workflow was deleted
   * in Studio, it is created. Nothing happens without a model key and a model.
   */
  async function ensure(vaultId: string): Promise<EnsureResult> {
    const settings = deps.readSettings();
    const key = keyFor(settings);
    if (!modelsConfigured(settings) || !key) return { state: "unconfigured" };
    const template = deps.template;
    if (!template) throw new Error("The installed vault package ships no pipeline template (pieces/knowledge-vault/templates/pipeline.json).");
    const token = await engineToken(); // before anything is created: a refusal costs nothing
    const records = readPipelines(deps.dataDir);
    const previous = records[vaultId];
    if (previous && (await workflowStatus(previous.workflowId)) !== null) return updateInPlace(vaultId, previous, template, settings, token);
    if (previous) {
      // The workflow was deleted in Studio: what is left of the pipeline goes, and it is made anew.
      // The record goes first: a failure from here on reads "missing", never "ready" for a pipeline that no longer exists.
      delete records[vaultId];
      writePipelines(deps.dataDir, records);
      await discard(previous);
    }
    const name = await deps.vaultName(vaultId);
    const { id: workflowsDriveId } = await deps.workflowsDrive();
    const tokenRef = await createSecret(token.value, `${name} — engine token`);
    const llmRef = await createSecret(deps.gateway.key, `${name} — model gateway key`);
    let made: { workflowId: string; connectionId: string } | undefined;
    try {
      made = await instantiate({
        origin: deps.origin,
        template,
        vaultName: name,
        driveId: vaultId,
        workflowsDriveId,
        secretRefs: { token: tokenRef, llm: llmRef },
        llm: { baseUrl: deps.gateway.url(), model: settings.models.model },
        pieceVersion: deps.pieceVersion,
        now,
        fetchImpl: f,
      });
      const { workflowId, connectionId } = made;
      await updateConnectionModels(connectionId, settings);
      writePipelines(deps.dataDir, {
        ...readPipelines(deps.dataDir),
        [vaultId]: {
          workflowId,
          connectionId,
          secretRefs: { token: tokenRef, llm: llmRef },
          createdAt: now(),
          models: { endpoint: settings.models.endpoint, model: settings.models.model },
          token: { kind: token.kind, expiresAt: token.expiresAt },
          modelFromConnection: true,
          templateDigest: templateDigest(template),
          gatewayKeyed: true,
        },
      });
      await ensureReweave(vaultId);
      return { state: "ready", workflowId, connectionId };
    } catch (error) {
      // A failed instantiatePipeline removed its own documents. Once it has returned they are ours: the
      // config write or the record can still fail, and nothing would ever point at them again.
      if (made) for (const id of [made.workflowId, made.connectionId]) await deleteDocument(deps.origin, id, f).catch(() => undefined);
      // The two secrets are ours to remove either way.
      await deleteSecret(tokenRef);
      await deleteSecret(llmRef);
      throw error;
    }
  }

  /**
   * Update in place (spec §2): the pipeline keeps its workflow, the workflow's id, its runs and its place in the
   * Workflows drive. In order:
   *  1. two new secrets;
   *  2. the connection kept, or made from the template when it was deleted in Studio;
   *  3. the workflow brought to the template and published (replaceWorkflowInPlace, which rolls back to the last
   *     publish on a rejection);
   *  4. the template replayed onto the kept connection, with the new secret refs and the model settings, in one write;
   *  5. the record;
   *  6. the old secrets;
   *  7. the Reweave notes workflow.
   * A failure leaves the record as it was, so the chip still offers Update. Processing runs on the published workflow
   * throughout.
   */
  async function updateInPlace(vaultId: string, previous: PipelineRecord, template: PipelineTemplate, settings: AppSettings, token: EngineToken): Promise<EnsureResult> {
    const name = await deps.vaultName(vaultId);
    const made: string[] = []; // the secrets made for this Update, until the record holds them
    let connectionId = previous.connectionId;
    let newConnection: string | undefined;
    let restoreRefs: TemplateOp[] | undefined; // set once the kept connection may name the new secrets
    try {
      const tokenRef = await createSecret(token.value, `${name} — engine token`);
      made.push(tokenRef);
      const llmRef = await createSecret(deps.gateway.key, `${name} — model gateway key`);
      made.push(llmRef);
      const fill = { origin: deps.origin, template, vaultName: name, driveId: vaultId, secretRefs: { token: tokenRef, llm: llmRef }, llm: { baseUrl: deps.gateway.url(), model: settings.models.model }, pieceVersion: deps.pieceVersion, now, fetchImpl: f };
      if ((await globalState(connectionId)) === null) {
        const { id: workflowsDriveId } = await deps.workflowsDrive();
        newConnection = await createPipelineConnection({ ...fill, workflowsDriveId });
        connectionId = newConnection;
      }
      const filled = fillPipeline(fill, connectionId);
      await replaceWorkflowInPlace({ origin: deps.origin, workflowId: previous.workflowId, operations: filled.workflow, status: "ENABLED", now, fetchImpl: f });
      if (newConnection) {
        await updateConnectionModels(newConnection, settings);
      } else {
        restoreRefs = fillPipeline({ ...fill, secretRefs: previous.secretRefs }, connectionId).connection.filter((o) => o.type === "SET_SECRET_REF");
        const ops = filled.connection.map((o) => (o.type === "SET_CONFIG" ? { type: o.type, input: { config: { ...((o.input as { config?: Record<string, unknown> }).config ?? {}), ...modelConfig(settings) } } } : o));
        await execute(deps.origin, connectionId, toActions(ops, now), f);
      }
      // This record now, re-read: what another step wrote meanwhile (the Reweave notes workflow) is kept.
      const { disabled: _wasDisabled, ...kept } = readPipelines(deps.dataDir)[vaultId] ?? previous;
      writePipelines(deps.dataDir, {
        ...readPipelines(deps.dataDir),
        [vaultId]: {
          ...kept,
          workflowId: previous.workflowId,
          connectionId,
          secretRefs: { token: tokenRef, llm: llmRef },
          models: { endpoint: settings.models.endpoint, model: settings.models.model },
          token: { kind: token.kind, expiresAt: token.expiresAt },
          modelFromConnection: true,
          templateDigest: templateDigest(template),
          gatewayKeyed: true,
        },
      });
    } catch (error) {
      if (newConnection) await deleteDocument(deps.origin, newConnection, f).catch(() => undefined);
      // The connection's write may have landed in part: it is pointed back at the record's secrets before the new ones go.
      const restored = !restoreRefs || (await execute(deps.origin, connectionId, toActions(restoreRefs, now), f).then(() => true, () => false));
      if (restored) for (const ref of made) await deleteSecret(ref);
      else console.warn(`[pipelines] the connection of vault ${vaultId} may still name the secrets made for this Update; they are kept`);
      throw error;
    }
    for (const ref of [previous.secretRefs.token, previous.secretRefs.llm]) await deleteSecret(ref);
    // Switched off by the app (the record was disabled): switched on again, as setting it up again did.
    await ensureReweave(vaultId, { force: true, enable: previous.disabled !== undefined });
    return { state: "ready", workflowId: previous.workflowId, connectionId };
  }
```

  In `updateConnectionModels` (current lines 344-360), replace the config literal

```ts
          config: {
            ...config,
            llm_base_url: deps.gateway.url(),
            llm_default_model: settings.models.model,
            llm_locality: settings.models.local ? "local" : "hosted",
            ...(llmSecretRef ? { llm_api_key: llmSecretRef } : {}),
          },
```

  with

```ts
          config: {
            ...config,
            ...modelConfig(settings),
            ...(llmSecretRef ? { llm_api_key: llmSecretRef } : {}),
          },
```

  Replace `applyModels()`'s doc comment (lines 484-488, `/**\n     * Settings › Models changed: every pipeline follows. …`) with:

```ts
    /**
     * Settings › Models changed: every pipeline follows. A pipeline whose steps defer to the connection gets its
     * connection's config rewritten in place. An older one, with the model baked into its steps or made from another
     * template, is brought to the template in place by ensure(); it is listed under `recreated`, a name kept for the
     * control API. Either way its runs and history are kept. Disabled pipelines stay disabled.
     */
```

- [ ] **Step 4: run.** `bunx vitest run sidecar/src`, then `bun run tsc`.
  Expected: all sidecar tests pass, and both `tsc` runs (sidecar, host) are clean.

- [ ] **Step 5: commit.**

```bash
git add sidecar/src/pipelines.ts sidecar/src/pipelines.test.ts
git commit -m "feat(sidecar): Update brings the pipeline to its template in place

The workflow, its id and its runs stay. New secrets come first and old ones go
last. The workflow is published only after every edit is accepted and is
reverted on a rejection. The connection is pointed back at its old secrets if
its write fails.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

---

### Task 31: The chip's button reads "Updating…" during an Update (part 2, draft label F2.5)

**Files** (repo `knowledge-vault-app`):
- Modify `host/src/components/PipelineChip.tsx:71`.
- Test `host/src/components/PipelineChip.test.tsx`: one new test before the final `});` (line 48).

**Interfaces:** Consumes `PipelineStatus` (`stale` / `missing`, unchanged by §1). Produces no new names.

- [ ] **Step 1: write the failing test.** In `host/src/components/PipelineChip.test.tsx`, insert before the last
  line `});`:

```tsx
  it("reads Updating… while an Update runs, and Setting up… while a first setup runs", async () => {
    let finish: (s: PipelineStatus) => void = () => undefined;
    const setupPipeline = vi.fn(() => new Promise<PipelineStatus>((resolve) => { finish = resolve; }));
    const stale: PipelineStatus = { state: "stale", reason: "a newer version of the pipeline is available", workflowId: "wf", connectionId: "c" };
    render(<PipelineChip info={info} vaultId="v1" api={{ fetchPipeline: vi.fn(async () => stale), setupPipeline }} onModels={() => {}} onRuns={() => {}} pollMs={60_000} />);
    fireEvent.click(await screen.findByRole("button", { name: "Update" }));
    expect(await screen.findByRole("button", { name: "Updating…" })).toBeTruthy();
    finish(stale);
    expect(await screen.findByRole("button", { name: "Update" })).toBeTruthy();
    cleanup();

    render(<PipelineChip info={info} vaultId="v1" api={{ fetchPipeline: vi.fn(async (): Promise<PipelineStatus> => ({ state: "missing" })), setupPipeline }} onModels={() => {}} onRuns={() => {}} pollMs={60_000} />);
    fireEvent.click(await screen.findByRole("button", { name: "Set up" }));
    expect(await screen.findByRole("button", { name: "Setting up…" })).toBeTruthy();
    finish({ state: "missing" });
    expect(await screen.findByRole("button", { name: "Set up" })).toBeTruthy();
  });
```

- [ ] **Step 2: run.** `bunx vitest run host/src/components/PipelineChip.test.tsx`
  Expected: 1 failed with `Unable to find role="button" and name "Updating…"`, because today the button reads
  "Setting up…".

- [ ] **Step 3: implement.** In `host/src/components/PipelineChip.tsx`, replace line 71:

```tsx
          {busy && d.action === "setup" ? "Setting up…" : d.actionLabel}
```

  with:

```tsx
          {busy && d.action === "setup" ? (status.state === "stale" ? "Updating…" : "Setting up…") : d.actionLabel}
```

- [ ] **Step 4: run.** `bunx vitest run host/src/components/PipelineChip.test.tsx`, then `bun run check`.
  Expected: all pass.

- [ ] **Step 5: commit.**

```bash
git add host/src/components/PipelineChip.tsx host/src/components/PipelineChip.test.tsx
git commit -m "feat(host): the processing chip reads Updating… while an Update runs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Part 1: Processing chip and the repair route (§1, §9)

# Part 1 — The processing chip reads the work (§1) and the repair route goes (§9)

All tasks are in the **knowledge-vault-app** repo (branch `dev`), run from its root
(`/home/beast/Documents/Powerhouse/knowledge-vault-app`). Every line number below was read on 2026-10-16 at `f43fa26`.

## Notes for the assembler

- **Line drift against the spec.** `status()` is `sidecar/src/pipelines.ts:526-563` (doc comment from 526, query at 546 ✓).
  `pipeline-chip.ts` rules are now `:22-40` (010e7bf added the PENDING row at `:24-25`). The watchdog's live-run test
  is `queue-watchdog.ts:173`, not `:146`; its 2-minute timer is `:289-290`, not `:260-261`. `ENGINE_STARTED_AT` is
  `main.ts:55`. The repair route is `control.ts:372-373` (spec `:365-366`), its dep `control.ts:67-68`, its wiring
  `main.ts:399-403` (spec `386-390`), and its test `control.test.ts:396-405`. The test dep stub is
  `control.test.ts:74`. Landing's test lives at `host/src/landing/Landing.test.tsx:232`, though the component is in
  `host/src/screens/Landing.tsx:228`.
- **The "queued" run from 010e7bf.** Per §1 a PENDING (queued) run counts as running, so "Processing: waiting its
  turn…" (pipeline-chip.ts:24-25) is **dropped**. A queued run now reads under row 9, "Processing… N sources to go".
  `run-problems.ts`'s interrupted patterns from 010e7bf stay as they are and feed row 10.
- **Functions this part touches, for the §2 (Update in place) part:**
  - In `sidecar/src/pipelines.ts`: the `PipelineStatus` type (`:37-49`), `PipelineManagerDeps` (one new field,
    `engineStartedAt`, after `engineProtected` at `:87`), new module-level helpers after `runtimeMissing`
    (`:137`), a new closure block after `keyFor` (`:191`), and `status()` (`:526-563`). I do **not** touch
    `ensure`, `ensureReweave`, `discard`, `execute`, `followTemplate` or the comment at `:412`.
  - In `host/src/components/PipelineChip.tsx`: only the `tooltip` line (`:55`). The button label line (`:72`,
    "Setting up…") and `setup()` are §2's.
  - In `sidecar/src/main.ts`: one line added to the `createPipelineManager({...})` call (`:316`), and (§9) the import at
    `:43` plus the `repairQueue` dep at `:399-403`. The comments at `:296-300` and `:527` are not mine.
- **Decision: the host's new fields are optional.** `POST /vaults/:id/pipeline` returns `ensure()`'s result,
  `{ state: "ready", workflowId, connectionId }`, and `PipelineChip.setup()` stores it as a `PipelineStatus` until the
  next poll. The onboarding mock does the same. So in `host/src/vaults.ts`, `running`, `waiting`, `failures` and
  `hasRuns` are optional, and every reader defaults them (`?? 0`, `?? []`). They stay required in the sidecar's own type.
- **Decision: singular forms.** The spec gives only plurals for rows 9 and 12. The plan uses "1 source to go" and
  "1 source waiting", to match row 11's "1 source failed".
- **Decision: "Processing… · 1 failed".** With failures and an unknown or zero count, row 9 reads
  "Processing… · 1 failed".
- **Decision: what happens when the queue cannot be read.** Check 3 (task still open) cannot run when the queue is
  missing or unreadable. The candidate failures are then **kept**, so a failure never disappears silently.
  `waiting` is `null`, as the spec says.
- **Decision, a deviation to approve or drop: the onboarding overview and an interrupted run.** The spec says
  "a model-setup failure's own message; otherwise Processing failed for N". The plan also shows an **interrupted**
  failure's own message ("…it is processed again on its own."). Otherwise the guide would say "failed" while the chip
  says "resumes on its own". To follow the spec literally, delete `|| newest.problem.kind === "interrupted"` in Task F3
  and its test line.
- **Not verified live:** the exact shape of `triggerPayload`. The plan reads `task_id`, `source_id` and
  `source_title` at the payload's top level, as the spec says was confirmed on Liberuum. It also accepts a JSON string.
  The runtime types it `Unknown`, and its rows go through `parseJson`.
- **Typed queue query.** The query shape `PipelineQueue { document(idOrSlug) { document { state { global { … } } } } }`
  matches reactor-api's generated schema: `${Name}Queries.document(idOrSlug)`, then `_DocumentWithChildren.document`,
  then `_FullState.global`.
- **e2e:** `e2e/pipeline.spec.ts:79-96` reads `lastRun` and matches "Last processing run failed". Task F5 moves it to
  the new fields. It needs the Playwright stack, so it is not part of a vitest run.
- **Order:** F1 (sidecar) → F2 (chip) → F3 (overview) → F4 (landing; removes `lastRun` from the host type) → F5 (e2e).
  F6 (§9) is independent. `bun run tsc` passes after every task: `lastRun` stays in the host type until F4 removes its
  last reader.

---

### Task 32: `status()` reads the runs, the waiting count and the current failures (part 1, draft label F1)

**Files (knowledge-vault-app):**
- Modify `sidecar/src/pipelines.ts`:
  - the type at `:37-49`;
  - `PipelineManagerDeps` at `:69-90`;
  - after `runtimeMissing` at `:137`;
  - inside `createPipelineManager`, after `keyFor` at `:191`;
  - `status()` at `:526-563`.
- Modify `sidecar/src/main.ts:316` (the `createPipelineManager` call).
- Test `sidecar/src/pipelines.test.ts`: rewrite the case at `:125-145` and add a new `describe` after `:155`.

**Interfaces:**
- Consumes:
  - `classifyRunError` and `RunProblem` (`sidecar/src/run-problems.ts`);
  - `gql` (`reactor-gql.ts`);
  - `ENGINE_STARTED_AT` (`main.ts:55`).
- Produces:
  - `export type PipelineFailure = { runId: string; source: string; at: string | null; error: string | null; problem?: RunProblem }`.
  - The `ready` variant of `PipelineStatus` gains `running: number; waiting: number | null; failures: PipelineFailure[]; hasRuns: boolean` and loses `lastRun`.
  - `PipelineManagerDeps.engineStartedAt?: string`.
  - `export function isLiveRun(run: { status: string; startedAt?: string | null }, engineStartedAt?: string): boolean`.
  - `export function runTask(payload: unknown): { taskId: string; source: string } | null`.
  - `export type RunRow`.
  - `export function failureCandidates(runs: readonly RunRow[], engineStartedAt?: string): Array<{ taskId: string; failure: PipelineFailure }>`.
  - `GET /vaults/:id/pipeline` now answers with this shape.

- [ ] **Step 1: write the failing tests.** In `sidecar/src/pipelines.test.ts`, replace the whole first `it(...)` of
  `describe("pipeline manager — status and removal", …)` (`:125-145`) with:

```ts
  it("is unconfigured without a key, missing without a record, and otherwise this vault's trigger and its work only", async () => {
    const none = deps({ hasKey: false });
    expect(await none.manager.status("vault1")).toEqual({ state: "unconfigured" });
    const fresh = deps();
    expect(await fresh.manager.status("vault1")).toEqual({ state: "missing" });
    const two = deps({ triggers: [{ workflowId: "wf-1", status: "ENABLED" }, { workflowId: "wf-other", status: "DISABLED" }] });
    const models = { endpoint: "https://openrouter.ai/api/v1", model: "openai/gpt-6-luna" };
    const token = { kind: "minted" as const, expiresAt: "2027-01-05T10:00:00.000Z" };
    writePipelines(two.dataDir, {
      vault1: { workflowId: "wf-1", connectionId: "conn-1", secretRefs: { token: "s1", llm: "s2" }, createdAt: "x", models, token, templateDigest: templateDigest(template) },
      vault2: { workflowId: "wf-other", connectionId: "conn-2", secretRefs: { token: "s3", llm: "s4" }, createdAt: "x", models, token, templateDigest: templateDigest(template) },
    });
    // The fake's run failed with no task in its payload (a test run): it is not a current failure. Its drive has no queue: waiting is unknown.
    expect(await two.manager.status("vault1")).toEqual({
      state: "ready",
      workflowId: "wf-1",
      connectionId: "conn-1",
      trigger: { status: "ENABLED", lastPollAt: "2026-10-07T10:00:00.000Z", lastError: null },
      running: 0,
      waiting: null,
      failures: [],
      hasRuns: true,
    });
    expect((await two.manager.status("vault2")).state === "ready" && (await two.manager.status("vault2") as { trigger?: { status: string } }).trigger?.status).toBe("DISABLED");
  });
```

  Then add this block after the `describe("pipeline manager — status and removal", …)` block (after `:155`):

```ts
describe("pipeline manager — status reads the work, not the last run", () => {
  type Run = { id: string; status: string; startedAt: string | null; endedAt: string | null; error: string | null; triggerPayload?: unknown };
  const ENGINE_UP = "2026-10-07T09:00:00.000Z";
  /** A pipeline run as the runtime lists it; `task` gives it the trigger's payload (the queue task and its source). */
  const run = (id: string, status: string, task?: string, over: Partial<Run> = {}): Run => ({
    id,
    status,
    startedAt: "2026-10-07T09:50:00.000Z",
    endedAt: status === "FAILED" || status === "SUCCEEDED" ? "2026-10-07T09:55:00.000Z" : null,
    error: status === "FAILED" ? "boom" : null,
    ...(task ? { triggerPayload: { task_id: task, source_id: `src-${task}`, source_title: `Source ${task}`, phase: "extract", queued_at: null } } : {}),
    ...over,
  });
  /** The engine as status() reads it: the runs, the vault's drive (to find its queue), and the queue's typed reads. */
  function workEngine(opts: { runs: Run[]; activeCount?: number; tasks?: Array<{ id: string; status: string }>; queueUnreadable?: boolean; noQueue?: boolean }) {
    const queries: string[] = [];
    const answer = (data: unknown) => ({ ok: true, json: async () => ({ data }) });
    const fetchImpl = vi.fn(async (_u: unknown, init?: { body?: unknown }) => {
      const q = (JSON.parse(String(init?.body)) as Call).query;
      queries.push(q);
      if (q.includes("triggerStates")) return answer({ workflowRuntime: { triggerStates: [{ workflowId: "wf-1", status: "ENABLED", lastPollAt: null, lastError: null }], runsPage: { items: opts.runs } } });
      if (q.includes("PipelineQueue")) {
        if (opts.queueUnreadable) return { ok: true, json: async () => ({ errors: [{ message: "Document queue-1 not found" }] }) };
        const global = q.includes("activeCount") ? { activeCount: opts.activeCount ?? 0 } : { tasks: opts.tasks ?? [] };
        return answer({ PipelineQueue: { document: { document: { state: { global } } } } });
      }
      if (q.includes("document { state }")) {
        const nodes = opts.noQueue ? [] : [{ id: "queue-1", documentType: "bai/pipeline-queue" }, { id: "src-t1", documentType: "bai/source" }];
        return answer({ document: { document: { state: { global: { nodes } } } } });
      }
      throw new Error(`unexpected query: ${q}`);
    }) as unknown as typeof fetch;
    return { fetchImpl, queries };
  }
  function setUp(opts: Parameters<typeof workEngine>[0]) {
    const engine = workEngine(opts);
    const h = deps({ fetchImpl: engine.fetchImpl, engineStartedAt: ENGINE_UP });
    writePipelines(h.dataDir, {
      vault1: { workflowId: "wf-1", connectionId: "conn-1", secretRefs: { token: "s1", llm: "s2" }, createdAt: "x", models: { endpoint: "https://openrouter.ai/api/v1", model: "openai/gpt-6-luna" }, token: { kind: "minted", expiresAt: "2027-01-05T10:00:00.000Z" }, templateDigest: templateDigest(template) },
    });
    return { ...h, queries: engine.queries };
  }

  it("counts the runs in progress or queued in this engine, and the queue's open tasks with a typed read", async () => {
    const { manager, queries } = setUp({
      runs: [run("r4", "RUNNING", "t4"), run("r3", "PENDING", "t3"), run("r2", "RUNNING", "t2", { startedAt: "2026-10-07T08:00:00.000Z" }), run("r1", "SUCCEEDED", "t1")],
      activeCount: 869,
    });
    expect(await manager.status("vault1")).toEqual({
      state: "ready",
      workflowId: "wf-1",
      connectionId: "conn-1",
      trigger: { status: "ENABLED", lastPollAt: null, lastError: null },
      running: 2, // r2 began before this engine came up: it was cut off with the previous one
      waiting: 869,
      failures: [],
      hasRuns: true,
    });
    expect(queries.some((q) => q.includes("runsPage(workflowId: $w, paging: { limit: 20 })") && q.includes("triggerPayload"))).toBe(true);
    expect(queries.some((q) => q.includes("PipelineQueue { document(idOrSlug: $id) { document { state { global { activeCount } } } } }"))).toBe(true);
    expect(queries.some((q) => q.includes("tasks"))).toBe(false); // no failed run: the tasks are never read
  });

  it("a failed run counts while its task is still open: once per task, never after a later run of it, never without a task", async () => {
    const credit = "The model provider refused to ask openai/gpt-6-luna (402): insufficient credits";
    const { manager } = setUp({
      runs: [
        run("r6", "RUNNING", "t6"),
        run("s3", "SUCCEEDED", "t3"),
        run("f1-new", "FAILED", "t1", { error: credit }),
        run("manual", "FAILED"), // a test run from Workflow Studio carries no task
        run("f6", "FAILED", "t6"), // t6 is running again now
        run("f2", "FAILED", "t2"), // t2 is done
        run("f3", "FAILED", "t3"), // a later run of t3 succeeded
        run("f1-old", "FAILED", "t1"), // t1 counts once, as its newest failure
        run("f4", "FAILED", "t4", { startedAt: "2026-10-07T09:40:00.000Z", endedAt: null }),
      ],
      activeCount: 4,
      tasks: [
        { id: "t1", status: "IN_PROGRESS" },
        { id: "t2", status: "DONE" },
        { id: "t3", status: "PENDING" },
        { id: "t4", status: "BLOCKED" },
        { id: "t6", status: "IN_PROGRESS" },
      ],
    });
    const status = await manager.status("vault1");
    expect(status).toMatchObject({ state: "ready", running: 1, waiting: 4, hasRuns: true });
    expect(status.state === "ready" && status.failures).toEqual([
      { runId: "f1-new", source: "Source t1", at: "2026-10-07T09:55:00.000Z", error: credit, problem: { kind: "no-funds", message: "Your model provider refused the request: the account is out of credit.", model: "openai/gpt-6-luna" } },
      { runId: "f4", source: "Source t4", at: "2026-10-07T09:40:00.000Z", error: "boom" },
    ]);
  });

  it("keeps the five newest current failures", async () => {
    const ids = ["t1", "t2", "t3", "t4", "t5", "t6", "t7"];
    const { manager } = setUp({ runs: ids.map((t) => run(`f-${t}`, "FAILED", t)), activeCount: 7, tasks: ids.map((id) => ({ id, status: "PENDING" })) });
    const status = await manager.status("vault1");
    expect(status.state === "ready" && status.failures.map((f) => f.runId)).toEqual(["f-t1", "f-t2", "f-t3", "f-t4", "f-t5"]);
  });

  it("reads waiting as unknown when the queue cannot be read, and then keeps the failures it cannot check", async () => {
    const unreadable = setUp({ runs: [run("f1", "FAILED", "t1")], queueUnreadable: true });
    expect(await unreadable.manager.status("vault1")).toMatchObject({ waiting: null, failures: [{ runId: "f1", source: "Source t1" }] });
    const none = setUp({ runs: [], noQueue: true });
    expect(await none.manager.status("vault1")).toMatchObject({ running: 0, waiting: null, failures: [], hasRuns: false });
  });

  it("finds the vault's queue once and remembers it", async () => {
    const { manager, queries } = setUp({ runs: [], activeCount: 0 });
    expect(await manager.status("vault1")).toMatchObject({ waiting: 0, hasRuns: false });
    await manager.status("vault1");
    expect(queries.filter((q) => q.includes("document { state }")).length).toBe(1);
  });
});
```

- [ ] **Step 2: run.** `bunx vitest run sidecar/src/pipelines.test.ts`
  Expected: FAIL. These tests fail: the rewritten "…its work only" case and all five new cases. The answer still
  carries `lastRun`, and it has no `running`, `waiting`, `failures` or `hasRuns` (e.g.
  `expected { state: 'ready', …(4) } to deeply equal { state: 'ready', …(7) }`). The runs query asks for
  `limit: 1` with no `triggerPayload`.

- [ ] **Step 3: implement.**

  **3a.** In `sidecar/src/pipelines.ts`, replace the `PipelineStatus` type (`:37-49`, from
  `export type PipelineStatus =` to the `};` before `export type EnsureResult`) with:

```ts
/** A failed run whose work still waits (spec §1): which source, when, and what went wrong. */
export type PipelineFailure = {
  runId: string;
  /** The source's title from the run's payload (its id when the title is empty). */
  source: string;
  at: string | null;
  error: string | null;
  /** What the error means, when the engine can tell (run-problems.ts). */
  problem?: RunProblem;
};
export type PipelineStatus =
  | { state: "unconfigured" }
  | { state: "missing" }
  /** The workflow runtime is not up yet: after an unclean exit the engine waits out the previous one's lease (up to a minute). */
  | { state: "starting" }
  | { state: "stale"; reason: string; workflowId: string; connectionId: string }
  | {
      state: "ready";
      workflowId: string;
      connectionId: string;
      trigger?: { status: string; lastPollAt: string | null; lastError: string | null };
      /** Runs in progress or queued in the runtime that began since this engine came up. */
      running: number;
      /** The queue's open tasks (PENDING, IN_PROGRESS, BLOCKED); null when the queue cannot be read. */
      waiting: number | null;
      /** Failed runs whose task is still open: newest first, one per task, at most five. */
      failures: PipelineFailure[];
      /** The pipeline has run at least once (among its latest runs). */
      hasRuns: boolean;
    };
```

  **3b.** In `PipelineManagerDeps`, find these lines (`:86-87`):

```ts
  /** A protected engine answers only authenticated callers: its pipeline must run as the signed-in user. */
  engineProtected?: boolean;
```

  and add right after them:

```ts
  /** When this engine came up: a run recorded as running from before then was cut off with the previous one. */
  engineStartedAt?: string;
```

  **3c.** After the line
  `export const runtimeMissing = (error: unknown) => /Cannot query field "workflowRuntime"/.test(error instanceof Error ? error.message : String(error));`
  (`:137`), add:

```ts

/** How many of the pipeline's latest runs status() reads, and how many current failures it reports. */
const RUNS_READ = 20;
const MAX_FAILURES = 5;
/** A queue task that still waits for its work (the queue's activeCount counts the same three). */
const OPEN_TASK = new Set(["PENDING", "IN_PROGRESS", "BLOCKED"]);

/** A run as status() reads it from the runtime. */
export type RunRow = { id: string; status: string; startedAt: string | null; endedAt: string | null; error: string | null; triggerPayload?: unknown };

/**
 * A run in progress or queued in the runtime (the watchdog's test). One that began before this engine came up was
 * cut off with the previous one, however its record reads.
 */
export function isLiveRun(run: { status: string; startedAt?: string | null }, engineStartedAt?: string): boolean {
  return /running|pending|queued/i.test(run.status) && !(engineStartedAt && run.startedAt && run.startedAt < engineStartedAt);
}

/** The queue task a pipeline run works on, from its trigger's payload (new-pipeline-task.ts); null for a manual or test run. */
export function runTask(payload: unknown): { taskId: string; source: string } | null {
  let value = payload;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const p = value as Record<string, unknown>;
  const taskId = typeof p.task_id === "string" ? p.task_id : "";
  if (!taskId) return null;
  const title = typeof p.source_title === "string" ? p.source_title.trim() : "";
  const sourceId = typeof p.source_id === "string" ? p.source_id : "";
  return { taskId, source: title || sourceId || "an untitled source" };
}

/**
 * The failed runs that may still block work, newest first (the runtime lists runs newest first): a run that names a
 * task, the newest failure of that task, with no later run of it in progress or succeeded. Whether the task is still
 * open is checked against the queue afterwards.
 */
export function failureCandidates(runs: readonly RunRow[], engineStartedAt?: string): Array<{ taskId: string; failure: PipelineFailure }> {
  const out: Array<{ taskId: string; failure: PipelineFailure }> = [];
  const settled = new Set<string>();
  for (const run of runs) {
    const task = runTask(run.triggerPayload);
    if (!task || settled.has(task.taskId)) continue;
    if (run.status === "SUCCEEDED" || isLiveRun(run, engineStartedAt)) {
      settled.add(task.taskId);
      continue;
    }
    if (run.status !== "FAILED") continue;
    settled.add(task.taskId);
    const problem = classifyRunError(run.error);
    out.push({ taskId: task.taskId, failure: { runId: run.id, source: task.source, at: run.endedAt ?? run.startedAt, error: run.error, ...(problem ? { problem } : {}) } });
  }
  return out;
}
```

  **3d.** In `createPipelineManager`, after the line
  `const keyFor = (settings: AppSettings) => (settings.models.local ? LOCAL_PLACEHOLDER_KEY : deps.readModelKey());`
  (`:191`), add:

```ts

  // The vault's queue, found once in its drive (as the watchdog finds it) and remembered; read with typed queries
  // for one field each, never the whole queue.
  const queueIds = new Map<string, string>();
  async function queueIdOf(vaultId: string): Promise<string | undefined> {
    const known = queueIds.get(vaultId);
    if (known) return known;
    const drive = await gql<{ document: { document: { state: { global: { nodes?: Array<{ id: string; documentType?: string | null }> } } } } }>(
      deps.origin,
      `query($id: String!) { document(idOrSlug: $id) { document { state } } }`,
      { id: vaultId },
      f,
    );
    const id = drive.document.document.state.global.nodes?.find((n) => n.documentType === "bai/pipeline-queue")?.id;
    if (id) queueIds.set(vaultId, id);
    return id;
  }
  type QueueRead<T> = { PipelineQueue: { document: { document: { state: { global: T } } } | null } };
  async function activeCount(queueId: string): Promise<number> {
    const data = await gql<QueueRead<{ activeCount: number }>>(
      deps.origin,
      `query($id: String!) { PipelineQueue { document(idOrSlug: $id) { document { state { global { activeCount } } } } } }`,
      { id: queueId },
      f,
    );
    if (!data.PipelineQueue.document) throw new Error(`the queue ${queueId} is gone`);
    return data.PipelineQueue.document.document.state.global.activeCount;
  }
  async function openTaskIds(queueId: string): Promise<Set<string>> {
    const data = await gql<QueueRead<{ tasks: Array<{ id: string; status: string }> }>>(
      deps.origin,
      `query($id: String!) { PipelineQueue { document(idOrSlug: $id) { document { state { global { tasks { id status } } } } } } }`,
      { id: queueId },
      f,
    );
    if (!data.PipelineQueue.document) throw new Error(`the queue ${queueId} is gone`);
    return new Set(data.PipelineQueue.document.document.state.global.tasks.filter((t) => OPEN_TASK.has(t.status)).map((t) => t.id));
  }
```

  **3e.** Replace `status()` with its doc comment (`:526-563`, from `    /**` /
  `     * This vault's pipeline as the runtime sees it: its trigger (filtered to its workflow) and its` through the
  closing `    },` before `/** Delete the pipeline's documents…`) with:

```ts
    /**
     * This vault's pipeline as the runtime sees it, or `stale` with the reason when what it was set up with no longer
     * holds. Spec §1: the work, not the last run. `running` counts the runs going now, `waiting` counts the queue's open
     * tasks, and `failures` lists the failed runs whose task is still open. A failure stops counting once its task is
     * done or dropped, or once a later run of it is going or has succeeded.
     */
    async status(vaultId: string): Promise<PipelineStatus> {
      const settings = deps.readSettings();
      if (!modelsConfigured(settings)) return { state: "unconfigured" };
      const record = readPipelines(deps.dataDir)[vaultId];
      if (!record) return { state: "missing" };
      const stale = staleReason(record, settings);
      if (stale) return { state: "stale", reason: stale, workflowId: record.workflowId, connectionId: record.connectionId };
      let data: {
        workflowRuntime: {
          triggerStates: Array<{ workflowId: string; status: string; lastPollAt: string | null; lastError: string | null }>;
          runsPage: { items: RunRow[] };
        };
      };
      try {
        data = await gql(
          deps.origin,
          `query($w: String!) { workflowRuntime { triggerStates { workflowId status lastPollAt lastError } runsPage(workflowId: $w, paging: { limit: ${RUNS_READ} }) { items { id status startedAt endedAt error triggerPayload } } } }`,
          { w: record.workflowId },
          f,
        );
      } catch (error) {
        if (runtimeMissing(error)) return { state: "starting" };
        throw error;
      }
      const trigger = data.workflowRuntime.triggerStates.find((t) => t.workflowId === record.workflowId);
      const runs = data.workflowRuntime.runsPage.items;
      const running = runs.filter((r) => isLiveRun(r, deps.engineStartedAt)).length;
      const queueId = await queueIdOf(vaultId).catch(() => undefined);
      const waiting = queueId
        ? await activeCount(queueId).catch(() => {
            queueIds.delete(vaultId); // found again on the next read, in case the queue was replaced
            return null;
          })
        : null;
      let candidates = failureCandidates(runs, deps.engineStartedAt);
      // Only now are the tasks read, and only when a failure could still count. A queue that cannot be read keeps them.
      if (candidates.length && queueId) {
        const open = await openTaskIds(queueId).catch(() => null);
        if (open) candidates = candidates.filter((c) => open.has(c.taskId));
      }
      return {
        state: "ready",
        workflowId: record.workflowId,
        connectionId: record.connectionId,
        ...(trigger ? { trigger: { status: trigger.status, lastPollAt: trigger.lastPollAt, lastError: trigger.lastError } } : {}),
        running,
        waiting,
        failures: candidates.slice(0, MAX_FAILURES).map((c) => c.failure),
        hasRuns: runs.length > 0,
      };
    },
```

  **3f.** In `sidecar/src/main.ts`, in the `createPipelineManager({ … })` call, find

```ts
    vaultName: async (id) => (await listVaultDrives(origin, engineFetch)).find((v) => v.id === id)?.name ?? "Vault",
    engineProtected: cfg.protected,
  });

  // Starter workflows
```

  and change the `engineProtected` line to these two lines:

```ts
    engineProtected: cfg.protected,
    engineStartedAt: ENGINE_STARTED_AT,
```

  (`classifyRunError` and `RunProblem` are already imported at `pipelines.ts:8`.)

- [ ] **Step 4: run.**
  - `bunx vitest run sidecar/src/pipelines.test.ts`. Expected: PASS, all tests.
  - `bun run --cwd sidecar tsc`. Expected: no errors.
  - `bun run tsc`. Expected: no errors. The host keeps its own `PipelineStatus` until Task F2.

- [ ] **Step 5: commit.**

```
git add sidecar/src/pipelines.ts sidecar/src/pipelines.test.ts sidecar/src/main.ts
git commit -m "feat(processing): the pipeline status reads the work, not the last run

status() reads the workflow's 20 latest runs with their payloads, the queue's
activeCount (a typed read of one field) and, only when a failed run could
still count, the queue's task ids and statuses. It reports the runs going now,
the sources waiting, and the failed runs whose task is still open. A failure
whose source was deleted or queued again stops counting. lastRun is gone.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

---

### Task 33: The chip's rules and tooltip follow the work (part 1, draft label F2)

**Files (knowledge-vault-app):**
- Modify `host/src/vaults.ts:111-125` (the `RunProblem` and `PipelineStatus` types).
- Modify `host/src/components/pipeline-chip.ts`. It is rewritten whole (`:1-41`).
- Modify `host/src/components/PipelineChip.tsx:55`, the `tooltip` line only.
- Test: rewrite `host/src/components/pipeline-chip.test.ts` whole. In `host/src/components/PipelineChip.test.tsx`,
  edit `:28-48`.

**Interfaces:**
- Consumes: the `ready` shape from Task F1, as served by `GET /vaults/:id/pipeline`.
- Produces:
  - `host/src/vaults.ts`: `export type PipelineFailure` (same fields as in the sidecar). The `ready` variant gets the
    optional fields `running?: number; waiting?: number | null; failures?: PipelineFailure[]; hasRuns?: boolean`.
    `lastRun?` is kept, marked deprecated, until Task F4.
  - `pipeline-chip.ts`:
    - `ChipDescription` gains `tooltip?: string`;
    - `export function isModelSetupProblem(kind: RunProblem["kind"]): boolean`, which Task F3 uses.

- [ ] **Step 1: write the failing tests.** Replace all of `host/src/components/pipeline-chip.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import type { PipelineFailure, PipelineStatus, RunProblem } from "../vaults.js";
import { describePipeline, isModelSetupProblem } from "./pipeline-chip.js";

const trigger = { status: "ENABLED", lastPollAt: null, lastError: null };
const ready = (over: Record<string, unknown> = {}) => ({ state: "ready", workflowId: "wf", connectionId: "c", trigger, running: 0, waiting: 0, failures: [], hasRuns: false, ...over }) as PipelineStatus;
const failure = (over: Partial<PipelineFailure> = {}): PipelineFailure => ({ runId: "r1", source: "Foreword", at: "2026-10-15T19:36:00.000Z", error: "boom", ...over });
const problem = (kind: RunProblem["kind"], message = "why"): RunProblem => ({ kind, message });
const seeRuns = { action: "runs", actionLabel: "See runs" } as const;

describe("describePipeline — the user's word is processing", () => {
  it("names each state before the work in the user's vocabulary with the one action that fixes it", () => {
    expect(describePipeline({ state: "unconfigured" })).toEqual({ label: "Processing off", tone: "action", action: "models", actionLabel: "Set up a model" });
    expect(describePipeline({ state: "missing" })).toEqual({ label: "Processing not set up", tone: "action", action: "setup", actionLabel: "Set up" });
    expect(describePipeline({ state: "starting" })).toEqual({ label: "Processing starts in a moment", tone: "quiet" });
    // A park also writes the trigger's lastError; the park is what the person needs to know.
    expect(describePipeline(ready({ trigger: { status: "PARKED", lastPollAt: null, lastError: "Workflow parked after run r1" } }))).toEqual({ label: "Processing paused after a failed run", tone: "warn", ...seeRuns });
    expect(describePipeline({ state: "stale", reason: "the model settings changed", workflowId: "wf", connectionId: "c" })).toEqual({ label: "Processing needs an update", tone: "action", action: "setup", actionLabel: "Update" });
    expect(describePipeline(ready({ trigger: { status: "DISABLED", lastPollAt: null, lastError: null } }))).toEqual({ label: "Processing paused", tone: "quiet", ...seeRuns });
    expect(describePipeline(ready({ trigger: { status: "ENABLED", lastPollAt: null, lastError: "poll failed" } }))).toEqual({ label: "Processing: trigger error", tone: "warn", ...seeRuns });
  });

  it("reads the work: running (queued runs too), waiting, then finished", () => {
    expect(describePipeline(ready())).toEqual({ label: "Processing ready", tone: "ok" });
    expect(describePipeline(ready({ hasRuns: true }))).toEqual({ label: "Processing up to date", tone: "ok" });
    expect(describePipeline(ready({ running: 3, waiting: 869, hasRuns: true }))).toEqual({ label: "Processing… 869 sources to go", tone: "busy" });
    expect(describePipeline(ready({ running: 1, waiting: 1 }))).toEqual({ label: "Processing… 1 source to go", tone: "busy" });
    // The count is unknown (the queue could not be read) or already 0: just "Processing…".
    expect(describePipeline(ready({ running: 1, waiting: null }))).toEqual({ label: "Processing…", tone: "busy" });
    expect(describePipeline(ready({ running: 1, waiting: 0 }))).toEqual({ label: "Processing…", tone: "busy" });
    expect(describePipeline(ready({ waiting: 869, hasRuns: true }))).toEqual({ label: "Processing: 869 sources waiting", tone: "quiet" });
    expect(describePipeline(ready({ waiting: 1 }))).toEqual({ label: "Processing: 1 source waiting", tone: "quiet" });
    expect(describePipeline(ready({ waiting: null, hasRuns: true }))).toEqual({ label: "Processing up to date", tone: "ok" });
  });

  it("an answer without the work — what setting the pipeline up returns — reads ready", () => {
    expect(describePipeline({ state: "ready", workflowId: "wf", connectionId: "c" })).toEqual({ label: "Processing ready", tone: "ok" });
  });

  it("names a model-setup failure first, in plain words, even while other runs go on", () => {
    const labels: Record<"no-funds" | "bad-key" | "rate-limited" | "slow-model" | "model-missing" | "model-refused", string> = {
      "no-funds": "Processing stopped: your model provider account is out of credit",
      "bad-key": "Processing stopped: your model provider refused the API key",
      "rate-limited": "Processing stopped: your model provider is rate-limiting requests",
      "slow-model": "Processing stopped: the model did not answer in time",
      "model-missing": "Processing stopped: the model is not available at your provider",
      "model-refused": "Processing stopped: the model refused the request",
    };
    for (const [kind, label] of Object.entries(labels)) {
      const status = ready({ running: 2, waiting: 10, failures: [failure({ problem: problem(kind as keyof typeof labels, "The provider said no.") })] });
      expect(describePipeline(status)).toEqual({ label, tone: "warn", ...seeRuns, tooltip: "“Foreword”: The provider said no." });
      expect(isModelSetupProblem(kind as keyof typeof labels)).toBe(true);
    }
    expect(isModelSetupProblem("interrupted")).toBe(false);
    expect(isModelSetupProblem("deadline")).toBe(false);
  });

  it("counts other failures beside the work in progress, and offers the runs only then", () => {
    expect(describePipeline(ready({ running: 1, waiting: 869, failures: [failure(), failure({ runId: "r0", source: "Old notes" })] }))).toEqual({ label: "Processing… 869 sources to go · 2 failed", tone: "busy", ...seeRuns, tooltip: "“Foreword”: boom" });
    expect(describePipeline(ready({ running: 1, waiting: null, failures: [failure()] })).label).toBe("Processing… · 1 failed");
  });

  it("an interrupted run resumes on its own; other failures count until their source stops waiting", () => {
    const closed = "The app was closed while this source was being processed; it is processed again on its own.";
    expect(describePipeline(ready({ waiting: 869, failures: [failure({ problem: problem("interrupted", closed) })] }))).toEqual({ label: "Processing was interrupted when the app closed — it resumes on its own", tone: "quiet", ...seeRuns, tooltip: `“Foreword”: ${closed}` });
    expect(describePipeline(ready({ waiting: 869, failures: [failure()] }))).toEqual({ label: "Processing: 1 source failed", tone: "warn", ...seeRuns, tooltip: "“Foreword”: boom" });
    // The newest failure decides the row; a deadline is not a model-setup problem.
    const late = "The run took longer than the pipeline's time limit (set in Workflow Studio) and was stopped.";
    expect(describePipeline(ready({ failures: [failure({ problem: problem("deadline", late) }), failure({ runId: "r0", problem: problem("interrupted") })] }))).toEqual({ label: "Processing: 2 sources failed", tone: "warn", ...seeRuns, tooltip: `“Foreword”: ${late}` });
    // No message and no error: the tooltip still names the source.
    expect(describePipeline(ready({ failures: [failure({ error: null })] })).tooltip).toBe("“Foreword”: the run failed");
  });
});
```

  In `host/src/components/PipelineChip.test.tsx`, replace the second and third `it(...)` cases (`:28-48`, from
  `it("polls while mounted and routes the actions: a failed run → runs, no model → models"` through the end of
  `it("while processing, the label itself opens …")`) with:

```tsx
  it("polls while mounted and routes the actions: a failed source → runs, no model → models", async () => {
    const onRuns = vi.fn();
    const onModels = vi.fn();
    let n = 0;
    const failed: PipelineStatus = { state: "ready", workflowId: "wf", connectionId: "c", trigger: { status: "ENABLED", lastPollAt: null, lastError: null }, running: 0, waiting: 1, failures: [{ runId: "r", source: "Foreword", at: null, error: "no model here" }], hasRuns: true };
    const fetchPipeline = vi.fn(async (): Promise<PipelineStatus> => (++n < 3 ? { state: "unconfigured" } : failed));
    render(<PipelineChip info={info} vaultId="v1" api={{ fetchPipeline, setupPipeline: vi.fn() }} onModels={onModels} onRuns={onRuns} pollMs={5} />);
    fireEvent.click(await screen.findByRole("button", { name: "Set up a model" }));
    expect(onModels).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText("Processing: 1 source failed")).toBeTruthy());
    expect(screen.getByTitle("“Foreword”: no model here")).toBeTruthy(); // the newest failure, with its source, is the chip's tooltip
    fireEvent.click(screen.getByRole("button", { name: "See runs" }));
    expect(onRuns).toHaveBeenCalledWith("wf");
    expect(fetchPipeline.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("without a failure the tooltip stays the trigger's error", async () => {
    const erring: PipelineStatus = { state: "ready", workflowId: "wf", connectionId: "c", trigger: { status: "ENABLED", lastPollAt: null, lastError: "poll failed" }, running: 0, waiting: 0, failures: [], hasRuns: true };
    render(<PipelineChip info={info} vaultId="v1" api={{ fetchPipeline: vi.fn(async () => erring), setupPipeline: vi.fn() }} onModels={() => {}} onRuns={() => {}} pollMs={60_000} />);
    expect(await screen.findByText("Processing: trigger error")).toBeTruthy();
    expect(screen.getByTitle("poll failed")).toBeTruthy();
  });

  it("while processing, the label itself opens the vault's pipeline in Workflow Studio", async () => {
    const onRuns = vi.fn();
    const running: PipelineStatus = { state: "ready", workflowId: "wf-7", connectionId: "c", trigger: { status: "ENABLED", lastPollAt: null, lastError: null }, running: 1, waiting: 0, failures: [], hasRuns: true };
    render(<PipelineChip info={info} vaultId="v1" api={{ fetchPipeline: vi.fn(async () => running), setupPipeline: vi.fn() }} onModels={() => {}} onRuns={onRuns} pollMs={60_000} />);
    fireEvent.click(await screen.findByRole("button", { name: "Processing… — open in Workflow Studio" }));
    expect(onRuns).toHaveBeenCalledWith("wf-7");
  });
```

- [ ] **Step 2: run.**
  `bunx vitest run host/src/components/pipeline-chip.test.ts host/src/components/PipelineChip.test.tsx`
  Expected: FAIL.
  - `isModelSetupProblem is not a function`.
  - The work cases read "Processing ready" where "Processing… 869 sources to go" and the others are expected.
  - `PipelineChip` never shows "Processing: 1 source failed".
  - The busy-label case cannot find "Processing… — open in Workflow Studio". Without `lastRun`, the old rules read ready.

- [ ] **Step 3: implement.**

  **3a.** In `host/src/vaults.ts`, replace `:111-125` (from `/** Spec §4.5: a vault's pipeline as the engine
  reports it (sidecar/src/pipelines.ts). */` to the `};` that closes `PipelineStatus`) with:

```ts
/** Spec §4.5: a vault's pipeline as the engine reports it (sidecar/src/pipelines.ts). */
export type RunProblem = { kind: "no-funds" | "bad-key" | "rate-limited" | "slow-model" | "model-missing" | "model-refused" | "interrupted" | "deadline"; message: string; model?: string };
/** A failed run whose work still waits: which source, when, and what went wrong. */
export type PipelineFailure = { runId: string; source: string; at: string | null; error: string | null; problem?: RunProblem };
export type PipelineStatus =
  | { state: "unconfigured" }
  | { state: "missing" }
  /** The engine's workflow runtime is not up yet (after an unclean exit it waits out a lease, up to a minute). */
  | { state: "starting" }
  | { state: "stale"; reason: string; workflowId: string; connectionId: string }
  | {
      state: "ready";
      workflowId: string;
      connectionId: string;
      trigger?: { status: string; lastPollAt: string | null; lastError: string | null };
      /**
       * The work (spec §1). The status read always carries these fields. The answer to setting the pipeline up
       * (POST) names only the pipeline, so readers treat a missing field as nothing going on.
       */
      running?: number;
      waiting?: number | null;
      failures?: PipelineFailure[];
      hasRuns?: boolean;
      /** @deprecated No longer sent by the engine; read only by the landing page until it moves to `running`. */
      lastRun?: { id: string; status: string; startedAt: string | null; endedAt: string | null; error: string | null; problem?: RunProblem };
    };
```

  **3b.** Replace all of `host/src/components/pipeline-chip.ts` with:

```ts
import type { PipelineFailure, PipelineStatus, RunProblem } from "../vaults.js";

export type ChipTone = "quiet" | "busy" | "ok" | "warn" | "action";
export type ChipAction = "models" | "setup" | "runs";
/** `tooltip` is set on a row about a failure (the newest one, with its source); every other row keeps the chip's own. */
export type ChipDescription = { label: string; tone: ChipTone; action?: ChipAction; actionLabel?: string; tooltip?: string };

/** A model-setup problem: every run fails the same way until the model is fixed in Settings. */
const STOPPED: Partial<Record<RunProblem["kind"], string>> = {
  "no-funds": "Processing stopped: your model provider account is out of credit",
  "bad-key": "Processing stopped: your model provider refused the API key",
  "rate-limited": "Processing stopped: your model provider is rate-limiting requests",
  "slow-model": "Processing stopped: the model did not answer in time",
  "model-missing": "Processing stopped: the model is not available at your provider",
  "model-refused": "Processing stopped: the model refused the request",
};
export function isModelSetupProblem(kind: RunProblem["kind"]): boolean {
  return STOPPED[kind] !== undefined;
}

const sources = (n: number) => `${n} source${n === 1 ? "" : "s"}`;
/** The work in progress, with how many sources are left when the queue says. */
const progress = (waiting: number) => `Processing…${waiting > 0 ? ` ${sources(waiting)} to go` : ""}`;
/** The newest failure as the chip's tooltip: its source, then what went wrong. */
const failureTip = (f: PipelineFailure) => `“${f.source}”: ${f.problem?.message ?? f.error ?? "the run failed"}`;
const SEE_RUNS = { action: "runs", actionLabel: "See runs" } as const;

/**
 * The pipeline in the user's words, "processing", with the one action that fixes the state (spec §5.2, §9):
 * no model → Settings › Models; no pipeline → set it up; a failure, or a paused or erroring trigger → the runs in
 * Workflow Studio. Past the set-up states the chip reads the work, not the last run (spec §1). The first row that
 * matches wins: a model-setup failure, runs in progress (queued runs count), an interrupted run, other failures,
 * sources waiting, then finished.
 */
export function describePipeline(status: PipelineStatus): ChipDescription {
  if (status.state === "unconfigured") return { label: "Processing off", tone: "action", action: "models", actionLabel: "Set up a model" };
  if (status.state === "missing") return { label: "Processing not set up", tone: "action", action: "setup", actionLabel: "Set up" };
  if (status.state === "stale") return { label: "Processing needs an update", tone: "action", action: "setup", actionLabel: "Update" };
  if (status.state === "starting") return { label: "Processing starts in a moment", tone: "quiet" };
  // A workflow whose policy parks on failure (one edited in Studio) stops polling until it is published again.
  if (status.trigger?.status === "PARKED") return { label: "Processing paused after a failed run", tone: "warn", ...SEE_RUNS };
  if (status.trigger?.lastError) return { label: "Processing: trigger error", tone: "warn", ...SEE_RUNS };
  if (status.trigger && status.trigger.status !== "ENABLED") return { label: "Processing paused", tone: "quiet", ...SEE_RUNS };
  const running = status.running ?? 0;
  const waiting = status.waiting ?? 0;
  const failures = status.failures ?? [];
  const newest = failures[0];
  if (newest) {
    const tooltip = failureTip(newest);
    const stopped = newest.problem ? STOPPED[newest.problem.kind] : undefined;
    if (stopped) return { label: stopped, tone: "warn", ...SEE_RUNS, tooltip };
    if (running > 0) return { label: `${progress(waiting)} · ${failures.length} failed`, tone: "busy", ...SEE_RUNS, tooltip };
    if (newest.problem?.kind === "interrupted") return { label: "Processing was interrupted when the app closed — it resumes on its own", tone: "quiet", ...SEE_RUNS, tooltip };
    return { label: `Processing: ${sources(failures.length)} failed`, tone: "warn", ...SEE_RUNS, tooltip };
  }
  if (running > 0) return { label: progress(waiting), tone: "busy" };
  if (waiting > 0) return { label: `Processing: ${sources(waiting)} waiting`, tone: "quiet" };
  return { label: status.hasRuns ? "Processing up to date" : "Processing ready", tone: "ok" };
}
```

  **3c.** In `host/src/components/PipelineChip.tsx`, replace line `:55`:

```tsx
  const tooltip = status.state === "ready" ? (status.lastRun?.problem?.message ?? status.lastRun?.error ?? status.trigger?.lastError ?? undefined) : status.state === "stale" ? status.reason : undefined;
```

  with:

```tsx
  // A failure row names its source and what went wrong; otherwise the trigger's error, or why the pipeline is stale.
  const tooltip = d.tooltip ?? (status.state === "ready" ? (status.trigger?.lastError ?? undefined) : status.state === "stale" ? status.reason : undefined);
```

  Leave the rest of the component as it is, including the button label at `:72`, which is §2's.

- [ ] **Step 4: run.**
  - `bunx vitest run host/src/components/pipeline-chip.test.ts host/src/components/PipelineChip.test.tsx`.
    Expected: PASS.
  - `bun run tsc`. Expected: no errors.

- [ ] **Step 5: commit.**

```
git add host/src/vaults.ts host/src/components/pipeline-chip.ts host/src/components/pipeline-chip.test.ts host/src/components/PipelineChip.tsx host/src/components/PipelineChip.test.tsx
git commit -m "feat(processing): the chip says what the work is doing now

Running (queued runs count) with the sources to go, waiting, a failure that
still blocks a source, or up to date. A model-setup failure still comes first.
The tooltip names the newest failure's source. \"Last processing run failed\"
and \"waiting its turn\" are gone: a failure stops showing once its source no
longer waits.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

---

### Task 34: The onboarding overview reads the work (part 1, draft label F3)

**Files (knowledge-vault-app):**
- Create `host/src/onboarding/processing-line.ts`.
- Modify `host/src/onboarding/OverviewStep.tsx`:
  - `:3`, the import;
  - `:24-36`, `processingLine`, which moves out;
  - `:125`, `data-busy`.
- Test: create `host/src/onboarding/processing-line.test.ts`.

**Interfaces:**
- Consumes:
  - `isModelSetupProblem` (Task F2);
  - the optional `running` and `failures` on the host's `PipelineStatus`.
- Produces:
  - `export function processingLine(p: PipelineStatus | null, notes: number): string`;
  - `export function isWriting(p: PipelineStatus | null): boolean`.

- [ ] **Step 1: write the failing test.** Create `host/src/onboarding/processing-line.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { PipelineFailure, PipelineStatus } from "../vaults.js";
import { isWriting, processingLine } from "./processing-line.js";

const ready = (over: Record<string, unknown> = {}) => ({ state: "ready", workflowId: "wf", connectionId: "c", running: 0, waiting: 0, failures: [], hasRuns: true, ...over }) as PipelineStatus;
const failure = (over: Partial<PipelineFailure> = {}): PipelineFailure => ({ runId: "r", source: "Foreword", at: null, error: "boom", ...over });

describe("the guide's processing line reads the work", () => {
  it("says notes are being written while a run is in progress or queued", () => {
    expect(processingLine(ready({ running: 2, waiting: 869 }), 3)).toBe("Writing notes from your sources… 3 notes so far.");
    expect(isWriting(ready({ running: 1 }))).toBe(true);
    expect(isWriting(ready())).toBe(false);
    expect(isWriting({ state: "ready", workflowId: "wf", connectionId: "c" })).toBe(false); // the answer to a set-up
    expect(isWriting(null)).toBe(false);
  });

  it("gives a model-setup failure's own message, an interrupted run's own message, else counts the failed sources", () => {
    expect(processingLine(ready({ failures: [failure({ problem: { kind: "bad-key", message: "Your model provider refused the API key." } })] }), 0)).toBe("Your model provider refused the API key.");
    expect(processingLine(ready({ failures: [failure({ problem: { kind: "interrupted", message: "The app was closed while this source was being processed; it is processed again on its own." } })] }), 1)).toBe("The app was closed while this source was being processed; it is processed again on its own. 1 note so far.");
    expect(processingLine(ready({ failures: [failure()] }), 0)).toBe("Processing failed for 1 source.");
    expect(processingLine(ready({ failures: [failure(), failure({ runId: "r0" })] }), 4)).toBe("Processing failed for 2 sources. 4 notes so far.");
  });

  it("keeps the other lines as they were", () => {
    expect(processingLine(null, 0)).toBe("Checking the processing…");
    expect(processingLine({ state: "unconfigured" }, 0)).toBe("Processing is not set up: choose an AI in Settings › Models.");
    expect(processingLine({ state: "missing" }, 0)).toBe("Processing needs setting up for this vault.");
    expect(processingLine({ state: "starting" }, 0)).toBe("Processing starts in a moment.");
    expect(processingLine(ready(), 5)).toBe("5 notes written. More appear as each source is read.");
    expect(processingLine(ready({ waiting: 3 }), 0)).toBe("Your sources are queued; the first one starts within a minute.");
  });
});
```

- [ ] **Step 2: run.** `bunx vitest run host/src/onboarding/processing-line.test.ts`
  Expected: FAIL with `Failed to load url ./processing-line.js` (or `Cannot find module`). The module does not
  exist yet.

- [ ] **Step 3: implement.**

  **3a.** Create `host/src/onboarding/processing-line.ts`:

```ts
import { isModelSetupProblem } from "../components/pipeline-chip.js";
import type { PipelineStatus } from "../vaults.js";

/** Notes are being written: a run is in progress or queued in the engine. */
export function isWriting(p: PipelineStatus | null): boolean {
  return p?.state === "ready" && (p.running ?? 0) > 0;
}

/** What processing is doing now, in a sentence (the guide's last screen; spec §1). */
export function processingLine(p: PipelineStatus | null, notes: number): string {
  if (!p) return "Checking the processing…";
  if (p.state === "unconfigured") return "Processing is not set up: choose an AI in Settings › Models.";
  if (p.state === "missing" || p.state === "stale") return "Processing needs setting up for this vault.";
  if (p.state === "starting") return "Processing starts in a moment.";
  const so = notes > 0 ? ` ${notes} note${notes === 1 ? "" : "s"} so far.` : "";
  if (isWriting(p)) return `Writing notes from your sources…${so}`;
  const failures = p.failures ?? [];
  const newest = failures[0];
  // A model-setup problem says what to fix; an interrupted run says it resumes on its own.
  if (newest?.problem && (isModelSetupProblem(newest.problem.kind) || newest.problem.kind === "interrupted")) return `${newest.problem.message}${so}`;
  if (failures.length) return `Processing failed for ${failures.length} source${failures.length === 1 ? "" : "s"}.${so}`;
  if (notes > 0) return `${notes} note${notes === 1 ? "" : "s"} written. More appear as each source is read.`;
  return "Your sources are queued; the first one starts within a minute.";
}
```

  **3b.** In `host/src/onboarding/OverviewStep.tsx`:
  - Delete the doc comment and the function `processingLine` (`:24-36`, from `/** What processing is doing now,
    in a sentence. */` through its closing `}`).
  - After the import at `:5` (`import { CardIcon } from "./CardIcon.js";`), add:

```tsx
import { isWriting, processingLine } from "./processing-line.js";
```

  - Replace `:125`:

```tsx
        <p className="kv-onb-processing" data-busy={pipeline?.state === "ready" && pipeline.lastRun?.status === "RUNNING"}>{processingLine(pipeline, notes)}</p>
```

    with:

```tsx
        <p className="kv-onb-processing" data-busy={isWriting(pipeline)}>{processingLine(pipeline, notes)}</p>
```

  The `type PipelineStatus` import at `:3` stays: `useState<PipelineStatus | null>` at `:78` still uses it.

- [ ] **Step 4: run.**
  - `bunx vitest run host/src/onboarding/`. Expected: PASS. This includes `Onboarding.test.tsx`.
  - `bun run tsc`. Expected: no errors.

- [ ] **Step 5: commit.**

```
git add host/src/onboarding/processing-line.ts host/src/onboarding/processing-line.test.ts host/src/onboarding/OverviewStep.tsx
git commit -m "feat(onboarding): the guide's processing line reads the work

\"Writing notes from your sources…\" while a run is going. A model-setup or
interrupted failure gives its own message. Other failures read \"Processing
failed for N sources.\"

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

---

### Task 35: The landing page's "writing" reads `running`, and `lastRun` leaves the host (part 1, draft label F4)

**Files (knowledge-vault-app):**
- Modify `host/src/screens/Landing.tsx:228`.
- Modify `host/src/vaults.ts`: delete the deprecated `lastRun` lines that Task F2 kept.
- Test `host/src/landing/Landing.test.tsx:232`.

**Interfaces:**
- Consumes: `running?` on the host's `PipelineStatus`.
- Produces: the host's `PipelineStatus` with no `lastRun`.

- [ ] **Step 1: write the failing test.** In `host/src/landing/Landing.test.tsx`, replace `:232`:

```tsx
      fetchPipeline: vi.fn(async () => ({ state: "ready" as const, workflowId: "w", connectionId: "c", lastRun: { id: "r", status: "RUNNING", startedAt: null, endedAt: null, error: null } })),
```

  with (a queued run counts as writing too):

```tsx
      fetchPipeline: vi.fn(async () => ({ state: "ready" as const, workflowId: "w", connectionId: "c", running: 1, waiting: 868, failures: [], hasRuns: true })),
```

- [ ] **Step 2: run.** `bunx vitest run host/src/landing/Landing.test.tsx`
  Expected: FAIL in "names the notes new since the page last showed a vault, says when the lead is writing notes…":
  `Unable to find an element with the text: Writing notes…`.

- [ ] **Step 3: implement.**
  - In `host/src/screens/Landing.tsx`, replace `:228`:

```tsx
        if (alive) setWriting(p.state === "ready" && p.lastRun?.status === "RUNNING");
```

    with:

```tsx
        if (alive) setWriting(p.state === "ready" && (p.running ?? 0) > 0);
```

  - In `host/src/vaults.ts`, delete these two lines from the `ready` variant of `PipelineStatus`:

```ts
      /** @deprecated No longer sent by the engine; read only by the landing page until it moves to `running`. */
      lastRun?: { id: string; status: string; startedAt: string | null; endedAt: string | null; error: string | null; problem?: RunProblem };
```

- [ ] **Step 4: run.**
  - `bunx vitest run host/src/landing/Landing.test.tsx`. Expected: PASS.
  - `grep -rn "lastRun" host/src sidecar/src`. Expected: no output.
  - `bun run tsc`. Expected: no errors.
  - `bunx vitest run`. Expected: PASS, full suite.

- [ ] **Step 5: commit.**

```
git add host/src/screens/Landing.tsx host/src/landing/Landing.test.tsx host/src/vaults.ts
git commit -m "feat(landing): \"Writing notes…\" while any run is going

The lead vault reads as writing while the engine has a run in progress or
queued. The last reader of lastRun is gone, and so is the field.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

---

### Task 36: The pipeline e2e reads the new status (part 1, draft label F5)

**Files (knowledge-vault-app):**
- Modify `e2e/pipeline.spec.ts:79-96`.

**Interfaces:** Consumes the `ready` shape from F1 and the chip labels from F2.

- [ ] **Step 1: write the failing test.** In `e2e/pipeline.spec.ts`, replace `:79-96`, from
  `    // The trigger polls the queue; the run reaches the model, which fails; the runtime records FAILED.` through
  `    await expect(page.getByText(/^(Processing stopped: |Last processing run failed)/)).toBeVisible({ timeout: 60_000 });`,
  with:

```ts
    // The trigger polls the queue; the run reaches the model, which fails; the runtime records FAILED, and its
    // source still waits (the task stays held until the watchdog queues it again), so the failure counts.
    const deadline = Date.now() + 240_000;
    let seen: { running?: number; hasRuns?: boolean; failures?: Array<{ runId: string; error: string | null }> } = {};
    while (Date.now() < deadline) {
      seen = (await (await request.get(`${CONTROL}/vaults/${vault!.id}/pipeline`, { headers: auth })).json()).pipeline;
      if ((seen.failures?.length ?? 0) > 0 && seen.running === 0) break;
      await new Promise((r) => setTimeout(r, 3000));
    }
    expect(seen.hasRuns, "the trigger fired and a run was recorded").toBe(true);
    expect(seen.failures?.length, "the failed run counts while its source still waits").toBeGreaterThan(0);
    expect(completions.length, "the piece reached the model through the connection").toBeGreaterThan(0);
    expect(completions[0] ?? "").toBe(""); // a model on this computer is never sent the key (the gateway keeps it for hosted providers)

    // The chip surfaces it, and leads to the runs.
    await page.goto(`/#/vault/${encodeURIComponent(vault!.id)}`);
    // The chip names the problem when it can ("the model refused the request"), else counts the failed sources.
    await expect(page.getByText(/^(Processing stopped: |Processing: \d+ sources? failed)/)).toBeVisible({ timeout: 60_000 });
```

  (Lines after this, from `await page.getByRole("button", { name: "See runs" }).click();`, stay as they are.)

- [ ] **Step 2: run (before F1–F4, on a checkout without them).** `bunx playwright test e2e/pipeline.spec.ts`
  Expected: FAIL at `the trigger fired and a run was recorded`: `expected undefined to be true`. The old engine
  sends `lastRun`, not `hasRuns`. After F1–F4 it passes. If the tasks are applied in order, skip this step and run
  only Step 4.

- [ ] **Step 3: implement.** No product change: F1–F4 are the implementation.

- [ ] **Step 4: run.** `bunx playwright test e2e/pipeline.spec.ts`. The config starts the stack from
  `scripts/dev.mjs`, which needs about 3 minutes.
  Expected: PASS.

- [ ] **Step 5: commit.**

```
git add e2e/pipeline.spec.ts
git commit -m "test(e2e): the pipeline spec reads the work, not the last run

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

---

### Task 37: The unused repair route is removed (part 1, draft label F6 (§9))

**Files (knowledge-vault-app):**
- Modify `sidecar/src/control.ts`:
  - `:67-68`, the `repairQueue` dep and its comment;
  - `:372-373`, the route.
- Modify `sidecar/src/main.ts`:
  - `:43`, the import;
  - `:399-403`, the `repairQueue` dep.
- Test `sidecar/src/control.test.ts`:
  - `:74`, the stub;
  - `:396-405`, the `describe("the queue watchdog on demand")` block.

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `ControlDeps` no longer has `repairQueue`.
  - `POST /vaults/:id/pipeline/repair` answers 404 "Not found".
  - `repairQueue()` in `queue-watchdog.ts` stays, for the watchdog (`queue-watchdog.ts:161`, called at `:272`).

- [ ] **Step 1: write the failing test.** In `sidecar/src/control.test.ts`:
  - Delete line `:74`:

```ts
    repairQueue: async (vaultId: string) => (vaultId === "v1" ? { requeued: ["Foreword"], dropped: ["Old"] } : { requeued: [], dropped: [], skipped: "no pipeline" }),
```

  - Replace the block at `:396-405`, from `describe("the queue watchdog on demand", () => {` to its closing `});`, with:

```ts
describe("the queue watchdog has no route of its own", () => {
  const h = { authorization: "Bearer secret", "content-type": "application/json" };
  it("answers 404 for the removed repair route: the watchdog makes the same pass every 2 minutes on its own", async () => {
    const base = await start();
    const r = await fetch(`${base}/vaults/v1/pipeline/repair`, { method: "POST", headers: h });
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "Not found" });
  });
});
```

- [ ] **Step 2: run.** `bunx vitest run sidecar/src/control.test.ts`
  Expected: FAIL in "answers 404 for the removed repair route…": `expected 500 to be 404`. The route still exists,
  and it calls the stub that was just removed.

- [ ] **Step 3: implement.**
  - In `sidecar/src/control.ts`, delete these lines (`:67-68`):

```ts
  /** One pass of the queue watchdog for a vault, on demand (queue-watchdog.ts). */
  repairQueue: (vaultId: string) => Promise<{ requeued: string[]; dropped: string[]; skipped?: string }>;
```

    and these (`:372-373`):

```ts
      const repairOf = url.pathname.match(/^\/vaults\/([^/]+)\/pipeline\/repair$/);
      if (repairOf && req.method === "POST") return send(res, 200, await deps.repairQueue(decodePart(repairOf[1]!)), allowed);
```

  - In `sidecar/src/main.ts`, replace `:43`:

```ts
import { repairQueue, startQueueWatchdog } from "./queue-watchdog.js";
```

    with:

```ts
import { startQueueWatchdog } from "./queue-watchdog.js";
```

    and delete `:399-403`:

```ts
    repairQueue: (vaultId) => {
      const record = readPipelines(cfg.dataDir)[vaultId];
      if (!record || record.disabled) return Promise.resolve({ requeued: [], dropped: [], skipped: "no pipeline" });
      return repairQueue({ origin, fetchImpl: engineFetch }, vaultId, record.workflowId, { engineStartedAt: ENGINE_STARTED_AT });
    },
```

    `readPipelines` and `ENGINE_STARTED_AT` are still used elsewhere in `main.ts`, so their imports and declarations stay.

- [ ] **Step 4: run.**
  - `bunx vitest run sidecar/src/control.test.ts sidecar/src/queue-watchdog.test.ts`. Expected: PASS.
  - `grep -rn "pipeline/repair\|deps.repairQueue" sidecar/src host/src scripts src-tauri/src`. Expected: no output.
  - `bun run tsc`. Expected: no errors.

- [ ] **Step 5: commit.**

```
git add sidecar/src/control.ts sidecar/src/control.test.ts sidecar/src/main.ts
git commit -m "chore(control): remove the unused queue repair route

Nothing called POST /vaults/:id/pipeline/repair. It made the pass the watchdog
already makes every 2 minutes, and that pass re-queues only tasks held for 10
minutes. repairQueue() stays for the watchdog.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Part 3: Copy, wording and the guide source (§3, §8, §11)

# Part 3: copy (spec §3, §8, §11)

## Notes for the assembler

- **Line drift (all verified against current code).**
  - Source editor: the "Queued — run /pipeline…" span is `editor.tsx:403-407`; the `queued` flag is `:215`, set at `:322` and `:337`; `existingTask` is `:306-315`; `canQueue` is `:340`; `IngestForm` is `:938-1053`, its button label "Ingest Source" is `:1044`, the lede is `:947-960` region (`:956-961` in the JSX). These match the spec.
  - Desktop app: the "its 15 s queue check" comment is now `sidecar/src/main.ts:540` (spec said `:527`). The "15 s interval" comment is `sidecar/src/pipelines.ts:412`, inside the doc comment of `followTemplate()` (`:407-413`). The ChatGPT comment is `main.ts:297-301` (spec said `:296-300`).
  - Piece: trigger option `new-pipeline-task.ts:209` (spec `:203`); place-in-mocs description `:17`, handoffs `:53` and `:66`; verify.ts header `:12-16` (spec `:12-15`, the cited sentence is on `:15-16`).
- **Another part also edits `pipelines.ts`** (ensure()/status()). My only change there is a comment: **line 412**, the words `one made before the 15 s interval checks the queue every 60 s.` (inside the JSDoc above `async followTemplate()`). No code line moves, but if the other part adds/removes lines above it, re-find the line by that text.
- **Other parts that also touch files I touch.**
  - `editors/source-editor/editor.tsx`: F1 and F2 here both edit it (F2 depends on F1, which removes the `queued` flag). Any other part editing this file (the review list / failed work in §C, the Add sources work) must be sequenced with them.
  - `editors/pipeline-queue-editor/*`: spec says failed work and its retry button are C's. If C adds a retry button to `components/task-table.tsx` or counts in `editor.tsx`, F4 only removes the review group/tab/summary clause and the phase hint; it does not touch the failed group.
- **Spec vs. code.**
  - `PipelineTask.createdAt` is the "queued at" time; there is no separate queued timestamp. The 10-minute rule uses `createdAt`.
  - ADD_TASK sets `currentPhase` to the first phase of the queue's `phaseOrder` (or null when the queue has none), so "PENDING at create" is treated as `currentPhase` null or `"create"`.
  - The paste form's lede has no wording for a vault with no processing queue; the spec gives only the desktop and web variants, so both are shown whether or not a queue exists. The "Add source" button still only queues when a queue exists.
  - `isDesktopHost()` reads module state at call time, not a hook. The editor calls it at render, as the spec says; it is not reactive to a later host declaration (the host declares before import, so this is fine).
- **Decisions I made.**
  - The pure logic (open-task choice, status line, lede, the ingest-then-queue order) goes in a new `editors/source-editor/lib/queue-status.ts`, with a tiny component `components/queue-status-line.tsx`, so it is testable without mounting the editor (the editor has no component tests and needs Connect's toolbar).
  - The existing "queue it again" path (`handleQueueForProcessing`) now uses the same open-claim-task choice, so an old failed task can no longer hide a newer open one (and no duplicate is added).
  - Pieces, comment-only and sample-source copy are guarded by wording tests that read the source file (vitest, node `fs`); comment-only app changes (F6) have no behaviour to test and are verified by grep.
  - `templates/pipeline.json` is not touched (its stale description at `:73` waits for the next template change).
- **Only new vaults get the new guide text (§11).** No migration; existing vaults keep their copy.

---

### Task 38: Two sidecar comments and the ChatGPT-plan comment say what is true (part 3, draft label F6)

**Files:** (repo: knowledge-vault-app) — comments only, no behaviour.
- Modify: `sidecar/src/main.ts:297-301` (ChatGPT comment) and `:540` (queue check comment)
- Modify: `sidecar/src/pipelines.ts:412` (inside the JSDoc above `followTemplate()`)

**Interfaces:** none. **Cross-part:** the other part editing `ensure()`/`status()` in `pipelines.ts` does not touch line 412; re-find it by its text if lines shift.

- [ ] **Step 1: the failing check** (no test for a comment): `grep -n "15 s queue check\|15 s interval\|spec §7 Q4: chat only" sidecar/src/main.ts sidecar/src/pipelines.ts`
- [ ] **Step 2: run** — Expected: three lines (`main.ts:300`, `main.ts:540`, `pipelines.ts:412`).
- [ ] **Step 3: implement**
  - `main.ts:298-301`, replace the block comment body
```
   * The pipelines' "is a model usable?" — pipelines.ts only checks that a key exists (their connection holds the
   * gateway's key, never this one). The ChatGPT plan has no key: a sign-in allowed to use the plan stands for it.
   * To keep processing off the ChatGPT plan (spec §7 Q4: chat only), answer undefined for "chatgpt" here.
```
  with
```
   * The pipelines' "is a model usable?" — pipelines.ts only checks that a key exists (their connection holds the
   * gateway's key, never this one). The ChatGPT plan has no key: a sign-in allowed to use the plan stands for it.
   * The ChatGPT plan runs processing as well as the chat (spec §7 Q4, decided by the C1 test). To keep processing
   * off it, answer undefined for "chatgpt" here.
```
  - `main.ts:540`: `// Pipelines made before the template's run policy (enforced since 6.2.3-dev.50) or its 15 s queue check get them.` → `// Pipelines made before the template's run policy (enforced since 6.2.3-dev.50) or the template's 10 s poll interval (a queue check on every 15 s wake-up of the runtime) get them.`
  - `pipelines.ts:412`: `     * one made before the 15 s interval checks the queue every 60 s. Each is patched in place —` → `     * one made before the template's 10 s poll interval (a queue check on every 15 s wake-up of the runtime) checks the queue every 60 s. Each is patched in place —`
- [ ] **Step 4: run** — `grep -n "15 s queue check\|15 s interval\|chat only" sidecar/src/main.ts sidecar/src/pipelines.ts` → no output; `bun run check 2>&1 | tail -20` → no errors; `bunx vitest run sidecar/src/pipelines.test.ts` → pass.
- [ ] **Step 5: commit**
```
git add sidecar/src/main.ts sidecar/src/pipelines.ts
git commit -m "docs(sidecar): the queue check and the ChatGPT plan are described as they are

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

---

### Task 39: The built-in guide source tells the truth about the chat, new notes and pace (part 3, draft label F7)

**Files:** (repo: knowledge-vault-app)
- Create: `sidecar/src/sample-source.test.ts`
- Modify: `sidecar/src/sample-source.ts` — the paragraphs "Adding a source should take seconds…" (pace), "A new note is a draft…" (new notes) and the chat paragraph under "## Asking your vault".

**Interfaces:** `SAMPLE_SOURCE.content` (string) consumed by `control.ts:361`; unchanged shape. Only new vaults get the new text (the guide is added once per vault); no migration.

- [ ] **Step 1: write the failing test** — `sidecar/src/sample-source.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SAMPLE_SOURCE } from "./sample-source.js";

const text = SAMPLE_SOURCE.content;
const paragraphs = text.split("\n\n");

describe("the built-in guide source", () => {
  it("does not say the chat only reads the vault", () => {
    expect(text).not.toContain("A chat that only reads the vault");
    expect(text).not.toContain("it cannot damage a note");
  });
  it("keeps one claim per paragraph about the chat", () => {
    const first = "An answer that cites the notes it used can be checked by opening them; an answer from a model's general knowledge cannot be. That is why the vault's chat answers from your notes and names them.";
    const second = "A chat that cannot change anything on its own can be trusted with the vault. It can offer to save an answer as a note or to change the work in your projects, but it shows each change first, and nothing is written until you apply it.";
    expect(paragraphs).toContain(first);
    expect(paragraphs.indexOf(second)).toBe(paragraphs.indexOf(first) + 1);
  });
  it("says a new note waits in review, not that it is a draft", () => {
    expect(text).not.toContain("A new note is a draft");
    expect(paragraphs).toContain("A new note waits in review until you approve it. The verify step reports which notes are ready to approve and which need a closer look, and approving a note makes it the vault's settled view.");
  });
  it("says how many sources run at once, by model", () => {
    expect(text).not.toContain("one source after another");
    expect(text).toContain("so processing runs in the background while you keep working: one source at a time with a model on this computer, a few at once with a hosted one.");
  });
  it("keeps what was already true", () => {
    for (const s of ["a map is only made once a theme has three or more notes".toLowerCase(), "the archived note leaves search", "nothing you add is sent anywhere by default"]) {
      expect(text.toLowerCase()).toContain(s);
    }
  });
});
```

- [ ] **Step 2: run** — `bunx vitest run sidecar/src/sample-source.test.ts` (from `knowledge-vault-app`). Expected: 4 failures (`expected '…' not to contain 'A chat that only reads the vault'`, etc.); "keeps what was already true" passes.

- [ ] **Step 3: implement** — in `sample-source.ts`, three replacements inside the template string:
  1. Pace paragraph: replace `so processing runs in the background, one source after another, while you keep working.` with `so processing runs in the background while you keep working: one source at a time with a model on this computer, a few at once with a hosted one.`
  2. New-note paragraph: replace the whole paragraph `A new note is a draft until it has been checked. The verify step reports which drafts are ready to approve and which need a closer look, and approving a note makes it the vault's settled view.` with `A new note waits in review until you approve it. The verify step reports which notes are ready to approve and which need a closer look, and approving a note makes it the vault's settled view.`
  3. Chat paragraph: replace
```
That is why the vault's chat answers from your notes and names them. A chat that only reads the vault can be trusted with it: it can get an answer wrong, but it cannot damage a note.
```
  with (a blank line splits it into two paragraphs)
```
That is why the vault's chat answers from your notes and names them.

A chat that cannot change anything on its own can be trusted with the vault. It can offer to save an answer as a note or to change the work in your projects, but it shows each change first, and nothing is written until you apply it.
```
  The "one source at a time … a few at once" sentence: the paragraph's lead (`Adding a source should take seconds even though reading it takes minutes: a vault fills only while collecting stays effortless,`) stays, so the line reads "…stays effortless, so processing runs…". Check the test's exact string against the file after editing (the test uses `so processing runs in the background while you keep working: …`).
- [ ] **Step 4: run** — `bunx vitest run sidecar/src/sample-source.test.ts` → Expected: 5 pass. `bun run check 2>&1 | tail -20` → no errors. Also `bunx vitest run sidecar 2>&1 | tail -15` (control.ts tests that add the sample must still pass).
- [ ] **Step 5: commit**
```
git add sidecar/src/sample-source.ts sidecar/src/sample-source.test.ts
git commit -m "fix(guide): the built-in guide describes the chat, new notes and processing pace as they are

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 40: Move the desktop app to the released vault package
**Repo:** knowledge-vault-app (branch dev). **Files:** `sidecar/package.json`, `host/package.json`, `bun.lock`.
- [ ] **Step 1:** In a clean worktree of HEAD, change `"@powerhousedao/knowledge-note"` in both manifests to the version published in the release task (`1.0.54-dev.38`), then `bun install`.
- [ ] **Step 2:** Run `bun run stack:check && bun run check && TMPDIR=$HOME/.cache/vt-tmp bun run test`. Expected: stack check ok, no type errors, all tests pass (a single timing-sensitive failure that passes when its file runs alone is noted, not fixed).
- [ ] **Step 3:** Commit the three files ("chore: vault package 1.0.54-dev.38 — app polish"), move `dev` to it (fast-forward, or `update-ref` plus `git reset -q` of those files when the checkout holds other work), remove the worktree.
- [ ] **Step 4:** Ask the user to restart the dev app. Then check by hand: the processing chip reads "Processing… N sources to go" while the pipeline runs; Workflows › the vault's pipeline still shows its older runs after pressing Update (when one is offered); Activity › Links lists a link made after the restart.

## Part 6: Links and scope deletion (§6, §7)

# Part 6 — §6 "A link always has a real target and a reason" and §7 "Deleting a scope of work leaves nothing pointing at it"

All tasks are in the **bai-knowledge-note** repo (branch `ui-upgrade`). Run every command from
`/home/beast/Documents/Powerhouse/bai-knowledge-note`.

## Notes for the assembler

- **Spec line references checked against the current code.** §6 is accurate: `links-section.tsx` manual entry at
  `:514`, its fields at `:551`/`:559`, `onAdd(manualId…)` at `:489`, the add guard at `:493-496`, change-target at
  `:173-185`, and `_targetTitle` at `editor.tsx:507`. The one that moved is the type-change dispatch: it is now at
  `editor.tsx:582-624`, not `:574-616`. §7 is accurate: the dialog `ScopeOfWorkView.tsx:306-321`, body `:141-158`,
  design note `:23-25`, chat card `work-changes.ts:1178-1187`, WBS schema `:27-30` and `:129-133`.
- **`SET_SOW_PROJECT_REF` checked.** The input is `SetSowProjectRefInput { sowRef: PHID, sowProjectId: OID }`. Both
  fields are optional, and the schema says "omit or null both to unlink"
  (`document-models/work-breakdown-structure/v1/schema.graphql:129-133`). The reducer sets each field to
  `input.x || null` (`v1/src/reducers/documentation.ts:38-43`). The chat refuses one field without the other
  (`work-changes.ts:666-667`), and the action is already in `NULL_MEANS_CLEAR` (`:398`). The unlink
  `{ sowRef: null, sowProjectId: null }` passes all three. No model change is needed.
- **Liberuum's two left-over breakdowns.** Read-only check on 2026-10-16 against `http://127.0.0.1:4201/graphql`,
  drive `t2lgNDhnAWzjVppfZ72J0d0NoBbFeEpj4f7KCIS0_iM`. The drive holds no `powerhouse/scopeofwork` document, and two
  `bai/wbs` documents, both in folder `361b7825-…`:
  - `-tZbkHi4jYuXcBnfXOzcqWstL6h52wrd5aDB5D7QjuE` "Knowledge Vault Go-to-Market Strategy — Work Breakdown":
    6 goals, all TODO, 0 notes. `sowRef` `G627G3NvPVnGWvlo5tq2duSRuSDuNyqOTUA3IY5cMEA`.
  - `DAhp7HCOuRh3UcNVg0lkj-yUbuf8V08seC74na5whsU` "Knowledge Vault Go-to-Market Plan": 3 goals, all TODO, 0 notes.
    `sowRef` `MxcH8IiU6Ije7OdbImO-z8q0gnCEhMUvsa7uGONJPQE` ("Document not found").
  These match the spec. They are deleted in Task F10.
- **The first name holds an em dash ("—").** `namesIt` (`TypeToConfirmDialog.tsx`) folds only case and spaces, so
  the person must type the em dash or paste it. F10 tells the operator to copy the name from the dialog. I did not
  change `namesIt`. If the assembler wants "-" to match "—", that is a separate change to a shared component.
- **The spec's file list is missing a file.** `editors/knowledge-vault/lib/chat/vault-tools.ts` (`checkWorkProposal`,
  `:1057-1105`) also changes. It reads only the documents a proposal names, plus the scope of a breakdown being
  deleted. To write the unlink lines, the chat must also read every breakdown of a scope being deleted. That is Task
  F9.
- **The list must also show when there is no scope.** Liberuum has no scope of work, so Work › Scopes of work shows
  its empty state, "No scope of work yet". The "outside any scope" list is rendered after the empty state as well as
  after the cards. Otherwise Liberuum's two breakdowns would never appear.
- **Decisions I made:**
  1. `onAddLink` on `LinksSection` becomes `(targetDocumentId, linkType, articulation)`. The unused generated id and
     the unused title are dropped. A new prop `onChangeTarget(id, targetDocumentId, articulation)` is added.
  2. The link-type select moves to the top of the add form. The search list depends on it: sources for "Derived
     from", notes for every other kind.
  3. A selection stays when the link type changes afterwards. A pasted id may be any document, so a note chosen
     before switching to "Derived from" is still a valid target.
  4. "Change target" on a "Derived from" link also lists sources.
  5. Every row in the picker shows `"<title> · <kind>"`, as in the spec's example "Chapter 3 Hardware · source". The
     kind words are: `note`, `source`, `map` (MoC), `work breakdown`, `scope of work`. Any other type is shown
     without its `bai/` prefix, with spaces for dashes.
  6. A breakdown that some scope's project holds through `wbsRef` is left out of "outside any scope", even when its
     own `sowRef` is empty. Otherwise it would appear both inside a scope and outside every scope.
  7. The recorded-work line goes past the spec's single example. Goals are counted as "done" (COMPLETED),
     "in progress" (IN_PROGRESS, IN_REVIEW or BLOCKED) or "dropped" (WONT_DO), and notes are counted too. The line
     shows only while the checkbox is checked. Unchecked, the dialog says "They stay, outside any scope." (or "It
     stays…" for one breakdown).
  8. The checkbox label is the spec's string, "Also delete these work breakdowns", even when there is only one
     breakdown. The copy rules require verbatim strings. The assembler may want a singular form.
  9. The view unlinks with `mutateDocumentRemote` (`SET_SOW_PROJECT_REF`), the same path
     `scope-of-work/views/project/ExecutionSections.tsx:79-88` uses to link one. The chat unlinks through its
     derived `operation` lines.
  10. The chat never proposes deleting a breakdown on its own. If the same proposal deletes a breakdown by name, that
      breakdown gets no unlink line. A deleted breakdown also gets no `LINK_PROJECT_WBS` unlink on a scope that the
      same proposal deletes. Without that, the rehearsal would refuse "act on it before deleting it".
- **Files other parts also edit:** none of mine, as far as the spec's file list shows. `DriveExplorer.tsx` (§4/§10)
  is not touched here. `ScopeOfWorkView.tsx` is still imported by `DriveExplorer.tsx:59`, with an unchanged export.
  §5's Activity "Links" will see the retarget as one REMOVE plus one ADD in the same batch.
- **The two shipping steps are in the spec's Rollout.** F10 runs after the vault package with F6–F7 is in the
  desktop app: `bun run build`, a dev publish, then the app moves to that version.

---

### Task 41: Delete Liberuum's two left-over work breakdowns through the new list (part 6, draft label F10 (operational))

The user approved this deletion (spec decision 7). Run it once F6–F7 ship: the vault package is built and
published, and the desktop app has moved to that version (spec Rollout steps 1–2). The engine is the desktop one
at `http://127.0.0.1:4201`, and the drive is `t2lgNDhnAWzjVppfZ72J0d0NoBbFeEpj4f7KCIS0_iM`. Nothing in either
repo changes, so this task has no commit.

The two breakdowns, found read-only on 2026-10-16:

| id | name | goals | notes | sowRef (gone) |
|---|---|---|---|---|
| `-tZbkHi4jYuXcBnfXOzcqWstL6h52wrd5aDB5D7QjuE` | Knowledge Vault Go-to-Market Strategy — Work Breakdown | 6, all TODO | 0 | `G627G3NvPVnGWvlo5tq2duSRuSDuNyqOTUA3IY5cMEA` |
| `DAhp7HCOuRh3UcNVg0lkj-yUbuf8V08seC74na5whsU` | Knowledge Vault Go-to-Market Plan | 3, all TODO | 0 | `MxcH8IiU6Ije7OdbImO-z8q0gnCEhMUvsa7uGONJPQE` |

- [ ] Step 1: pre-check (read-only). Confirm they are still the same two and still hold no recorded work:

```bash
E=http://127.0.0.1:4201/graphql; D=t2lgNDhnAWzjVppfZ72J0d0NoBbFeEpj4f7KCIS0_iM
q() { curl -s -X POST "$E" -H 'content-type: application/json' -d "{\"query\":\"query(\$id:String!){document(idOrSlug:\$id){document{id name documentType state}}}\",\"variables\":{\"id\":\"$1\"}}"; }
q "$D" | jq -c '.data.document.document.state.global.nodes[] | select(.documentType=="bai/wbs" or .documentType=="powerhouse/scopeofwork") | {id,name,documentType}'
for id in -tZbkHi4jYuXcBnfXOzcqWstL6h52wrd5aDB5D7QjuE DAhp7HCOuRh3UcNVg0lkj-yUbuf8V08seC74na5whsU; do
  q "$id" | jq -c '.data.document.document | {id,name,sowRef:.state.global.sowRef,goals:(.state.global.goals|length),notTodo:([.state.global.goals[]|select(.status!="TODO")]|length),notes:([.state.global.goals[].notes|length]|add)}'
done
```

  Expected: exactly the two `bai/wbs` nodes above, and no `powerhouse/scopeofwork` node. Then
  `{"…Strategy — Work Breakdown",…,"goals":6,"notTodo":0,"notes":0}` and
  `{"…Go-to-Market Plan",…,"goals":3,"notTodo":0,"notes":0}`.
  **If anything differs, stop.** That means a scope now exists, a goal has moved, or a note was added. Report it to
  the user rather than deleting.

- [ ] Step 2: in the desktop app, open the Liberuum vault, then Work › Scopes of work. Below "No scope of work yet",
  "Work breakdowns outside any scope" must list two rows, in this order:
  "Knowledge Vault Go-to-Market Plan" with "3 goals, none done", and
  "Knowledge Vault Go-to-Market Strategy — Work Breakdown" with "6 goals, none done".
  "Open" on each opens its editor. Go back to Work › Scopes of work afterwards.

- [ ] Step 3: delete both from the list. On each row, press the bin, "Delete work breakdown “…”". The dialog
  "Delete “<name>”?" shows "This deletes the whole work breakdown — its goals and their notes. It cannot be undone."
  and no recorded-work line. Type the name shown after "To confirm, type the work breakdown's name:". The
  Strategy name contains an em dash ("—"), so copy it from the dialog rather than typing "-". Then press
  "Delete work breakdown". The row disappears. Once both are gone, the "Work breakdowns outside any scope" heading
  disappears too.

- [ ] Step 4: read-back (read-only):

```bash
E=http://127.0.0.1:4201/graphql; D=t2lgNDhnAWzjVppfZ72J0d0NoBbFeEpj4f7KCIS0_iM
curl -s -X POST "$E" -H 'content-type: application/json' -d "{\"query\":\"query(\$id:String!){document(idOrSlug:\$id){document{state}}}\",\"variables\":{\"id\":\"$D\"}}" \
  | jq '[.data.document.document.state.global.nodes[] | select(.id=="-tZbkHi4jYuXcBnfXOzcqWstL6h52wrd5aDB5D7QjuE" or .id=="DAhp7HCOuRh3UcNVg0lkj-yUbuf8V08seC74na5whsU" or .documentType=="bai/wbs")] | length'
```

  Expected: `0`. Neither id is in the drive's tree, and no `bai/wbs` node is left. The engine may still answer a
  direct `document(idOrSlug)` for a deleted id, so the tree is the check. Reload Work › Scopes of work in the app:
  the "outside any scope" list is gone and stays gone. A search for "Go-to-Market" in the vault finds neither
  breakdown.

- [ ] Step 5: report to the user: the two ids deleted, and the read-back count of `0`. No commit.

---

## Task map

| Task | Part | Draft label (used in the part's notes and cross-references) |
|---|---|---|
| 1 | part 3 | F1 |
| 2 | part 3 | F2 |
| 3 | part 3 | F3 |
| 4 | part 3 | F4 |
| 5 | part 3 | F5 |
| 6 | part 5 | F5a |
| 7 | part 5 | F5b |
| 8 | part 5 | F5c |
| 9 | part 6 | F1 |
| 10 | part 6 | F2 |
| 11 | part 6 | F3 |
| 12 | part 6 | F4 |
| 13 | part 6 | F5 |
| 14 | part 6 | F6 |
| 15 | part 6 | F7 |
| 16 | part 6 | F8 |
| 17 | part 6 | F9 |
| 18 | part 7 | F7a |
| 19 | part 7 | F7b |
| 20 | part 7 | F7c |
| 21 | part 7 | F7d |
| 22 | part 7 | F7e |
| 23 | part 7 | F7f |
| 24 | part 4 | F1 |
| 25 | part 4 | F2 |
| 26 | release | — |
| 27 | part 2 | F2.1 |
| 28 | part 2 | F2.2 |
| 29 | part 2 | F2.3 |
| 30 | part 2 | F2.4 |
| 31 | part 2 | F2.5 |
| 32 | part 1 | F1 |
| 33 | part 1 | F2 |
| 34 | part 1 | F3 |
| 35 | part 1 | F4 |
| 36 | part 1 | F5 |
| 37 | part 1 | F6 (§9) |
| 38 | part 3 | F6 |
| 39 | part 3 | F7 |
| 40 | release | — |
| 41 | part 6 | F10 (operational) |
