# Pipeline completeness — design

**Date:** 2026-10-15 · **Status:** draft for review; nothing in it is approved yet
**Repos:** `bai-knowledge-note` (Reweave, Connect, two REST routes, the observation model, the editors) and `knowledge-vault-app` (the sidecar's care loop). The agent's `/health` procedure in `powerhouse-knowledge` then calls the new route.

## Why

Measured on the Liberuum vault in the desktop app on 2026-10-15, first earlier in the day and again at 19:50 UTC, while a 900-source import was running. At 19:55, 860 sources were still waiting, at about 45 s each on the local model (gpt-oss-20b). The topics the app lists are the vault's maps (`bai/moc`).

**Reweave reaches almost nothing.**
- Earlier in the day: 319 notes, all in a topic. 92 had no link to another note, and 124 had fewer than 2. The design asks for at least two ("Every note leaves reflect with at least two knowledge edges", vault guide, chapter 3). At 19:50: 469 live notes, 128 with no link, 44 with one (counted as in §1.1).
- By default, the trigger looks only at graph orphans. `pieces/knowledge-vault/templates/reweave.json:34` sets `include_unlinked: false`, and an unset box also means off (`pieces/knowledge-vault/lib/triggers/unwoven-notes.ts:181`). An orphan has no incoming knowledge edge, and a topic's `CORE_IDEA` counts as one (`processors/graph-indexer/query.ts:51-75`). Once Place has put every note in a topic, the only orphan left is the HUB, which the trigger skips. The Reweave workflow has run once: 11 October at 00:08 UTC, on one note, for 30 s.
- With the box ticked, the trigger adds notes with no links (`unwoven-notes.ts:83`). It never picks a note with one link, although the action connects any note under two (`lib/agent/reweave.ts:134`).
- The link count includes `SUPERSEDES` and links to retired notes (`reweave.ts:21`, `:72`). Only archived notes are left out (`:64`). 24 notes are retired duplicates, superseded and rejected back to DRAFT.
- **On the local model, most of Connect's answers are thrown away.** The prompt says to name notes by their subject, "never … by letters (A, B, C) or ids" (`lib/agent/connect.ts:66`). That rule is about the reason, but the local model applies it to `from` and `to` too. It writes "the new note Cin4RL…" or a paraphrased title, and the harness drops the link (`connect.ts:84`).
  - In the pipeline's last 100 runs (10–15 October), 285 of the 355 dropped links were dropped this way, all from the local model.
  - The local model ran Connect on 44 sources that had notes, and 27 of them got no link at all. It wrote 1.0 link per note; gpt-6.1-sol wrote 2.0.
  - The one Reweave run wrote no link, for the same reason.
- Pacing has two holes.
  - The idle test counts a waiting task as work only if it was touched in the last 30 minutes (`unwoven-notes.ts:35`, `:56-58`). A backlog older than that looks idle in the seconds between two sources.
  - A check every 5 minutes starts a run whether or not the last one has ended, and the policy queues them (`reweave.json:84`). On a slow model, runs pile up.

**Health is never checked.**
- Nothing writes the `bai/health-report`.
  - The server only reads it (`subgraphs/http/routes/health.ts:12-33`).
  - The piece has no health action (`pieces/knowledge-vault/index.ts:31`).
  - The report editor says "Run /health in Claude Code" (`editors/health-report-editor/editor.tsx:45`).
  - Liberuum's report has never been generated.
- The same checks are defined in three places: the agent procedure (`powerhouse-knowledge/skills/health/SKILL.md:54-101`), the live dashboard (`editors/knowledge-vault/components/HealthDashboard.tsx:112-236`) and the server's orphan query. They disagree.
  - Orphans: the dashboard calls a note an orphan when no other note links to it (`:134`). The server calls it an orphan only when nothing links to it, a topic included.
  - Links: the procedure divides all knowledge edges by the number of notes (`SKILL.md:64`), so provenance and topic edges count. Liberuum scores about 3.5, a PASS, while 172 of its 469 notes have fewer than two links.
- Two definitions no longer fit the vault.
  - `STALE_NOTES` counts only DRAFT notes. The pipeline submits every note for review: 405 are in review, and no live note is a draft.
  - Three FAILED tasks are enough to fail `PROCESSING_THROUGHPUT` (`SKILL.md:100`). Liberuum's 60 are all bookkeeping. 55 were closed because their source was deleted (`knowledge-vault-app/sidecar/src/queue-watchdog.ts:46-48`). 5 were closed when the watchdog queued their source again (`queue-watchdog.ts:172-178`).

**Failures leave no trace in the vault.**
- Nothing creates a `bai/observation`, and Liberuum has none. The piece's plan says workflows should report failures this way (`docs/plans/workflow-piece.md:263`). Health counts open observations (`SKILL.md:100`).
- Only the workflow runtime's run journal keeps the cause of a failed run. The `NOTIFY` policy writes a log line, "the only notification channel this engine has" (`applyFailureMode`, `@powerhousedao/reactor-workflow`). The queue drops `FAIL_TASK`'s reason (`document-models/pipeline-queue/v2/src/reducers/queue-management.ts:143-155`).
- In those 100 runs, 5 failed:
  - three with "gpt-6.1-sol did not answer within 120 s, twice", between 12:48 and 12:53, on three sources;
  - one with "Insufficient permissions" in Connect's read stage, at 13:58;
  - one whose worker was killed when the app restarted, at 19:36.
- The desktop shows the last run's problem (`knowledge-vault-app/sidecar/src/run-problems.ts`). Earlier failures are out of sight.
- The observation model cannot record that something happened again. It has no key and no count, only create, promote, implement and archive (`document-models/observation/v1/schema.graphql`).

## Goals

- While the pipeline is idle, every note in review or approved gets a second pass if it has fewer than two links to other notes or no topic. On the local model, Connect's answers count.
- Reweave never delays a source the pipeline is working on by more than the rest of one Reweave run.
- Health is computed in one place, on the server, by fixed deterministic rules. The desktop app, the web app, `health.json`, the badge and the agent's `/health` all show the same numbers.
- The desktop app keeps the report fresh without being asked. On the web or the desktop, anyone with write access can check now.
- Each distinct cause of failed processing becomes one observation. It says how often the failure happened, how recently, and what it touched.
- `pipeline.json` does not change. No vault shows "needs update", and no pipeline run history is lost.

## Non-goals

- Work owned by the sibling specs:
  - retrying or capping failed sources, cleaning the queue and the review list (spec C);
  - topic orientations, domain maps and the contradictions view (spec D);
  - links to `health.json`, `llms.txt` and the badge (spec E);
  - the status chip and run history on Update (spec F).
- Reweave rewriting older notes (the guide's "backward pass"). Reweave stays link-and-place.
- Feeding the graph's triangles to Reweave. Spec D leaves that to this spec, and it stays for later: here, Reweave's work is the thin notes.
- Model judgement in health. Grounding coverage stays in the recommendations of the agent's `/health`.
- Repairs from the health check. The check reports. Reweave, Verify, the watchdog and spec C repair.
- Recording failures on a hosted server. The recording route is in the package, so a hosted workflow can call it later. Nothing there calls it now.

## Design

### 1. Reweave reaches the thin notes

#### 1.1 Which notes

- **A new "Which notes" prop** (`reach`) on the Unwoven notes trigger replaces "Also notes with no links" (`include_unlinked`):
  - `thin` (default): fewer than two links to other notes, or in no topic.
  - `unlinked`: no link to another note, or in no topic.
  - `orphans`: in no topic and nothing links to them. This is today's default.
  - A workflow that never set `reach` falls back on `include_unlinked`. Ticked means `unlinked`. Unticked or unset means `thin`.
- **A note qualifies** when all three hold:
  - it is IN_REVIEW or CANONICAL;
  - it is not superseded (no incoming `SUPERSEDES`);
  - it is at least 10 minutes old (`SETTLE_MS`, unchanged).
  - DRAFT notes are left alone. A draft is a person's work in progress or a reviewer's rejection, and the retired duplicates are drafts too.
- **A link** is a `RELATES_TO`, `BUILDS_ON` or `CONTRADICTS` edge, in either direction, whose other end is a live note (not archived, not superseded). `SUPERSEDES` retires a note rather than connecting it, so it no longer counts.
- **One helper decides.** `weaveState(graph)` in `lib/agent/reweave.ts` returns, for each note, its link count, whether a topic holds it, and whether it is retired. The trigger and the action both use it.
- **Order:** notes with no links first, then notes in no topic, then notes with one link. Within each group, the oldest goes first.
- **A note with exactly one link** comes after every note with none. In the action, it gets two changes:
  - its candidates leave out the note it already links to;
  - its prompt line says "already linked to: <title>", and the instruction becomes "aim for 2–4 links per note in total, counting the links it already has".
- **Tries** stay as they are for every note. The first try is immediate. Each of the two retries waits an hour and for 5 more notes in the vault (`RETRY_AFTER_MS`, `RETRY_GROWTH`, `MAX_TRIES`).

#### 1.2 Connect accepts a note named in words

This fixes the pipeline's Connect step as much as Reweave. It is a code change in the piece, and no template changes.
- **The prompt** gets one sentence after the rules for the reason: `"from" and "to" are ids, copied exactly as listed; words go only in "reason".`
- **The harness resolves** `from` and `to` before it drops a link. It tries, in order:
  1. the exact id, as today;
  2. one allowed id written inside the text, as in "the new note Cin4RL…";
  3. a match on one allowed note's title. Both texts are normalised first: lower case, a leading "the", "a" or "new note" removed, a trailing "note" removed, punctuation collapsed. They match when they are equal, or when one starts with the other and the shorter is 24 characters or more. They also match when at least 80% of the shorter one's words of 3 or more letters appear in the other.
- **"Allowed"** means the same as today. `from` must be one of the notes being connected, and `to` one of that note's candidates. A text that matches no note, or several, is dropped as today, with the reason "names no note" or "could be N notes".
- **The articulation check** on the reason does not change.

#### 1.3 When it runs

- **Only while the pipeline is idle**, with a corrected test. The pipeline counts as busy when:
  - a claim task is held (IN_PROGRESS, touched in the last 2 hours); or
  - a claim task with a live source is waiting, and the queue moved in the last 30 minutes. The queue's `lastProcessedAt` changes on every assign, advance, complete and fail.
  - An import is busy from its first source to its last. A queue nobody works on is idle after 30 minutes, for example when the pipeline is off or fails before it claims a task.
- **One run at a time.**
  - When the trigger starts a run, it writes `{ firedAt, ids }` to the workflow's store.
  - When the action ends, failed or not, it writes `{ at, ok, ids }`.
  - The trigger starts nothing while the last run has not ended, for up to 70 minutes (the step's 60-minute timeout plus a margin).
  - Both sides see the same values. The runtime keys a FLOW-scoped store by workflow id for triggers and steps alike (`createPieceStorePort`, `@powerhousedao/reactor-workflow`).
- **After a failed run**, its notes get their try back, and Reweave pauses for 30 minutes. That way a provider that refuses every request cannot use up every note's three tries.
- **A check every 60 s** (it was 300 s).
  - It reads the queue first, and stops there when the pipeline is busy.
  - It reads `graph.json` (1.9 MB in Liberuum) only when `stats` shows a note or edge count different from the last empty check, or when 10 minutes have passed.
- **6 notes per run**, unchanged, at most 12. That is two Connect calls of three notes, plus one Place call when a note is in no topic.

**What this costs the pipeline.**
- A source queued during a Reweave run starts at once. Its first model call waits behind the run's remaining calls.
  - The local model serves one request at a time (`knowledge-vault-app/sidecar/src/gateway/queue.ts`). So the wait is at most two Connect calls of three notes. In the pipeline's own Connect steps today, such a call takes about 5–15 s.
  - The next Reweave check sees the pipeline busy and starts nothing.
- The chat keeps its priority at the gateway.
- When the pipeline is idle, runs follow each other within a minute. At that pace, the 172 thin notes take under an hour once the import ends.

#### 1.4 The template

- In `templates/reweave.json`:
  - the trigger's config becomes `{ "drive", "batch": 6, "reach": "thin", "pollEverySeconds": 60 }`;
  - the description becomes "While the pipeline is idle: notes with fewer than two links to other notes, or in no topic, get links to the vault as it is now and a place in a topic."
- At its next start, the app rebuilds every vault's Reweave workflow, because the template's digest changed (`knowledge-vault-app/sidecar/src/pipelines.ts:237-271`, `followReweave`).
  - A workflow that was switched off stays off.
  - Its run history is lost; Liberuum's has one run.
- `pipeline.json` does not change.

### 2. The vault checks its own health

#### 2.1 One computation, on the server

- **`POST health/check?drive=<id>`**, a new route in the package's REST surface, next to `health.json`.
  - **Body:** `{ by?: string, force?: boolean, dryRun?: boolean }`. `by` names the caller in the report, for example "desktop app", "Check now" or "workflow". It is at most 60 characters, and defaults to "vault".
  - **Inputs:** the graph index, the queue document, the open observations, and the few sources it must read (§2.2, throughput).
  - **Write:**
    - It writes `GENERATE_REPORT` and the eight `ADD_CHECK`s in one batch to the drive's `bai/health-report`.
    - If the report document is missing, it creates it in `/ops/health`.
    - It holds a per-vault lock while it works, as `POST hub` does.
  - **It writes only when one of these holds:**
    - `force` is set;
    - the result differs from the stored report (any status, message, affected item or metric);
    - the stored report is more than 24 hours old.
    - Otherwise it answers "unchanged". A quiet vault adds 9 operations a day to its report. A busy one adds 9 per check.
  - **Answer:** `{ written, reason: "written" | "unchanged" | "dry run", reportId, report }`. `report` has the fields of the report document.
  - **Access:** writing needs write access to the drive. `dryRun` needs read access.
- **Deterministic only.** The route calls no model. On Liberuum it should take under two seconds: SQL on the index, one read of the 680 KB queue, and a few documents. It runs on any server without a key, and it gives the same answer twice. Judgement stays where it already is: Verify's recite test, Reweave's links, the agent's grounding probes.
- **`health.json` and the badge** keep reading the stored report. They show what the last check wrote.

#### 2.2 The eight checks

Shared rules:
- **Live note:** a `bai/knowledge-note` that is not ARCHIVED and not superseded. `noteCount` counts live notes, and the schema message counts the retired ones.
- **Settled:** older than one hour. The link, orphan and topic checks grade settled notes only. Younger notes are still in the pipeline, and the messages say how many there are.
- **A link** is as in §1.1.
- **Affected items** are document ids, worst first, at most 100 per check. The message always carries the full count.
- **Overall status** is the status of the worst check.

| Category | Measures | PASS | WARN | FAIL |
|---|---|---|---|---|
| `SCHEMA_COMPLIANCE` | live notes missing a title, a type, provenance (the index's `sourceOrigin`) or a topic | none | any | never |
| `ORPHAN_DETECTION` | settled live notes with no incoming knowledge edge; a topic's `CORE_IDEA` counts, as in the `orphans` route; topics are graded under `MOC_COHERENCE` | 0 | 1–3 | 4+ |
| `LINK_HEALTH` | the share of settled live notes with fewer than two links | ≤ 5% | ≤ 20% | > 20% |
| `DESCRIPTION_QUALITY` | missing descriptions; descriptions that repeat more than 70% of their title's words (3 letters or more) | none | 1–2 missing, or any repeating | 3+ missing |
| `MOC_COHERENCE` | the topic tree: settled live notes in no topic; topics the HUB cannot reach; topics with two parents; more than one HUB; empty topics (no notes and no child topics) | none | 1–3 notes in no topic, a topic with two parents, or an empty topic | 4+ notes in no topic, a topic the HUB cannot reach, or two HUBs |
| `THREE_SPACE_BOUNDARIES` | open tensions | 0 | 1–3 | 4+ |
| `PROCESSING_THROUGHPUT` | open observations; stuck tasks; lost sources; stranded sources; a stalled backlog (terms below) | none | 1–5 open observations; 1–2 stuck, lost or stranded; or a stalled backlog | 6+ open observations, or 3+ stuck, lost or stranded |
| `STALE_NOTES` | live notes waiting for a person for more than 30 days: DRAFT or IN_REVIEW, and unchanged since | none | ≤ 10% of live notes | > 10% |

The throughput terms:
- **Stuck:** a claim task held for more than 2 hours, or a task waiting at reflect, reweave or verify that nothing has touched for more than 2 hours.
- **Lost:** a source whose latest task FAILED, that still exists, and that is neither EXTRACTED nor ARCHIVED. Two kinds of FAILED task are bookkeeping and never count: one whose source was deleted, and one with a later task for the same source. The message gives all three numbers.
- **Stranded:** a source in INBOX or EXTRACTING that has notes derived from it. The route reads only the sources that have derived notes and no DONE task. In Liberuum, that is 6 of the 120 sources with notes.
- **Stalled backlog:** tasks are waiting, and the queue has not moved for 24 hours.

Each message carries the numbers. Examples, with Liberuum's figures at about 19:50:
- `LINK_HEALTH`: "123 of 313 notes (39%) have fewer than two links to other notes, and 90 have none. A note has 2.4 links on average. 1,271 of 1,722 edges (74%) carry a reason."
- `PROCESSING_THROUGHPUT`: "860 sources waiting, 180 done. 60 tasks closed without finishing: 55 because their source was deleted, 5 queued again; none lost. No open observations."
- `MOC_COHERENCE`: "Every settled note is in a topic. 1 topic is empty: Health, Quality & Gotchas. 12 topics hold more than 10 notes; the hierarchy guide makes such a topic a domain. 127 of 547 memberships say why the note is there."

#### 2.3 Metrics and recommendations

`graphMetrics`:
- `noteCount`: live notes.
- `mocCount`: topics, including the HUB and domains.
- `connectionCount`: knowledge edges (`stats.edgeCount`).
- `density`: as the `density` route computes it.
- `orphanCount`: as `ORPHAN_DETECTION` counts them.
- `danglingLinkCount`: knowledge edges whose source or target is no longer a document in the drive. Liberuum has 0.
- `mocCoverage`: the share of settled live notes that are in a topic.
- `averageLinksPerNote`: links to other notes per live note, each link counting for both of its ends.
  - Today's procedure divides every knowledge edge by the number of notes.
  - The editor colours this number amber under 2, so it must measure what `LINK_HEALTH` grades.

`recommendations`:
- One per check that is not PASS. Each names the action and where to take it, for example "Link the 123 notes with fewer than two links: Reweave notes does this while processing is idle."
- Every write replaces the whole list.

#### 2.4 When it runs

- **Desktop:** a new care loop in the sidecar (`sidecar/src/vault-care.ts`). It runs every 2 minutes, with the first pass a minute after start. It checks every local vault, with or without a pipeline, and sends `by: "desktop app"`. A vault is checked:
  - at the loop's first pass;
  - when its open claim tasks went from some to none since the previous pass, which means an import has finished;
  - 6 hours after the loop's last check of it.
- **On opening, on the web and the desktop:** opening Health check runs a check without `force` when the stored report is more than an hour old and the viewer can write.
- **Check now:** a button that sends `force: true`.
- **Hosted, on a schedule:** a new piece action, Check vault health (`check-vault-health`), calls the route with `by: "workflow"`. It uses no model.
  - A hosted vault can schedule it in Workflow Studio with the runtime's schedule trigger: `@powerhousedao/piece-core`, `schedule`, config `{ "mode": "interval", "every": 6, "unit": "hours" }`.
  - The desktop does not use it.

#### 2.5 What the user sees

- **The Health check view** (the report editor, opened from the vault menu):
  - **Header:** the overall status, "Checked 14:05 · desktop app", and a **Check now** button for anyone who can write.
    - While a check runs: "Checking…".
    - When nothing changed: "Nothing has changed since 14:05."
    - On failure: "Could not check: <message>".
  - **Never checked:** "This vault has not been checked yet." and **Check now**. The "Run /health in Claude Code" lines go.
  - **Affected items** are ids, shown as titles that open the document. A string that is not an id shows as plain text; an older report written with titles holds such strings.
  - **Guidance** names the in-app remedy first: Reweave notes for links and orphans, and Needs attention (§3.4) for throughput. The Claude Code command stays as the second line.
- **The fallback view** (`HealthDashboard.tsx`) is used only when a vault has no report document. It loses its own computation. It shows a dry run of the route, with "This vault has no health report yet; Check now saves one."

### 3. Failures become observations

#### 3.1 Who records

- **The desktop's care loop records them, from the runtime's run journal.** On each pass, for each vault, it reads:
  - the runs of the vault's pipeline and Reweave workflows since the last pass (`workflowRuntime.runsPage`, newest first);
  - the `lastError` of both triggers (`triggerStates`).
- **Why the journal:** it holds every failure with its error, its step and its trigger payload, which names the source. That includes a step whose worker was killed or timed out, which no code inside the piece can see. A FAILED task holds no cause, and all 60 of Liberuum's are bookkeeping.
- **On its first start**, the loop looks back 24 hours. After that, it keeps a cursor per workflow in `<dataDir>/vault-care.json`.

#### 3.2 Causes and dedupe

Each failed run gets a cause key. `run-problems.ts` gains `causeOf(run)`, which builds on `classifyRunError`:

| Error | Key | Title |
|---|---|---|
| out of credit (402) | `pipeline:no-funds` | Processing stopped: the model provider account is out of credit |
| key refused (401, 403) | `pipeline:bad-key` | Processing stopped: the model provider refused the API key |
| rate limited (429) | `pipeline:rate-limited` | The model provider is rate-limiting processing |
| "did not answer within" | `pipeline:slow-model:<model>` | <model> did not answer in time |
| model not found (404) | `pipeline:model-missing:<model>` | <model> is not available at the provider |
| any other HTTP status | `pipeline:model-refused:<model>:<status>` | <model> refused requests (HTTP <status>) |
| over `runTimeoutSeconds` | `pipeline:deadline` | A run went over the pipeline's time limit |
| app closed, worker killed | none | not recorded: the watchdog queues the source again |
| anything else | `pipeline:<step>:<message>` | <Step name> failed: <message> |
| a trigger's `lastError` | `pipeline:trigger:<message>` | The pipeline cannot check for work: <message> |

- **Reweave's runs** use the same table, with keys that start with `reweave:` instead of `pipeline:`.
- **`<message>`** is built from the error:
  - take the text after its last "failed: ", up to "(done before it";
  - lower-case it; quoted text becomes "…", numbers become "#", ids of 16 or more characters become "*";
  - keep at most 80 characters.
  - For example, Liberuum's "Insufficient permissions" becomes `pipeline:connect:insufficient permissions`.
- **The model** is read from the error ("gpt-6.1-sol did not answer within 120 s"), so the `slow-model` key keeps it.
- **One open observation per key.** While an observation with the key is PENDING, each new failure adds to it. Once it is archived, promoted or implemented, the next failure opens a new one. Its content begins "This happened before: <title> — `<id>`".
- **Batching.** A key's first failure is sent at once. Later failures are summed and sent at most once an hour per key. A source that fails every 12 minutes therefore adds at most 24 operations a day.
- **A trigger error** counts once each time it appears, not once per poll.
- **Every cause opens an observation on its first failure**, except interruptions.

From Liberuum's journal, the loop would open two observations:
- `pipeline:slow-model:gpt-6.1-sol`: 3 times, 3 sources;
- `pipeline:connect:insufficient permissions`: once, 1 source.

#### 3.3 The recording route and the observation model

- **`POST observations/record?drive=<id>`**
  - **Body:** `{ key, title, description, content?, category, at, count?, refs?, by? }`.
  - **Answer:** `{ id, created, occurrences }`.
  - Under a per-vault lock, it looks for the PENDING observation with that key. Observations are named `obs-<first 12 hex of sha256(key)>`, so it reads only the documents with that name.
  - It records the occurrence on that observation. If there is none, it creates a new one in `/ops`, the folder where `POST notes` places a `bai/observation` (`subgraphs/http/lib/vault-folders.ts:26`).
  - It needs write access to the drive. The Claude Code agent can call it the same way, and so can a hosted workflow later.
- **What the care loop sends:**
  - category `PROCESS`, and `observedBy` "desktop app";
  - a description of one or two sentences, the effect and the fix. For example: "Sources stop at extraction until the account has credit. Add credit at your provider, or choose another model in Settings › Models."
  - content with what happened, the last error (at most 1,500 characters) and what to do;
  - `refs`: the ids of the affected sources, or the notes' ids for Reweave.
- **`bai/observation` v2**, a new specification version. It is made through reactor-mcp in Vetra (see Rollout).
  - **State** gains `key: String`, `occurrences: Int!` (initial 0), `lastObservedAt: DateTime` and `refs: [String!]!`.
  - **`CREATE_OBSERVATION`** gains two optional inputs, `key: String` and `refs: [String!]`. It sets `occurrences` to 1 and `lastObservedAt` to `observedAt`.
  - **New `RECORD_OCCURRENCE { at: DateTime!, count: Int!, refs: [String!]! }`:**
    - adds `count` to `occurrences`;
    - moves `lastObservedAt` to `at` when `at` is later;
    - puts the new refs first, without duplicates, and keeps 50.
    - Errors: `ObservationClosedError` when the status is not PENDING; `InvalidOccurrenceCountError` when `count` is below 1.
  - **The upgrade from v1** sets:
    - `occurrences` to 1 for a created observation, and to 0 otherwise;
    - `lastObservedAt` to `observedAt`;
    - `refs` to `[]` and `key` to null.
    - Codegen writes `upgrades/v2.ts` once; the `occurrences` rule is a hand edit that it keeps.
  - **Replay:** past operations replay as before.
    - v1 operations keep the v1 reducers.
    - v2 adds an operation that no past document holds, and two optional inputs that no past operation carries.
    - An existing document reaches v2 only through `UPGRADE_DOCUMENT`, with `scripts/upgrade-documents.mjs --type bai/observation`. Liberuum has none to upgrade.

#### 3.4 What the user sees

- **Health check view:** a **Needs attention** list above the checks, read live from the open observations.
  - Each row has the title, a line such as "12 times · last 5 min ago · 9 sources", and two buttons: **Open**, and **Mark handled** (`ARCHIVE_OBSERVATION`).
  - With nothing open, the list is not shown.
  - `PROCESSING_THROUGHPUT` lists the same observations as affected items.
- **Vault menu:** the Health check entry carries a hint such as "2 need attention".
- **Processing queue view:** when an open observation's key starts with `pipeline:`, a banner over the tasks reads "Processing has a problem: <title>. Open". With more than one, it adds "+1 more in Health check".
- **The observation editor:** "Seen 12 times · first 15 Oct 12:48 · last 15 Oct 12:53", the affected documents as links, and the key in small print.
- **The web app** shows the same views. Observations appear there when something records them: the desktop, the agent, or later a hosted workflow.

#### 3.5 FAILED tasks

- They stay terminal, and nothing in this spec changes them.
- Health sorts them into three kinds: source deleted, queued again, or lost (§2.2). Only lost tasks affect the grade.
- No observation is made from a task. The cause behind a failed task is already recorded from its run.

### 4. Testing and measuring

- **The piece:**
  - `weaveState`: link counting (types, live ends, `SUPERSEDES`), retired and DRAFT notes, topics.
  - The trigger: `reach` and the `include_unlinked` fallback; the order; the busy test on `lastProcessedAt`; one run at a time, the 70-minute hold, and the pause and refund after a failure; skipping the graph read when nothing changed.
  - The resolver, on Liberuum's dropped answers: "the new note <id>", paraphrased titles, ambiguous texts and unknown texts. The prompt sentence.
  - Reweave on a note with one link: its neighbour is left out of the candidates, and the prompt has the extra line.
  - Check vault health.
- **The server:**
  - `computeHealth`, per check, at every threshold, with fixtures for settled notes, retired notes and each kind of FAILED task.
  - The write rule (force, changed, 24 hours) and the lock; dry-run permissions; creating the report when it is missing.
  - `observations/record`: create; record; a new observation after an archived one; the lock.
- **The model:** the v2 reducers at 95% coverage or more, every error included, and the upgrade.
- **The app:** `causeOf` on Liberuum's five real errors; the loop's schedule (first pass, drained queue, 6 hours); batching; the cursor and the 24-hour look-back.
- **Regressions:** every existing suite stays green.
- **Live, in Liberuum, after the import:**
  - Connect's links per note on the local model, before (1.0) and after.
  - Thin notes before and after the first idle hour, and links written per Reweave run.
  - The first report. Expected: FAIL on links (39% thin at 19:50); WARN on topics (one empty topic), contradictions (2 open) and throughput (two observations); PASS on the rest. Then `LINK_HEALTH` again, once Reweave has caught up.
  - The two observations from the look-back.

## Decisions for review

1. **Reweave's default reach includes notes with one link.**
   - Recommended: `thin`, with one-link notes after the notes with none.
   - Alternative: only notes with no link (`unlinked`).
   - Why: the design asks for two links, and 44 notes have one. The retry limits cap the cost.
2. **What counts as a link.**
   - Recommended: `RELATES_TO`, `BUILDS_ON` and `CONTRADICTS` to a live note. `SUPERSEDES` and links to retired notes don't count, and drafts are not woven.
   - Alternative: today's four types, to any note, with drafts included.
   - Why: a link to a retired duplicate connects nothing, and a draft is someone's work or a rejection.
3. **Connect accepts notes named in words. This changes the pipeline's Connect step too.**
   - Recommended: the prompt sentence plus the resolver.
   - Alternatives: the prompt sentence alone; or no change to Connect, in which case Reweave writes almost nothing on the local model.
   - Why: this is the cause of 285 of the 355 dropped links. The resolver matches only within the note's own candidates, and an ambiguous name is still dropped.
4. **Reweave runs only while the pipeline is idle.**
   - Recommended: idle only (with the corrected test), one run at a time, a check every 60 s, 6 notes per run.
   - Alternatives: a trickle during long imports (one 3-note run every 30 minutes); or a lower priority at the gateway for Reweave's calls.
   - Why: during an import the vault is still growing, so an early pass spends a note's tries on a vault that will look different in a few hours. The pipeline keeps the model.
5. **Old workflows move to `thin`.**
   - Recommended: an unticked or unset "Also notes with no links" reads as `thin`.
   - Alternative: it keeps meaning orphans until someone edits the workflow.
   - Why: orphans-only finds nothing once every note is in a topic.
6. **Health is computed by one server route, with no model.**
   - Recommended: `POST health/check`.
   - Alternatives: a piece action that computes from REST reads (no web app, and no Check now without a runtime); or the graph indexer rewriting the report when changes settle (no scheduler, but timers and writes inside the read model).
   - Why: one implementation serves every surface, the web app included.
7. **The desktop's schedule is a loop in the sidecar.**
   - Recommended: at the first pass, when the queue drains, and every 6 hours.
   - Alternative: a per-vault "Health check" workflow on the runtime's schedule trigger, made like Reweave. It is visible in Workflow Studio, but it cannot tell when an import ends.
   - Why: the check needs no model and no connection, and the end of an import is when the report should change.
8. **When a check writes.**
   - Recommended: on a change, or once a day. Check now always writes.
   - Alternative: every call writes.
   - Why: the report's history is its operation log, and a quiet vault should not add 36 operations a day.
9. **Five check definitions change.** They then differ from the agent procedure, which should call the route.
   - `LINK_HEALTH` is graded on the share of notes under two links (5% and 20%), and `averageLinksPerNote` counts links to other notes only.
   - `MOC_COHERENCE` measures the topic tree. Notes without topics move to `SCHEMA_COMPLIANCE`.
   - `STALE_NOTES` counts notes in review as well as drafts, by share (10%).
   - `PROCESSING_THROUGHPUT` counts only lost FAILED tasks.
   - Notes younger than an hour are not graded, and `noteCount` counts live notes.
   - Alternative: keep the procedure's definitions as they are.
   - Why: each old definition grades Liberuum wrongly today. Links get a PASS, the drafts check can never fail, and the deleted sources would keep throughput at FAIL forever.
10. **Opening Health check runs a check.**
    - Recommended: when the report is more than an hour old and the viewer can write.
    - Alternative: Check now only.
    - Why: hosted vaults have no scheduler, and this keeps their report fresh without one.
11. **The desktop records failures, from the run journal.**
    - Recommended: the care loop reads the run journal and calls the recording route.
    - Alternatives: the piece catching its own errors (misses killed and timed-out steps, and adds a vault write to every failing step); error-port steps in the pipeline template (changes `pipeline.json`); or the watchdog reading FAILED tasks (they hold no cause).
    - Why: the journal is the only place where every failure is written down.
12. **Dedupe.**
    - Recommended: one open observation per cause, with its occurrences counted on it. A new observation opens once the old one is closed. Interruptions are never recorded. Every other cause opens an observation on its first failure.
    - Alternatives: reopen the closed observation; or open flaky causes (timeouts, rate limits, unknown errors) only on a second failure within 24 hours.
    - Why: when a cause the user closed comes back, that is news.
13. **The observation model gets a v2.**
    - Recommended: a key, occurrences, a last-seen time and refs, plus `RECORD_OCCURRENCE`.
    - Alternative: no model change. The key goes in the document name, and repeats are not counted.
    - Why: without a count and a last-seen time, nobody can tell whether a problem is still happening.
14. **Where observations show.**
    - Recommended: Needs attention in Health check, the menu hint, and the queue banner.
    - Alternative: a separate Problems view in the vault menu.
    - Why: Health check is where the vault reports on itself, and the throughput check already counts observations.
15. **A Check vault health piece action for hosted vaults.**
    - Recommended: add it, as a thin action with no model.
    - Alternative: no action; hosted vaults rely on the check on opening and on Check now.
    - Why: it delivers the plan's "health on a schedule" (`workflow-piece.md:874`) for servers without the app.

## What changes, by file

- **`bai-knowledge-note`:**
  - `pieces/knowledge-vault/lib/agent/reweave.ts`:
    - `weaveState`;
    - the read stage takes link counts and topics from `graph.json`;
    - DRAFT and superseded notes are skipped;
    - candidates leave out notes already linked, with the prompt line for them.
  - `lib/agent/connect.ts`: the resolver for `from` and `to`; the prompt sentence about ids; an optional "already linked to" line in `promptFor`.
  - `lib/triggers/unwoven-notes.ts`:
    - the `reach` prop, with the `include_unlinked` fallback;
    - selection and order through `weaveState`;
    - the busy test on `lastProcessedAt`;
    - the run markers, the 70-minute hold, and the pause and refund after a failure;
    - the graph read only on a change, or every 10 minutes.
  - `lib/actions/reweave-notes.ts`: writes the end-of-run marker.
  - `lib/actions/check-vault-health.ts` (new), registered in `pieces/knowledge-vault/index.ts`.
  - `templates/reweave.json`: `reach`, `pollEverySeconds: 60`, the description. `templates/README.md`: the Reweave section, and a recipe for a hosted health workflow.
  - `test/reweave.test.ts`, `test/phases.test.ts`, `test/piece.test.ts`, `test/conformance.test.ts`.
  - `subgraphs/http/lib/health.ts`: `computeHealth` and the comparison with the stored report.
  - `subgraphs/http/routes/health.ts`: `createHealthCheckRoute`.
  - `subgraphs/http/routes/observations.ts` (new): `POST observations/record`.
  - `subgraphs/http/index.ts`: registers both routes. The health route gets the graph query, as `tasks/reconcile` does.
  - `processors/graph-indexer/query.ts`: `documentIdsWithTopics()`.
  - `document-models/observation/`: v2 through reactor-mcp; `v2/src/reducers/observation-management.ts`; `v2/tests/`; the hand edit in `upgrades/v2.ts`.
  - `editors/health-report-editor/editor.tsx`: the header, Check now, the check on opening, Needs attention, ids shown as titles, the guidance copy.
  - `editors/knowledge-vault/components/HealthDashboard.tsx`: the live computation goes; it shows a dry run.
  - `editors/knowledge-vault/components/DriveExplorer.tsx`: the Health check hint.
  - `editors/observation-editor/editor.tsx`: occurrences, first and last seen, affected documents.
  - `editors/pipeline-queue-editor/editor.tsx`: the banner.
  - `docs/plans/workflow-piece.md` §18.3: "Health on a schedule" points to this spec.
- **`knowledge-vault-app`:**
  - `sidecar/src/vault-care.ts` (new) and its test: the loop, the schedule, the cursor, batching.
  - `sidecar/src/run-problems.ts`: `causeOf`, and the model name read from "did not answer within" errors.
  - `sidecar/src/main.ts`: starts the loop after the queue watchdog.
  - The vault package version in `sidecar/package.json`, `host/package.json` and `bun.lock`.
- **`powerhouse-knowledge`:**
  - `skills/health/SKILL.md`: one call to `POST health/check` replaces the gather, grade and write steps.
  - `AGENT.md:617`: what each category means.

## Rollout

1. **The observation model.** In Vetra, with `backup-documents/Observation.phd` imported if the vetra drive lacks it:
   - `RELEASE_NEW_VERSION`;
   - the v2 state, inputs, operation and errors, through reactor-mcp;
   - regenerate. For v1 to v2, codegen carries over only the files it generates, so write `v2/src/reducers/observation-management.ts` and move the hand-written tests to `v2/tests/` by hand;
   - `git diff document-models/`, then `bun run tsc`, `bun run test` and `bun run test:coverage`.
2. **The package:** the piece, the routes, the editors and the graph query. Run `bun run lint:fix`, `bun run tsc` and `bun run test`, then `bun run build`. The Switchboard loads the subgraphs from `dist/`, so the new routes do not exist until they are built.
3. **Publish a dev version** of `@powerhousedao/knowledge-note` with `ph publish --tag dev`. Publishing needs your registry login.
4. **The app:** add the care loop, move to that version, and restart. At start, the app rebuilds the Reweave workflows. The loop's first pass writes each vault's first report and records the last 24 hours of failures.
5. **Other users' vaults:** any observations they hold are upgraded with `node scripts/upgrade-documents.mjs --drive <id> --type bai/observation`. Do a dry run first, and record the run in `docs/migrations/`.
6. **The agent:** `/health` calls the route, and the category notes in AGENT.md follow.
7. **Measure** as in §4, after the import.

## Risks

- **The first report is red.** `LINK_HEALTH` fails at about 40% until Reweave catches up. That is the truth, and it should drop to WARN within the first idle hour.
- **Wrong links from the resolver.** A phrase matched to the wrong note gives a link with a plausible reason. Three things guard against it:
  - matching stays within the note's own candidates;
  - it needs exactly one match;
  - the reason must still pass the articulation check.
  - Every link stays visible with its reason.
- **Weaker links on the local model.** More of its proposals now land. Reviewers see them, and each one says why it holds.
- **The model change.** v2 costs process work: Vetra, regeneration, the upgrade. It touches no other model.
- **Reads.**
  - Reweave reads the queue every minute (680 KB in Liberuum). When nothing changed, it reads the graph at most every 10 minutes.
  - The care loop reads the run journal and the queue every 2 minutes.
  - That is small on one computer, and a vault ten times larger reads ten times more.
- **Other idle-time work.** Spec D's Update maps workflow also runs while the pipeline is idle, on the same local model. Each workflow runs one run at a time, and the gateway serves their calls in turn. A source queued meanwhile can wait behind the remaining calls of both, not of one (§1.3).
- **Two health definitions for a while.** The agent's `/health` disagrees with the app until the procedure calls the route.
- **Two writers to one report.** The lock serialises the desktop loop and someone's Check now. If nothing moved in between, the second one answers "unchanged".
