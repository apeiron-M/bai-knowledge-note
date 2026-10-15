# App polish — design

**Date:** 2026-10-15 · **Status:** draft; awaits review
**Repos:** `knowledge-vault-app` (the processing chip, Update, the control API, the built-in guide source, comments) and `bai-knowledge-note` (the vault app's views and guide, the source, note, queue and scope screens, the graph index, the workflow piece's wording)

## Why

Checked on the Liberuum vault in the desktop app (local engine, 2026-10-15) and in the code of both repos. Every gap below was confirmed at the lines cited. Three turned out different from how they were first described; their sections say how.

- **Liberuum now:** 1,044 sources and 468 notes. The queue holds 1,100 tasks: 870 open (869 waiting to be extracted, 1 at verify), 170 done, 60 failed. Of the pipeline's 50 latest runs, 48 succeeded, 1 is running, and 1 failed when the app restarted at 19:36 (`Piece worker exited unexpectedly (code=null, signal=SIGKILL)`). There is one run per source, and up to three run at once with a hosted model.
- **The chip reads one run.** It shows what the most recently started run did (`sidecar/src/pipelines.ts:546`, `paging: { limit: 1 }`). A failed run keeps "Last processing run failed" on screen until another run starts, even when its source was deleted or its work was queued again. Once the queue is empty, no run comes, so the message stays for good. With runs in parallel, a newer run that has finished also hides an older one that is still running.
- **Update throws the pipeline away.** It deletes the workflow, its connection and its secrets, then makes new ones (`pipelines.ts:282-287`, `discard` at `184-187`). The runtime files runs under the workflow's id, so the run history goes with the old workflow. Liberuum's pipeline has run since 2026-10-10, and an Update today would leave all of that behind. This cost is why template changes are avoided.
- **The copy and guides describe an older app:**
  - In the desktop app, a queued source says "run /pipeline in Claude Code".
  - The Getting started guide describes tabs, a top bar, a New menu, a Bridges metric, `--plugin-dir` and `.mcp.json`.
  - The processing queue says sources wait "for your review", although the Verify step closes them.
  - The built-in guide source says the chat only reads.
- **Small faults:**
  - an Activity filter for an operation no model has, and a Links filter that can never match;
  - a manual link that can have an empty target, and a link that loses its reason when its target changes;
  - deleted scopes that leave their work breakdowns pointing at nothing (Liberuum has two);
  - a control route that nothing calls;
  - a graph with no way to find a note.

## Goals

- In the desktop app, the processing status says what the work is doing now: running, waiting, failed and still waiting, or finished. A failure that no longer blocks anything stops showing.
- Updating a vault's pipeline keeps its workflow, the workflow's id and its runs. A template change then costs one click, and no history.
- Nothing in the desktop app tells the person to use Claude Code to process sources. The web vault mentions it only where the server may not process sources.
- The Getting started guide and the built-in guide source describe the app as it is now.
- Every Activity filter can match something. A link always has a real target and a reason. Deleting a scope leaves nothing pointing at it.
- The graph can find a note and hide kinds of notes and links.
- No document model change, and no change to `pieces/knowledge-vault/templates/pipeline.json`.

## Non-goals

- Work owned by the sibling specs:
  - **A:** extraction quality.
  - **B:** Reweave, scheduled health and "Run now", observations, and the health report's "Run /health in Claude Code".
  - **C:** a review list, approving as yourself, retrying failed sources, retiring duplicates.
  - **D:** maps and contradictions, including the Contradictions place disappearing at 0, the map tree, triangles and bridges.
  - **E:** import and export.
- Updating the copy of the built-in guide source that existing vaults already hold, or the notes written from it.
- A host API that tells the vault whether processing is switched on.
- Back-filling past link changes into Activity.

## Design

### 1. The processing chip reads the work, not the last run

- **Today:**
  - `status()` asks for one run (`pipelines.ts:530-563`).
  - The chip, the onboarding overview and the landing page each read that single run (`host/src/components/pipeline-chip.ts:22-37`, `host/src/onboarding/OverviewStep.tsx:30-33`, `host/src/screens/Landing.tsx:228`).
- **What `status()` reads now** (desktop sidecar):
  - **Runs:** the pipeline workflow's 20 most recent runs, with their `triggerPayload`. Every pipeline run carries `task_id`, `source_id` and `source_title` (`pieces/knowledge-vault/lib/triggers/new-pipeline-task.ts:64-73`, confirmed on Liberuum's runs).
  - **Running:** a run that is running, pending or queued (the watchdog's test, `queue-watchdog.ts:146`) and that started after this engine did. `ENGINE_STARTED_AT` (`main.ts:54`) is passed to the manager. A "running" record from before the engine started belongs to a run that was cut off.
  - **Waiting:** the queue's `activeCount`, the number of PENDING, IN_PROGRESS and BLOCKED tasks.
    - It is read with the typed query `PipelineQueue { document(idOrSlug) { document { state { global { activeCount } } } } }`. On Liberuum that answer is 160 bytes; the whole queue is 659 KB.
    - The queue's id is found once per vault in the vault's drive, as the watchdog finds it, and remembered.
    - The count is `null` when the queue cannot be read.
  - **Current failures:** a failed run counts only while its work is still waiting. It counts when all three hold:
    1. its payload names a task. Manual and test runs from Workflow Studio never count;
    2. no later run for the same task is running or has succeeded;
    3. the task is still open (PENDING, IN_PROGRESS or BLOCKED).
    - Only the third check reads the queue's tasks, with a typed query for `id` and `status` alone. That costs 163 KB and 30 ms on Liberuum, and runs only when a failed run has passed the first two checks.
    - A task that failed several times counts once, as its newest failure. At most 5 are kept, newest first.
    - Effect: a failure whose source was deleted stops counting when the watchdog drops its task, within 2 minutes. A failure the watchdog queued again stops counting at once, because the work is now a new task and counts as waiting.
  - **New shape of `ready`:**
    - adds `running: number`, `waiting: number | null`, `failures: { runId, source, at, error, problem? }[]` and `hasRuns: boolean`;
    - removes `lastRun`. The host and the sidecar ship together, so no older reader remains (`host/src/vaults.ts:112-125`).
- **The chip** (`describePipeline`). The first matching row wins:

  | # | When | Label | Tone | Button |
  |---|------|-------|------|--------|
  | 1–7 | No model; no pipeline; stale; runtime starting; trigger parked; trigger error; trigger paused | as today | as today | as today |
  | 8 | The newest current failure is a model-setup problem (`no-funds`, `bad-key`, `rate-limited`, `slow-model`, `model-missing`, `model-refused`) | today's label for that kind, e.g. "Processing stopped: your model provider refused the API key" | warn | See runs |
  | 9 | A run is in progress | "Processing… 869 sources to go"; just "Processing…" when the count is unknown or 0; with other current failures, " · 2 failed" is added | busy | See runs, only with failures |
  | 10 | The newest current failure was cut off (`interrupted`) | "Processing was interrupted when the app closed — it resumes on its own" | quiet | See runs |
  | 11 | Other current failures | "Processing: 1 source failed" / "Processing: 2 sources failed" | warn | See runs |
  | 12 | Tasks are waiting | "Processing: 869 sources waiting" | quiet | — |
  | 13 | Otherwise | "Processing up to date" when the pipeline has runs, else "Processing ready" | ok | — |

  - **Tooltip, rows 8–11:** the newest current failure, as `“<source title>”: <its problem message, else the run's error>`. Every other row keeps today's tooltip (`PipelineChip.tsx:55`).
  - "Last processing run failed" is no longer used.
- **Other readers of the status:**
  - **The onboarding overview** (`OverviewStep.tsx:25-35`):
    - "Writing notes from your sources…" while `running > 0`;
    - a model-setup failure's own message;
    - otherwise "Processing failed for 1 source." / "for 2 sources.";
    - the rest as today.
  - **The landing page:** shows "writing" while `running > 0`.

### 2. Update keeps the pipeline and its runs

- **Today:**
  - `ensure()` removes the record, deletes the workflow, the connection and both secrets, and then instantiates the template anew (`pipelines.ts:274-287`).
  - `ensureReweave()` does the same to Reweave notes when its template changes (`pipelines.ts:253`).
  - `applyModels()` calls `ensure()` for older records (`pipelines.ts:505-507`).
  - Runs are filed per workflow id, and the runtime keeps them for 30 days (`PH_WORKFLOWS_RUN_RETENTION_DAYS`, which the app does not set). A new workflow therefore starts with an empty history.
- **New: Update edits the existing documents in place**, as `followTemplate()` already does for the run policy and the poll interval (`pipelines.ts:408-471`).
  - **When:** the vault has a record and its workflow document still exists. Without a record, or when the workflow was deleted in Studio, the pipeline is created as today.
  - **Order.** New things are made first, as `followGateway()` does (`pipelines.ts:366-406`):
    1. Mint the engine token and create the two new secrets.
    2. **Connection:** keep the existing one. If it was deleted in Studio, create one from the template.
    3. **Workflow, in one `execute`:**
       - `REMOVE_EDGE { id }` for each current edge, then `REMOVE_STEP { id }` for each current step;
       - then the template's workflow operations, filled exactly as at creation (`templates.ts:64-104`): name, description, trigger, the four steps, the four edges, the policy, publish, the trigger again, publish again, and enable.
       - The template's step and edge ids are fixed, so the same ids come back.
       - The runtime runs the published version, so nothing changes for processing until `PUBLISH_WORKFLOW`.
       - **If an operation is rejected:** send `REVERT_TO_PUBLISHED`, which restores the trigger, steps, edges, variables and policy from the last publish. Then delete the new secrets, and the connection if step 2 made it, and report the error. The chip keeps "Processing needs an update".
    4. **Existing connection:** replay the template's connection operations onto it (name, connector, config, the two secret refs) with the new refs. Then write the model settings, as `updateConnectionModels()` does.
       - **If this fails:** delete the new secrets and report the error. The workflow already matches the template, and the connection still holds its old, working secrets. The next Update repeats both steps safely.
    5. Write the record:
       - the same `workflowId`, and the same `connectionId` unless step 2 made a new connection;
       - the new secret refs, token, models and digest;
       - `disabled` removed.
    6. Delete the old secrets.
    7. **Reweave notes:** updated in place the same way, with its own `REVERT_TO_PUBLISHED` on failure.
       - If the person switched it off in Studio, it stays off.
       - If the app switched it off (the record was `disabled` before this Update), it is switched on again, as today's re-creation does.
  - **Kept:** the workflow's id, its runs, and its place in the Workflows drive. "See runs" therefore keeps opening the same history.
  - **The button** reads "Updating…" while an Update runs. Today it reads "Setting up…" for both actions (`PipelineChip.tsx:71`).
- **`execute` checks the right operations** (`sidecar/src/reactor-gql.ts:53-69`).
  - Today it finds rejections among the first 500 global operations (`:60`). A workflow updated in place many times would pass 500, and a rejected operation would then go unnoticed.
  - New: it reads the global revision before writing, then reads only the newer operations: `operations(filter: { scopes: ["global"], sinceRevision })`.
- **For the sibling specs:** a template change still shows "Processing needs an update" on every vault, but after this the Update costs one click and no history. This spec should land before any template change B makes.

### 3. Copy that sends desktop users to Claude Code

- **The source editor today** (`editors/source-editor/editor.tsx:403-407`):
  - After "Queue for processing", it shows "Queued — run /pipeline in Claude Code".
  - The text depends on a local flag (`:215`, set at `:322` and `:337`), so it vanishes on reload. Sources queued through Add sources never show it.
- **New: a status line computed from the source's task**, read from the queue the editor already loads (`:305-314`). It replaces the local flag.
  - **The task:** the source's newest open claim task (PENDING, IN_PROGRESS or BLOCKED). Today `find` takes the source's first task (`:307`), which can be an old failed one.
  - **Copy:**

    | Task | Desktop | Web (Connect, a browser) |
    |------|---------|--------------------------|
    | PENDING at `create` | "Queued — the app processes it in the background" | "Queued for processing" |
    | Still PENDING at `create`, no handoff, 10 minutes after it was queued | as above | "Queued for processing — nothing has started it yet. If this vault's server does not process sources, run /powerhouse-knowledge:pipeline in Claude Code." |
    | IN_PROGRESS, or open at a later phase | "Processing — extracting notes" (`create`), "— connecting notes" (`reflect`), "— placing notes in topics" (`reweave`), "— checking notes" (`verify`) | same |
    | BLOCKED | "Processing is blocked — see Processing queue" | same |
    | No open task | nothing, as today | same |

  - The desktop test is `isDesktopHost()` (`editors/shared/host-config.ts:158`). The 10-minute check runs once a minute.
  - Failed work, and a button to retry it, are C's.
- **Pasted sources:**
  - **Today:** the form under "Paste text as a source" (`IngestForm`, `:938-1050`) leaves the new source in INBOX until the person also presses "Queue for processing". Files from Add sources are queued at once (`subgraphs/http/routes/sources.ts:333-383`), and so is the desktop's own sample (`sidecar/src/vault-sources.ts:29`).
  - **New button:** "Ingest Source" (`:1044`) becomes "Add source". When the vault has a processing queue, it also queues the source: `ADD_TASK` on the queue, then `SET_SOURCE_STATUS → EXTRACTING`, the same two writes as "Queue for processing" (`:316-338`).
  - **The lede (`:959-960`):**
    - desktop: "Paste the text. Once added, the app turns it into notes in the background."
    - web: "Paste the text. Once added, it is queued to be turned into notes."
- **Health:** the health report's "Run /health in Claude Code" (`editors/health-report-editor/editor.tsx:45`) and the health dashboard's (`HealthDashboard.tsx:315`) are reworded by B.
- **Dead code:** `editors/knowledge-vault/components/PipelineView.tsx`, with its "Use /seed to ingest source material" (`:126`), is imported by nothing. It is deleted.

### 4. The Getting started guide describes the app as it is

- **Stale today** (`editors/knowledge-vault/components/GettingStarted.tsx`):
  - "The Navigation Tabs": Notes, Graph, Sources, Pipeline, Health, Config (`:175-219`);
  - "Run the AI agent: In Claude Code … run /pipeline" (`:235-237`), repeated at `:673`;
  - "Notes tab … Graph tab … Health tab" (`:240`), "Open the Pipeline tab" (`:459`), "The Graph tab" (`:476`), "The Health tab" (`:520`);
  - "New > Add Source in the top bar" (`:258`), "Ingest Source" (`:265`), "New > Knowledge Note" and "Use the top bar menu" (`:376`, `:382`);
  - the "Bridges" metric (`:536`), which no health view shows. The health report shows density, orphans and dangling links (`health-report-editor/editor.tsx:116-134`);
  - "updates on the next tab switch" (`:563`);
  - `claude --plugin-dir …` (`:592`). The plugin now installs from its marketplace;
  - "/setup … imports the Ars Contexta methodology (249 research claims)" (`:594-596`) and the `/research/` tip (`:679`). The claims now stay with the plugin and are not imported (plugin `skills/setup/SKILL.md`, "Local methodology"). Liberuum holds no research claims;
  - "Edit .mcp.json" (`:602`). The plugin connects through a Switchboard CLI profile, and MCP is optional.
- **New content.** The six sections stay: Overview, Adding sources, Notes, Processing, Graph and links, AI agent. The places and menus are rendered from code, so a renamed place renames itself in the guide:
  - The places come from `buildPlaces` (`DriveExplorer.tsx:156`). The menu comes from `VAULT_MENU` (`:991`), and the create items from `CREATE_ITEMS` (`:1004`), which gets exported.
  - A test checks that the guide names only places and menu entries that exist.
- **Overview:**
  - **Find your way:** one line per place.
    - Ask: "Ask the vault a question; the answer names the notes it used."
    - Notes: "Every note: one idea each, with its links and its source."
    - Topics: "Maps of your topics, from the vault's top map down."
    - Sources: "What you added, and what became of each."
    - Work: "Scopes of work, their projects, and the breakdowns that deliver them."
    - Graph: "How notes connect. Find a note, or hide kinds of notes from the legend."
    - Contradictions: "Notes that disagree. Listed while any are open."
  - **The vault menu:** "Under the vault's name, and at the foot (Vault settings): Vault settings, Who has access, Processing queue, Activity, Health check, Files and folders."
  - **Search:** "Search (Ctrl K, or ⌘ K on a Mac) finds notes, topics, sources and chats."
  - **Adding:** "Add sources takes files; the arrow beside it offers Write a note, New topic and Paste text as a source."
  - **Quick start on the desktop:**
    1. "Add sources — drop files on the window or press Add sources."
    2. "Processing — the app reads each source in the background and writes its notes; the status at the top of the window says how it is going."
    3. "Review — new notes wait in review; open one, check it, and Approve it."
    4. "Ask — the answer names the notes it used."
  - **Quick start on the web:** step 2 reads "Processing — if this vault's server runs the pipeline, sources are processed on their own; otherwise an AI agent processes them (see AI agent)." The other steps are the same.
- **Adding sources:**
  - Add sources converts a PDF, a Word file, a web page or a book, and shows the sources it would create before anything is written. Each one is queued for processing.
  - Paste text as a source, which is queued when added (§3).
  - The statuses: Inbox → Extracting → Extracted, or Archived.
  - Editing a source returns it to Inbox.
  - "Delete source" is on each source's row.
- **Notes:** the note structure and statuses stay. "Write a note" is under the arrow beside Add sources. A link needs a reason (§6).
- **Processing:**
  - The four steps by name, with the phase each one owns: Extract (create), Connect (reflect), Place in topics (reweave), Verify (verify).
  - Desktop: "It runs on its own; See runs, at the top of the window, opens each run in Workflows."
  - Web: "It runs where this vault's server runs the pipeline, or from an AI agent."
  - Processing queue is in the vault menu.
  - "The Verify step finishes a source's task; its notes stay in review for you."
- **Graph and links:**
  - The link kinds stay.
  - Find a note and the legend filter (§10).
  - "Health check (in the vault menu) shows orphans, link density and dangling links." Bridges is removed; if D adds it to a health view, D adds it here.
  - "The graph updates on its own when notes change."
- **AI agent (optional):**
  - Desktop: "Settings › Diagnostics shows the two things an agent needs: the Switchboard CLI command for this vault and the MCP address." Those are `host/src/settings/Diagnostics.tsx:65-66`.
  - Web: "Point the Switchboard CLI at this vault: `switchboard init --url <origin>/graphql --name <vault> --use-profile`", where the origin comes from `resolveReactorEndpoint()`.
  - Install: "`claude plugin marketplace add liberuum/powerhouse-knowledge`, then `claude plugin install powerhouse-knowledge@powerhouse-knowledge`."
  - Commands use the plugin's prefix: `/powerhouse-knowledge:setup`, `:seed`, `:extract`, `:connect`, `:verify`, `:pipeline`, `:health`, `:graph`, `:search`.
  - The `--plugin-dir`, `.mcp.json`, 249-claims and `/research/` passages go.

### 5. Every Activity filter can match something

- **Today** (`editors/knowledge-vault/components/ActivityView.tsx`):
  - "Lifecycle" lists `SET_STATUS` (`:42`). No document model defines that operation: the 19 knowledge-note operations do not include it, and the source's `SET_SOURCE_STATUS` is not indexed.
  - Also found while checking: "Links" lists `ADD_RELATIONSHIP` and `REMOVE_RELATIONSHIP` (`:37`). The graph indexer applies those and `continue`s before it writes the activity row (`processors/graph-indexer/index.ts:271-325` against `:400-417`), so "Links" is always empty.
  - "Content" leaves out `PATCH_CONTENT`, a note operation the REST API accepts.
  - Each row shows the first 8 characters of the document's id (`:322`) instead of its title.
- **New:**
  - **Lifecycle:** `SUBMIT_FOR_REVIEW`, `APPROVE_NOTE`, `REJECT_NOTE`, `ARCHIVE_NOTE`, `RESTORE_NOTE`. `SET_STATUS` is removed from the filter, from `OP_ICONS` (`:62`) and from the summarizer (`processors/graph-indexer/summarize.ts:32`).
  - **Content:** adds `PATCH_CONTENT`.
  - **Links:** the indexer records `ADD_RELATIONSHIP`, `REMOVE_RELATIONSHIP` and `UPDATE_RELATIONSHIP` whose source is a document of this vault, as activity rows on the note the link starts from.
    - **Row id:** `<documentId>-document-<index>`. The document scope numbers its operations separately from the global scope.
    - **Scope:** `document`.
    - **Summaries:** "Linked to “<target title>” (builds on)", "Removed the link to “<target title>”", "Changed why it links to “<target title>”". The target title comes from `graph_nodes`, and falls back to the id.
    - **Filter list:** the three operations, plus v1's `ADD_LINK`, `REMOVE_LINK` and `UPDATE_LINK_TYPE` for older rows.
    - **Ordering:** `history()` sorts by timestamp, as `activity()` does (`processors/graph-indexer/query.ts:1028-1037`), so rows from the two scopes interleave correctly.
    - Link rows begin with this version; there is no back-fill.
  - **Rows:** show the document's title and kind from the vault's document index (`useVaultDocIndex`), and fall back to the short id.
  - **The count line:** with a filter on, it reads "12 changes (Lifecycle) in the latest 200", because the filter runs over the latest 200 changes (`:156-160`).

### 6. A link always has a real target and a reason

- **Today:**
  - **Manual entry** (`editors/knowledge-note-editor/components/links-section.tsx:514`) takes a "Link title…" and an optional "Document PHID" (`:551`, `:559`).
    - The title is thrown away: `_targetTitle` is unused (`editor.tsx:507`).
    - With the id left blank, `ADD_RELATIONSHIP` is sent with `targetId: ""` (`links-section.tsx:489` → `editor.tsx:526`).
    - Any typed id is accepted, even one that is no document in the vault.
  - **Changing a link's target** removes the link and adds a new one in two separate dispatches, with an empty reason (`links-section.tsx:173-185`). The add form never allows a link without a reason (`:493-496`).
- **New:**
  - **Manual entry is removed.** The search mode stays and gains two things:
    - For "Derived from", it lists the vault's sources instead of notes, taken from the document index's `byId` where `documentType` is `bai/source`.
    - A pasted id that belongs to any document in this drive is offered as a match, for example "Chapter 3 Hardware · source".
  - **Add** stays disabled until a document from the list is chosen and a reason is written.
  - **The editor guards** `onAddLink`: it sends nothing without a target, or with the note itself as the target.
  - **Change target:**
    - Picking the new target opens the reason form, already filled with the current reason and confidence, under "Why does this note link to “<new title>”?".
    - Save sends `REMOVE_RELATIONSHIP` (the old target) and `ADD_RELATIONSHIP` (the new one, with the reason) in one dispatch, as a type change does (`editor.tsx:574-616`). Cancel changes nothing.
    - The picker leaves out notes this note already links to with the same kind.

### 7. Deleting a scope of work leaves nothing pointing at it

- **Today:**
  - **The dialog** deletes only the scope (`editors/knowledge-vault/components/ScopeOfWorkView.tsx:306-320`). It says its projects' work breakdowns "stay, as documents of their own" (`:142-158`; the design note at `:23-25`).
  - **The chat's card** warns that they "stay, linked to nothing" (`editors/knowledge-vault/lib/chat/work-changes.ts:1178-1187`).
  - **What is left:**
    - Each breakdown keeps `sowRef` and `sowProjectId` pointing at the deleted scope.
    - Its editor shows a disabled "← Delivers an envelope" (`editors/wbs-editor/editor.tsx:61-93`).
    - Work lists breakdowns only through their scope's projects (`ProjectsView.tsx`), so a left-over one can be found only in search or in Files and folders.
  - **Liberuum:** two `bai/wbs` documents and no scope of work. Both point at scopes that no longer exist. "Knowledge Vault Go-to-Market Strategy — Work Breakdown" has 6 goals and "Knowledge Vault Go-to-Market Plan" has 3. All of the goals are to do, and none has a note.
- **New: the dialog**
  - **Lists** the breakdowns that deliver the scope: every project's `wbsRef`, plus any breakdown whose `sowRef` is this scope. Each one shows its progress, for example "Knowledge Vault Go-to-Market Plan — 3 goals, none done".
  - **A checkbox** under them, "Also delete these work breakdowns", is checked by default.
    - **Checked:** the breakdowns are deleted, then the scope.
    - **Unchecked:** each breakdown is unlinked first, with `SET_SOW_PROJECT_REF` and both fields null. The model defines that state as "not yet compiled into a scope" (`document-models/work-breakdown-structure/v1/schema.graphql:27-30`, `:129-133`). Then the scope is deleted.
    - When a breakdown holds recorded work (a goal that is not to do, or a goal note), a line under the checkbox says what would go, for example "5 goals done and 9 notes would be deleted with them."
  - The title must still be typed to confirm.
- **New: the chat.** Deleting a scope from the card adds one line for each linked breakdown: "Unlink work breakdown “<name>” — it stays, outside any scope". The chat never deletes a breakdown that it did not propose by name. The person can ask it to delete them too.
- **New: a list of left-over breakdowns.**
  - Work › Scopes of work shows, below the scope cards, "Work breakdowns outside any scope": every `bai/wbs` whose `sowRef` is empty or names no scope in this vault.
  - Each row shows the name and progress, with Open and Delete. Delete asks for the name to be typed, as for a scope.
  - Liberuum's two breakdowns appear here.
- **No new operation:** unlinking uses the existing `SET_SOW_PROJECT_REF`.

### 8. Stale wording about review and the queue check

- **What the person sees: the Processing queue**
  - **Today:**
    - Tasks at verify are grouped as "Waiting for review" (`editors/pipeline-queue-editor/lib/tasks.ts:12`, `:34`).
    - The header counts "N waiting for your review" (`editor.tsx:37`), with a "Needs review" tab (`tasks.ts:48`, `editor.tsx:14`).
    - The phase strip's last step says "waits for you" (`components/phase-flow.tsx:31`).
  - **Why it is wrong:** the Verify step closes the task (`pieces/knowledge-vault/lib/actions/verify-notes.ts:12`; `lib/agent/pipeline.ts:8-10`; `subgraphs/http/lib/reconcile.ts:18`), and so does the plugin's `/pipeline`. Liberuum's one task at verify is waiting for that step, not for a person.
  - **New:**
    - A task at verify is "Working" or "Queued", like a task at any other phase.
    - The review group and the review tab go.
    - The hint under verify reads "checks the notes".
    - Notes waiting for a person belong in C's review list.
- **The workflow piece:**
  - **The trigger's phase option** "verify: waiting for review" (`new-pipeline-task.ts:203`) becomes "verify: placed, to check".
  - **The Place step's description** (`place-in-mocs.ts:17`): "…advances the pipeline task to verify, where it waits for your review." becomes "…advances the pipeline task to verify, the next step."
  - **Its handoffs** "Ready for review." (`:53`, `:66`) become "Next: verify." Handoffs already written stay, as history.
  - **Verify's header** (`lib/agent/verify.ts:12-15`): "…and the task stays at verify, whose advance completes it after review." becomes "Nothing is approved: the notes stay in review for a person, and this step's advance completes the task."
  - **The template's description** (`templates/pipeline.json:73`) says the same thing. It stays as it is, because of the template constraint. It gets fixed together with the next template change made for another reason; after §2, that change no longer costs run history.
- **The desktop sidecar's comments:**
  - **The queue check.** This gap was described as "it's 10 s, not 15 s"; that is half right.
    - The template asks for a poll every 10 s (`pipeline.json:85`, `:268`).
    - The runtime's trigger supervisor wakes every 15 s (`TriggerSupervisor.tickMs`, default `15e3` in `@powerhousedao/reactor-workflow` 6.2.3-dev.52, not overridden by the app). So the queue is checked every 15 s in practice. Commit `499a44d1` says so, and so does the piece (`new-pipeline-task.ts:97`).
    - `main.ts:527` ("its 15 s queue check") is right about the cadence. `pipelines.ts:412` ("the 15 s interval") gives the wrong number for the setting.
    - Both comments get the same wording: "the template's 10 s poll interval (a queue check on every 15 s wake-up of the runtime)".
  - **The ChatGPT plan** (`main.ts:296-300`).
    - The comment says "(spec §7 Q4: chat only)". Q4 was decided as "test first" (`docs/superpowers/specs/2026-10-08-onboarding-and-models-design.md:313-318`), and the plan does run processing: `pipelineModelKey` answers `"chatgpt-plan"` (`:301`).
    - New: "The ChatGPT plan runs processing as well as the chat (spec §7 Q4, decided by the C1 test). To keep processing off it, answer undefined for "chatgpt" here."

### 9. The unused repair route is removed

- **Today:**
  - `POST /vaults/:id/pipeline/repair` (`sidecar/src/control.ts:365-366`) runs one watchdog pass. It was added with the watchdog "on demand" (`758ee0c`).
  - Nothing in `host/src`, `scripts` or `src-tauri` calls it.
  - A manual pass does what the watchdog already does every 2 minutes (`queue-watchdog.ts:260-261`). Like the watchdog, it re-queues only tasks that have been held for 10 minutes (`STALE_HOLD_MS`, `:30`), so a button would seldom do anything visible.
- **Removed:**
  - the route;
  - the `repairQueue` dependency (`control.ts:67`; `main.ts:386-390`);
  - its test (`control.test.ts:397-403`).
- **Kept:** `repairQueue()`, which the watchdog uses. Retrying a failed source by hand is C's.

### 10. Find and filter in the graph

- **Today:** the graph has zoom, fit and re-layout buttons (`editors/knowledge-vault/components/GraphView.tsx:1051-1108`) and a legend (`:1110-1170`). It has no way to find a node, and none to hide anything.
- **Find:**
  - A box at the top left of the graph, with the placeholder "Find a note or topic".
  - From the second character typed, it lists up to 8 nodes on the graph whose title contains the text. Maps of content are marked "topic".
  - Enter or a click selects the node, as a click on the canvas does: its neighbourhood is highlighted, its card opens, and the sidebar follows. The view moves to the node, at 1× zoom or closer.
  - Esc clears the box.
  - Choosing a node whose kind is hidden shows that kind again.
- **Filter: the legend becomes the filter.**
  - Each node entry (Draft, In review, Canonical, Archived, MOC) and each link entry (relates to, builds on, contradicts, supersedes, derived from, core idea) is a toggle. A hidden entry is struck through.
  - Hidden nodes are not drawn, and neither are links that touch them or are of a hidden kind. Hidden items cannot be hovered or clicked.
  - The layout keeps hidden nodes, so nothing moves when an entry is toggled.
  - "Show all" appears while anything is hidden.
- **State:** kept in `DriveExplorer` while the vault is open, and not saved.
- **How:**
  - A visibility mask sits beside the highlight array and is applied in the same pass (`graph/model.ts:657-675`). `hitTest` skips hidden nodes.
  - At 100,000 nodes, a toggle costs one pass over typed arrays, like a highlight does today.
- It works the same in Connect and in the desktop app.

### 11. The built-in guide source tells the truth about the chat

This file is `sidecar/src/sample-source.ts`. Its own note says: "Keep the statements true to the app".

- **The chat (`:51`).**
  - **Today:** "A chat that only reads the vault can be trusted with it: it can get an answer wrong, but it cannot damage a note."
  - **Why it is wrong:** the chat now proposes changes to scopes, projects and work breakdowns. They are written only when the person applies the card (`propose_work_changes`, `editors/knowledge-vault/lib/chat/vault-tools.ts:899-902` onward). It also saves an answer as a note once the person confirms it (`hooks/use-save-answer.ts:1-21`). It has 24 tools. The guide gives no tool count, so there is no count to fix.
  - **New:** the paragraph is split, so that each paragraph keeps one claim.
    - The first paragraph keeps: "An answer that cites the notes it used can be checked by opening them; an answer from a model's general knowledge cannot be. That is why the vault's chat answers from your notes and names them."
    - The new paragraph after it: "A chat that cannot change anything on its own can be trusted with the vault. It can offer to save an answer as a note or to change the work in your projects, but it shows each change first, and nothing is written until you apply it."
- **New notes (`:45`).**
  - **Today:** "A new note is a draft until it has been checked. The verify step reports which drafts are ready to approve…"
  - **Why it is wrong:** extraction submits notes for review (`pieces/knowledge-vault/lib/agent/write.ts:7`, `:86`), so they are In review, not Draft.
  - **New:** "A new note waits in review until you approve it. The verify step reports which notes are ready to approve and which need a closer look, and approving a note makes it the vault's settled view."
- **The pace of processing (`:41`).**
  - **Today:** "…processing runs in the background, one source after another, while you keep working."
  - **Why it is wrong:** with a hosted model, up to three sources run at once (`new-pipeline-task.ts:100`).
  - **New:** "…processing runs in the background while you keep working: one source at a time with a model on this computer, a few at once with a hosted one."
- **Checked and still true:**
  - links carry reasons;
  - a contradiction opens a tension;
  - a map needs three notes;
  - the four steps;
  - archived notes leave search (`processors/graph-indexer/query.ts:200-213`);
  - meanings are computed on this computer;
  - the vault stays local.
- **Only new vaults get the new text.** The guide is added once per vault (`control.ts:354`). Existing vaults keep their copy and the notes written from it, because the app does not edit a person's notes.

## Decisions for review

1. **The chip (§1).** A failure counts only while its work still waits. *Recommended.* The alternative keeps model-setup failures on screen until a later run succeeds. That brings back today's stuck message whenever the queue is empty.
2. **Update in place (§2).** *Recommended.* It also sets an order: it lands before B changes the template, and the template's stale description is fixed in that same change.
3. **Pasted sources are queued by "Add source" (§3).** *Recommended.* The alternative keeps the second press on "Queue for processing".
4. **The web hint that names Claude Code after 10 minutes (§3).** *Recommended:* on the web only, and never on the desktop.
5. **Activity "Links" (§5).** Record link operations in the graph index. *Recommended:* this is a processor change, and the rows start from this version. The alternative drops the Links filter.
6. **Manual link entry is removed (§6).** *Recommended.* "Derived from" lists sources, and a pasted id works for any document in the vault.
7. **Deleting a scope (§7).** Decide:
   - whether the checkbox starts checked (*recommended*: delete the breakdowns with the scope) or unchecked (unlink them);
   - that the chat only unlinks;
   - whether to show the "outside any scope" list;
   - whether Liberuum's two left-over breakdowns, which hold no recorded work, are deleted from that list. That is your call.
8. **The repair route (§9).** Remove it. *Recommended.* The alternative is a "Check now" button that would seldom change anything.
9. **The graph's find and filter (§10).** Build them now. *Recommended.* The alternative is to defer.
10. **The built-in guide source (§11).** Only new vaults get it. *Recommended.* The alternative is a one-time replacement of the guide source in existing vaults, which would leave their notes from the old text in place anyway.

## What changes, by file

- **`knowledge-vault-app`:**
  - `sidecar/src/pipelines.ts`:
    - `status()`: runs, waiting count and current failures;
    - `ensure()` and `ensureReweave()` work in place;
    - the comment at `:412`;
    - the deps gain `engineStartedAt`.
  - `sidecar/src/reactor-gql.ts`: `execute` checks only the operations written after the revision it read first.
  - `sidecar/src/main.ts`: the comments at `:296-300` and `:527`; `ENGINE_STARTED_AT` goes to the pipeline manager; the `repairQueue` dependency is removed.
  - `sidecar/src/control.ts`: the repair route and its dependency are removed.
  - `sidecar/src/sample-source.ts`: three passages.
  - `host/src/vaults.ts`: `PipelineStatus`.
  - `host/src/components/pipeline-chip.ts`, `PipelineChip.tsx`: the rules, the tooltip, "Updating…".
  - `host/src/onboarding/OverviewStep.tsx`, `host/src/screens/Landing.tsx`: read the new fields.
  - Tests: `sidecar/src/pipelines.test.ts`, where "re-creating a pipeline removes the previous documents and secrets first" becomes the in-place cases; `sidecar/src/control.test.ts`; `sidecar/src/reactor-gql.test.ts`; `host/src/components/pipeline-chip.test.ts`; `PipelineChip.test.tsx`.
  - The vault package version in `sidecar/package.json`, `host/package.json` and `bun.lock`.
- **`bai-knowledge-note`:**
  - `editors/source-editor/editor.tsx`: the status line, the choice of task, and "Add source" with queueing.
  - `editors/knowledge-vault/components/GettingStarted.tsx`: rewritten.
  - `editors/knowledge-vault/components/DriveExplorer.tsx`: exports `CREATE_ITEMS` for the guide, and holds the graph filter state.
  - `editors/knowledge-vault/components/PipelineView.tsx`: deleted.
  - `editors/knowledge-vault/components/ActivityView.tsx`: the filters, titles and count line.
  - `processors/graph-indexer/index.ts`, `summarize.ts`, `query.ts`: link rows, the end of `SET_STATUS`, and the order of `history()`.
  - `editors/knowledge-note-editor/components/links-section.tsx`, `editors/knowledge-note-editor/editor.tsx`: link targets, the reason on a target change, the guard.
  - `editors/knowledge-vault/components/ScopeOfWorkView.tsx`: the dialog and the list of left-over breakdowns.
  - `editors/knowledge-vault/lib/chat/work-changes.ts`: the unlink lines.
  - `editors/pipeline-queue-editor/lib/tasks.ts`, `editor.tsx`, `components/phase-flow.tsx`, with `tasks.test.ts` and `components.test.tsx`.
  - `editors/knowledge-vault/components/GraphView.tsx`, `graph/model.ts`, with `model.test.ts`: find and filter.
  - `pieces/knowledge-vault/lib/agent/verify.ts`, `lib/actions/place-in-mocs.ts`, `lib/triggers/new-pipeline-task.ts`: wording.
  - Not changed: `pieces/knowledge-vault/templates/pipeline.json`, and every document model.

## Rollout

1. **The vault package.**
   - Run `bun run tsc`, `bun run lint:fix` and `bun run test`.
   - Run `bun run build`: the graph indexer loads from `dist/`, as the subgraphs do.
   - Publish a dev version of `@powerhousedao/knowledge-note` (`ph publish --tag dev`), which needs your registry login.
2. **The desktop app.** Move it to that version, together with the sidecar and host changes, and test.
3. **Live checks on Liberuum** (desktop):
   - **The chip:** during the current backlog of 869 sources, and after it drains.
   - **One Update in place:** clear the record's `templateDigest` in the dev data directory so the chip offers Update. After the Update, the workflow's id and its runs must be unchanged.
   - **The Processing queue:** no "for your review".
   - **Activity:** add a link and see it under Links.
   - **A pasted source:** it is queued.
   - **Work:** the two left-over breakdowns appear. Delete them only if you agree (decision 7).
4. **Order with the sibling specs:** §2 lands before any template change that B makes.

## Risks

- **An Update half applied.**
  - Guarded three ways: the workflow is published last, `REVERT_TO_PUBLISHED` runs on any rejection, and new secrets are made first and old ones deleted last.
  - Processing runs on the published version throughout.
  - The `execute` fix in §2 is part of this guard. Without it, a rejection could go unseen on a workflow with more than 500 operations.
- **`activeCount` drift.**
  - It is a stored counter, and `RECONCILE_COUNTERS` exists because it can drift. A drifted counter shows a wrong "N sources to go".
  - On Liberuum today it matches the tasks (870).
- **The chip lags by up to 2 minutes** for a deleted source's failure, until the watchdog drops its task.
- **Activity's link history starts with this version.** Earlier link changes are not shown.
- **Deleted breakdowns cannot be brought back.** Guarded by the typed title, the explicit checkbox, and the summary of what would be lost.
- **The guide can drift again.**
  - The places and menus are read from code, and a test catches a guide naming one that does not exist.
  - The built-in guide source keeps its "keep true" note.
- **The web hint names a plugin command** (`/powerhouse-knowledge:pipeline`) that the plugin could rename.
