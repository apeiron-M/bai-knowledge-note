# Review and repair — design

**Date:** 2026-10-15 · **Status:** draft; awaits review (nothing is implemented)
**Repos:** `bai-knowledge-note` (the note model, the vault, note, source and queue editors, the REST lint, the Verify step, docs) and `knowledge-vault-app` (the package version, one end-to-end test). Doc corrections in `powerhouse-knowledge`.

## Why

Measured on the Liberuum vault in the desktop app on 2026-10-15 (drive `t2lgNDhnAWzjVppfZ72J0d0NoBbFeEpj4f7KCIS0_iM`). Code read on branch `ui-upgrade`.

- **249 of 319 notes wait for review.** 64 are approved, 6 are drafts, none is archived.
- **The backlog grows fast.** Later the same day (19:50 UTC), during a 900-source import, spec B counted 469 live notes with 405 in review, 24 retired duplicates left as drafts, and 60 failed tasks (`2026-10-15-pipeline-completeness-design.md`, Why). The numbers below are the morning's unless marked.
- **Nothing shows what waits.**
  - Notes is a grid of 30 cards with "Show more", in drive order, with no status filter and no sort (`editors/knowledge-vault/components/NoteList.tsx:13`, `:126-151`; the order comes from `editors/knowledge-vault/hooks/use-knowledge-notes.ts:125-167`).
  - The vault design already asks for a review-state filter with counts (`docs/design/vault-view/README.md:58`, `:62`). The UI upgrade plan left it for a later stage (`docs/superpowers/plans/2026-10-14-vault-ui-upgrade-web.md:758`).
- **Approving one note takes about six steps.** Open the card. Open the Details tab: the lifecycle buttons render only there (`editors/knowledge-note-editor/editor.tsx:297`). Press Approve. Type a reviewer name into an empty field (`editors/knowledge-note-editor/components/status-bar.tsx:98-106`, `:246-255`). Press Approve again. Go back and find the next note. For 249 notes that is about 1,500 actions.
- **Who approved is whatever was typed.**
  - The reducer compares the typed text with the note's provenance author (`document-models/knowledge-note/v2/src/reducers/lifecycle.ts:35`). Pipeline notes are authored `extract-claims · <model>` (`pieces/knowledge-vault/lib/agent/write.ts:63`), so any name passes.
  - Submit, Archive and Restore pre-fill the actor with the note's author (`status-bar.tsx:101-104`). A person who archives a pipeline note is recorded as the extractor.
  - A refused approval closes the form with no message: the editor dispatches without an error callback (`editor.tsx:325-329`).
  - The Approve form cannot take its optional comment: the field renders only when it is required or already filled (`status-bar.tsx:257`).
- **Verify's verdict per note is thrown away.** The app's guide promises: "The verify step reports which drafts are ready to approve and which need a closer look" (`knowledge-vault-app/sidecar/src/sample-source.ts:47`). The per-note result exists only in the run's output (`pieces/knowledge-vault/lib/actions/verify-notes.ts:95-122`). The task's handoff keeps counts only (`:86`). No screen shows it.
- **Failed work cannot be tried again.**
  - The queue editor only shows: it does not even take the dispatch (`editors/pipeline-queue-editor/editor.tsx:21`).
  - FAILED is final: FAIL_TASK refuses a DONE or FAILED task, and ADD_TASK refuses a repeated id (`document-models/pipeline-queue/v2/src/reducers/queue-management.ts:25-28`, `:143-155`). The failure's reason is not kept in the state, so no screen can say why.
  - The source editor offers "Queue for processing" only for an INBOX source (`editors/source-editor/editor.tsx:340`). It reads the source's first task, not its latest (`:307-314`).
  - The desktop watchdog re-queues only held tasks (`knowledge-vault-app/sidecar/src/queue-watchdog.ts:38-61`).
  - Liberuum's queue has 178 tasks: 119 done, 59 failed. Of the 59, 55 failed because their sources were deleted, 2 were re-queued and later done, and 2 failed in model-server outages whose sources were later extracted. All 59 fill the "Blocked & failed" tab. None needs anything, and nothing says so.
- **Duplicates cannot be retired.**
  - ARCHIVE_NOTE is legal only from CANONICAL (`lifecycle.ts:72-77`; the REST lint repeats it, `subgraphs/http/lib/lint/rules/knowledge-note.ts:41`).
  - Verify retires a duplicate with a SUPERSEDES link from the surviving note and REJECT_NOTE back to DRAFT (`pieces/knowledge-vault/lib/agent/verify.ts:170-193`). Liberuum had 6 such drafts in the morning (SUPERSEDES links of 2026-10-10 ×5 and 2026-10-15 ×1) and 24 at 19:50.
  - A draft stays in search, topic browsing and semantic neighbours: only ARCHIVED is left out (`processors/graph-indexer/query.ts:207-214`). Verify's own duplicate check also skips only archived notes (`verify.ts:79-91`), so a retired draft can be chosen as the survivor of a new pair (`verify.ts:150-168`).
  - The superseded banner tells the reader to archive the note (`editors/knowledge-note-editor/components/superseded-banner.tsx:64-68`). The model refuses that for a draft.
  - The plugin tells agents to approve a duplicate first, then archive it (`powerhouse-knowledge/skills/connect/SKILL.md:81`). That is an approval nobody meant.
  - No supersede or merge action exists. The Links tab can add a SUPERSEDES link and nothing more (`editors/knowledge-note-editor/components/links-section.tsx:50-56`).
- **Operation grants do not reach notes.** AGENT.md says a restricted APPROVE_NOTE makes WRITE holders need a grant (`powerhouse-knowledge/AGENT.md:722-725`). In the stack in use (reactor-api 6.2.3-dev.58) a restriction applies only to the document it is set on. `canMutate` asks `isOperationRestricted` about the note itself. Unlike READ and WRITE grants, it never looks at the drive above the note (`node_modules/@powerhousedao/reactor-api/dist/subgraph-extraction-CcgWd0De.mjs:195-202`, `dist/index.mjs:9510-9520`). On an open desktop vault, authorization is off (`knowledge-vault-app/sidecar/src/config.ts:69`, `:77-80`).

## Goals

- A person sees what waits and decides each note with one key, without typing a name. This works in the desktop app and in Connect.
- Each decision records who made it: the signed-in Renown address, or this computer's key on an open local vault.
- Verify's verdict and findings are kept on every note it checks and shown where the person decides.
- A source whose processing stopped can be started again, from the source and from the queue. It gets a fresh task and continues where it stopped. Failures that need nothing say so.
- A note can be retired from draft, review or approved. Replacing a note is one action. Liberuum's retired duplicates (6 in the morning, 24 by 19:50) end archived.
- No workflow template change. No new specification version. No stored operation changes outcome on replay, and the drift audit proves it before release.

## Non-goals

- Approving many notes at once (Decision 1).
- Changing who may approve: the self-approval rule, operation grants, or checking the actor against the operation's signer. Each changes which inputs the reducer accepts, and so how stored approvals replay. Agents approve today under an actor name different from the author (`powerhouse-knowledge/skills/verify/SKILL.md:116-122`).
- Re-extracting a source that produced notes (the extraction-quality spec chose option A).
- Merging note text, or moving other notes' links to the surviving note.
- Search and the Topic, Source and Kind menus in Notes (design stage 4).
- Run failures as observations, the watchdog's timing for held tasks, and runs that fail before they claim their task (spec B). Map membership of retired notes (spec D). A "to review" count on the desktop landing (spec F).
- Recovering Verify's verdicts for notes checked before this change.

## Design

### 1. The review list

#### 1a. Counts and a filter in Notes

- **Filter row** above the grid, with the morning's counts: All 319 · To review 249 · Drafts 6 · Approved 64 · Retired 0. The counts come from the statuses already loaded (`useKnowledgeNotes`). "Retired" is the word the chat already uses for ARCHIVED (`editors/knowledge-vault/lib/chat/vault-tools.ts:278`).
- **Sort:** Newest first (default), Oldest first, By source.
- **One line, once per vault:** "249 notes wait for your review. They're already searchable and used in answers. Review them" (the design's sentence). It can be dismissed. The dismissal is kept in `localStorage`, read and written inside try/catch.
- Search and the other menus stay in design stage 4.

#### 1b. The list

Choosing "To review" replaces the grid with a list.

- **Groups, in this order:**
  1. **To retire.** Notes in DRAFT or IN_REVIEW that a live note supersedes. They are found from the edges already in memory (`editors/knowledge-vault/lib/supersession.ts:29-45`). Each row names the replacing note and the link's reason. Group action: "Retire all" (§3).
  2. **One group per source.** The source with the newest note comes first. Inside, notes keep their extraction order (oldest first). The header shows the source title, "N to review", and Verify's line for that source when the queue has one (the verify handoff's `workDone`, `verify-notes.ts:86`).
  3. **Written in the vault.** Notes with no DERIVED_FROM link: saved chat answers and notes written by hand.
- **Counts.** The filter's number counts notes in review only. The To retire group can also hold drafts, so the list's header says both, e.g. "249 to review · 6 to retire".
- **A row shows:** the claim (title), the description, the type, up to three topics, Verify's verdict ("Ready" or "Look closer", §1d), the number of links, whether a map holds the note, and "Contested" while an open contradiction involves it (spec D's derivation, which its note banner uses).
- **An expanded row** (Enter, Space or click) adds: the body; where the note came from (the source title and the DERIVED_FROM reason, which names the passage); Verify's findings; and the links with their reasons, in both directions.
- **Data:**
  - The graph metadata already in memory paints the rows at once.
  - The documents of the IN_REVIEW notes are read in the background, six at a time, through the cache the Sources view uses for its 123 sources (`editors/knowledge-vault/hooks/use-reactor-docs.ts`). They give the verdict and the body.
  - The queue document gives each source's Verify line. The vault already finds its id (`editors/knowledge-vault/components/DriveExplorer.tsx:403-405`).
- **Verdict filter,** once the documents are in: All · Ready · Look closer · No verdict.
- **Paging:** 50 rows, then "Show 50 more".

#### 1c. Deciding from the list

- **Actions on a row:** Approve; Send back (REJECT_NOTE, to draft, with a reason); Retire (with a reason, §3); Replaced by… (§3); Open.
- **Keys,** when focus is in the list and not in a text field:

  | Key | Does |
  |---|---|
  | j or ↓, k or ↑ | next, previous |
  | Enter or Space | expand or collapse |
  | a | approve |
  | A | approve with a comment |
  | s | send back (asks for a reason) |
  | x | retire (asks for a reason) |
  | r | replaced by… |
  | o | open the note |
  | u | undo the last approval |
  | ? | show the keys |

  Inside the desktop app the vault owns its keys: the shell stands back while a workspace is open (`knowledge-vault-app/host/src/App.tsx:125`).
- **After a decision,** focus moves to the next row. The decided row leaves the list once its write lands.
- **An approval waits 3 seconds,** showing "Approving … Undo". An approved note can never go back to review, only be retired, so a misfired key must cost nothing.
  - Leaving the list sends waiting approvals at once.
  - While any wait, the vault tells the desktop it is busy (`setBusy`, `editors/shared/host-config.ts:78-83`), so quitting asks first.
- **Writes:** each decision is one dispatch to the note's own document through `applyAndWait` (`editors/knowledge-vault/hooks/use-save-answer.ts:60-80`). A refusal stays on the row, in plain words (`editors/shared/use-doc-write.ts:20-27`).
- **No batch approval** (Decision 1). "Retire all" exists only for the To retire group, where a replacement is already linked with its reason.
- **In the note editor,** the lifecycle action sits in the header on every tab, not only on Details (`editor.tsx:297`). The note-editor design puts it there (`docs/design/note-editor/README.md:76`). A note opened from the list returns to the same row when closed.
- **The queue's wording:** its "Needs review" tab counts tasks at the verify phase (`editors/pipeline-queue-editor/lib/tasks.ts:25-36`), which wait for the Verify step, not for a person. Spec F removes that group and tab (its §8). This spec adds only a link in the queue's header: "Notes to review".

#### 1d. Verify's verdict is kept on the note

- **What Verify writes.** In write mode, for every note it checked and did not retire: `RECORD_VERIFICATION { verifiedAt, verifiedBy: "verify-notes · <model>", verdict, findings }`. One `POST actions` per note, after the review stage and before the advance.
  - `READY`: the note has no rule, link or provenance issue and the model passed it (the step's "pass", `verify-notes.ts:103`).
  - `LOOK_CLOSER`: otherwise, with the issues as findings (the step's "check").
  - A note whose record fails is named in the step's summary. The task still advances: the verdict informs, it does not gate.
- **Where it lives.** The note's state gains `verification` (nullable, §5). The review list and the note's header show it.
- **Edited since.** When `updatedAt` is later than `verifiedAt`, it reads "Verified before the last edit".
- Notes verified before this change show "No verdict".

### 2. Approving as yourself

#### 2a. Who is acting

A new hook, `editors/shared/use-actor.ts`, returns the actor's id, its label, and every name it goes by. In order:

1. **Signed in** (Connect's Renown session, or the desktop's own sign-in, as `editors/shared/use-vault-identity.ts:10-22` already resolves): the address, lowercased. The stack stores addresses lowercased in its grant tables (`reactor-api/dist/index.mjs:9511`).
2. **Nobody signed in, on an open local vault:** the identity the vault's REST surface already acts as.
   - `GET ping` answers `user` with the open-mode owner (`subgraphs/http/index.ts:36-41`, `subgraphs/http/lib/authorize.ts:16-34`).
   - The desktop declares that owner as the engine's own key, a `did:key:…` (`knowledge-vault-app/sidecar/src/config.ts:64-69`, `sidecar/src/main.ts:208-219`). Settings › Identity shows it as "This app's key".
   - A decision made in the window and a write an agent makes through REST on the same computer therefore carry the same id. The host declaration does not change.
3. **Nobody signed in, anywhere else** (Connect on an unprotected drive): no actor. The actions read "Sign in to approve", with the Renown button the sign-in gate uses (`editors/knowledge-vault/components/AuthGate.tsx:166-182`).

**How an actor is shown:**
- the current actor → "you";
- your own address → your ENS name when Renown knows it;
- other addresses → shortened (`editors/shared/identity.ts:30-35`);
- the engine key → "this computer";
- anything else → as written, e.g. `extract-claims · gpt-oss-20b`.

No new ENS lookups are made. `editors/knowledge-vault/components/access/use-ens.ts` sends addresses to a third party (`:16`, `:33`), and the desktop's tests fail on any request that leaves the computer (`knowledge-vault-app/e2e/open-vault.spec.ts:6-9`).

#### 2b. The forms

- No actor field anywhere. Submit, Approve, Send back, Retire and Restore all use the actor.
- Approve takes an optional comment. Send back and Retire ask for a reason, because the model requires one (`document-models/knowledge-note/v2/schema.graphql:231-243`).
- Every lifecycle write goes through `useDocWrite`. A refusal is shown where the person acted.
- The provenance form on Details is pre-filled with the actor id (`editors/knowledge-note-editor/components/provenance-info.tsx:30` starts it empty). It stays editable, to correct an imported note's author.
- Saving a chat answer writes the actor id as the author. Today it writes `ensName ?? address ?? "the vault chat"` (`editors/knowledge-vault/components/chat/SaveAnswer.tsx:180`).
- The lifecycle timeline shows actors with the labels above (`editors/knowledge-note-editor/components/lifecycle-timeline.tsx:51-53`).

#### 2c. Your own notes

- The reducer's rule does not change (`lifecycle.ts:35`).
- The UI checks first. When the note's author is any of your names — the actor id, your address in any letter case, your ENS name, this computer's key — Approve is replaced by "You wrote this note. Someone else approves it."
- This catches an author saved as an ENS name or in another letter case, which the reducer's exact comparison misses.
- In a vault with one person, the notes that person wrote stay in review (Decision 5).

#### 2d. Permission

- The UI does not ask in advance who may approve. Restrictions are per note (see Why), so asking would cost one request per note.
- A refusal (`insufficient permissions`) reads "You may not approve notes in this vault. Ask its administrator."
- AGENT.md and the vault guide's chapter on access are corrected: an operation restriction applies to the document it is set on. Restricting approval for a whole vault is not possible on 6.2.3-dev.58 (Decision 10).

### 3. Retiring duplicates and superseded notes

#### 3a. RETIRE_NOTE

- **A new lifecycle operation:** `RETIRE_NOTE { id: OID!, actor: String!, timestamp: DateTime!, comment: String! }`.
- **Legal from** DRAFT, IN_REVIEW and CANONICAL. It moves the note to ARCHIVED, appends a lifecycle event from the current status, and stamps `updatedAt` and `provenance.updatedAt` as ARCHIVE_NOTE does (`lifecycle.ts:78-90`).
- **From ARCHIVED** it throws `InvalidStatusTransitionError` ("The note is already retired").
- **Unchanged:** ARCHIVE_NOTE and RESTORE_NOTE. RESTORE_NOTE brings a retired note back to DRAFT.
- **Why an operation, not a looser ARCHIVE_NOTE:** §5.
- **Everything downstream follows the status.** The graph index projects it from the state (`processors/graph-indexer/project.ts:205`). The note leaves search, topics and neighbours (`query.ts:207-214`), Verify's duplicate candidates, the extraction spec's convergence, and the catch-up's evidence (`subgraphs/http/routes/reconcile.ts:65`). It keeps its history, its links and its place in its source's claim list.
- **Named where the vault names operations:**
  - the REST lint's transition table, which becomes a set of allowed statuses per operation (`subgraphs/http/lib/lint/rules/knowledge-note.ts:37-43`);
  - the lifecycle set that `canMutate` checks (`subgraphs/http/lib/write.ts:47-53`);
  - the Activity phrase, "Retired: <comment>" (`processors/graph-indexer/summarize.ts`);
  - the Activity view (`editors/knowledge-vault/components/ActivityView.tsx:44-66`, `:377-381`);
  - the note's history labels (`editors/knowledge-note-editor/lib/revisions.ts:77-111`).

#### 3b. Replaced by…

- **Where:** the note's header menu, and a review row.
- **The dialog:** a picker (the Links tab's document search), a reason, and a confidence. The reason needs at least 20 characters, the vault's articulation rule (`subgraphs/http/lib/articulation.ts:13-40`).
- **Writes, in order:**
  1. On the replacing note: ADD_RELATIONSHIP replacing → this note, type SUPERSEDES, with the reason and confidence as metadata, as the Links tab writes one (`editor.tsx:504-531`).
  2. On this note: RETIRE_NOTE, comment `Replaced by "<title>" (<id>): <reason>`.
- **"Retire it now"** is on by default. For an approved note that other notes build on, it starts off and says "3 notes build on this one. Their links stay, and readers are sent to the replacement." That is the banner's "once nothing depends on it", made concrete.
- **Bridges.** When the note is a bridge — the only path between two parts of the graph (`GET bridges`, `subgraphs/http/routes/structure.ts:150-158`, `:190`) — the dialog warns that retiring it cuts the part behind it off. The vault's graph procedure gives the same warning (`powerhouse-knowledge/skills/graph/SKILL.md:114-115`), and spec D leaves this warning to the retire flow.
- **Merge** is this action with the reason pre-filled "Same claim as …". It is the vault's method for duplicates: supersede from the survivor, retire the duplicate (`powerhouse-knowledge/AGENT.md:865`). Moving text into the survivor stays a person's edit; the dialog offers to open the survivor.
- **In the Links tab,** after a SUPERSEDES link lands, the tab offers "Retire <title> now?".
- **The superseded banner,** on a live note, shows "Retire it" (one click; the comment is the link's reason) instead of "archive it once nothing depends on it" (`superseded-banner.tsx:64-68`).

#### 3c. Verify retires duplicates fully

- Verify's retire stage dispatches RETIRE_NOTE instead of REJECT_NOTE, after the SUPERSEDES link, with the same comment (`verify.ts:170-193`) (Decision 4).
- A vault that answers `UNKNOWN_ACTION` — a Switchboard on an older package (`subgraphs/http/lib/lint/index.ts:75-77`) — gets REJECT_NOTE, as today.

#### 3d. Liberuum's retired duplicates

- After the update, the review list opens with "To retire": 6 in the morning count, 24 at 19:50, and more while the import runs, because Verify rejects duplicates to DRAFT until this ships.
- "Retire all" sends RETIRE_NOTE to each, with you as the actor and the SUPERSEDES link's reason as the comment.
- They leave search, topics and neighbours. They stay in the graph with their SUPERSEDES chain and in their sources' claim lists, and their pages say "Superseded by →". Nothing is deleted.
- Expected afterwards: no live note is superseded, and every one of them is retired (Decision 8). From then on, Verify retires duplicates itself (§3c).

### 4. Trying failed work again

#### 4a. When a source has stopped

For each source, its latest claim task decides. Tasks are appended (`queue-management.ts:44`), so the latest is the last one with that `documentRef`.

| Latest task | Source | Shown as | Try again |
|---|---|---|---|
| FAILED | deleted | Source deleted | no |
| FAILED | ARCHIVED | Archived | no |
| FAILED | INBOX or EXTRACTING | Stopped, with the reason | yes |
| FAILED | EXTRACTED | Stopped after extraction, with the reason | yes |
| BLOCKED | live | Blocked, with the reason | yes |
| IN_PROGRESS, untouched for 2 h | live | Stopped: no run has worked on it since <time> | yes |
| none | EXTRACTING | Waiting with no task | yes |
| anything else | any | as today | no |

- **Tried again.** A FAILED task followed by another task for the same source is shown as "Tried again" and never offered.
- **Why 2 hours.** It is the existing line for a held task whose run is gone (`subgraphs/http/lib/reconcile.ts:46-47`; `HELD_TOO_LONG_MS`, `pieces/knowledge-vault/lib/triggers/new-pipeline-task.ts:40`). A step runs for an hour at most (the template's `timeoutSeconds: 3600`).
- **A PENDING task is never "stopped".** Waiting behind a backlog looks the same: a local model takes one source at a time (`new-pipeline-task.ts:153-164`). A run that fails before it claims its task is spec B's.
- **The reason.** FAIL_TASK and BLOCK_TASK keep it only in the operation log (`queue-management.ts:143-166`).
  - The queue view reads the queue's FAIL_TASK and BLOCK_TASK operations, filtered by type with the reactor's `operations(filter: { actionTypes })` (reactor-api `DocumentOperationsFilterInput`, `dist/index.mjs:1569-1577`).
  - It goes through `fetchDocumentOperations` (`editors/shared/document-revisions.ts:100`), which gains a type filter.
  - The read happens only while a stopped task is on screen.
- **Liberuum, expected:** 55 "Source deleted", and every other failed task "Tried again". Spec B found that the others (5 at 19:50) were all closed when the watchdog queued their source again (`queue-watchdog.ts:172-178`), so each has a later task. Nothing is offered. Measured at rollout.

#### 4b. What Try again writes

- **To the queue, in one batch:**
  1. When the latest task is BLOCKED or IN_PROGRESS: `FAIL_TASK { taskId, reason: "Stopped; tried again by <label>", updatedAt }`. A source never has two open tasks.
  2. `ADD_TASK { id, taskType: "claim", target: <source title>, documentRef: <source id>, createdAt }`, with a new id from `generateId()`. No `currentPhase`: the task starts at create. An id is never reused (`powerhouse-knowledge/AGENT.md:482`; `DuplicateTaskIdError`, `queue-management.ts:25-28`).
- **To the source, only when it is INBOX:** `SET_SOURCE_STATUS → EXTRACTING`, as "Queue for processing" does (`editors/source-editor/editor.tsx:316-338`).
- **Never EXTRACTED → EXTRACTING.** That is re-extraction, the extraction spec's non-goal. The catch-up also refuses a reopened source that already has notes and stats (`reconcile.ts:104`), so the new task would fail again.
- **A last check.** Just before writing, it looks at the queue it holds (kept live) and stops if the source got an open task meanwhile.
- **Same as the watchdog.** These are the operations the desktop watchdog writes when it re-queues a held task (`knowledge-vault-app/sidecar/src/queue-watchdog.ts:171-175`). The person now has the same action.
- **One function.** `planRetry` in `editors/shared/retry.ts` (pure) builds these actions for every place that offers Try again.

#### 4c. How the pipeline continues

- **The UI does not call the catch-up route.**
- **The trigger starts it.** The pipeline's trigger watches tasks waiting at create, every 10 seconds (`pieces/knowledge-vault/templates/pipeline.json`, trigger `phase: "create"`), and starts a run for the new task (`new-pipeline-task.ts:121`).
- **Each step gates itself.**
  - Extract sees the source already holds its extraction. It asks the vault's catch-up (`POST tasks/reconcile` with the source) to move the task past every phase the vault proves, then passes through (`pieces/knowledge-vault/lib/actions/extract-claims.ts:66-82`).
  - The catch-up also repairs a source left EXTRACTING with notes and no stats (`reconcile.ts:97-103`).
  - Connect, Place and Verify run or pass through by the same gate (`pieces/knowledge-vault/lib/agent/pipeline.ts:118-127`).
  - So the run resumes at the first phase the vault cannot prove. That is the app guide's promise (`sample-source.ts:39`).
- **The old task stays as history.** The catch-up never touches FAILED tasks (`reconcile.ts:150`).
- **Why not call the catch-up from the UI.** It would move the task past create before the trigger sees it. The trigger starts a task at a later phase only after 10 quiet minutes (`new-pipeline-task.ts:123-133`; `RESUME_AFTER_MS`, `:36`).
  - On the desktop, the watchdog's own catch-up runs every 2 minutes (`queue-watchdog.ts:210-218`, `:260-261`) and can win that race.
  - The UI therefore says "Queued again. It continues from where it stopped." and promises no time.
- **A vault with no pipeline** (agents only): the task waits for `/pipeline`, as a queued source does today.

#### 4d. Where Try again lives

- **The source editor.** A line under the header when the source has stopped: "Processing stopped at connect: <reason>. Try again".
  - The editor reads the source's latest task, not its first (`editors/source-editor/editor.tsx:307-314` uses `find`).
  - "Queued — run /pipeline in Claude Code" (`:405`) becomes "Queued for processing." The desktop and a server pipeline run it on their own.
- **The queue.**
  - "Blocked & failed" becomes "Stopped": only what can be tried again, each with its reason and Try again, plus "Try all again" for the tab.
  - The other failed tasks move to Finished with their label: Source deleted, Archived, or Tried again.
  - The header says, for Liberuum's morning count: "119 done. 59 failed tasks need nothing: 55 sources were deleted, 4 were tried again."
  - The queue editor takes its dispatch.
- **The Sources view.** One line in its header when any source has stopped: "2 sources stopped. See them", which opens the queue's Stopped tab.
- **Not a banner over every view.** Run failures as observations and in health are spec B's. The desktop's processing chip (`knowledge-vault-app/host/src/components/pipeline-chip.ts`) stays as it is.

### 5. The model change, and what it does to past operations

#### 5a. What the engine does with stored operations (read from the code)

- **Rebuilds re-run operations.**
  - When the engine writes to a document it does not hold in memory, it rebuilds it from the nearest keyframe. There is one keyframe per 10 revisions (`node_modules/@powerhousedao/reactor/dist/index.js:12907`).
  - Each later operation is applied again through the reducer of the specification version in force when it was recorded (`node_modules/@powerhousedao/reactor/dist/forwarding-logger-B9LLXItm.js:2093`, `:2244-2258`; the version per operation, `:2357-2367`; the warm path, `:2369-2400`).
  - Some rebuilds replay the whole log (`:2245`, `:2268`).
- **The stored error is decided again.**
  - Applying an operation again clears its `error` (`operationFromOperation`, `node_modules/@powerhousedao/shared/dist/document-model/index.js:746-755`). A new error is set only if the reducer throws again (`:3798`).
  - The rebuilt operation keeps its stored hash (`:3813-3814`), so nothing flags the difference.
  - Only authorization denials are kept as stored (`shared/dist/document-model/index.js:3025`; `forwarding-logger-B9LLXItm.js:2250`).
  - In the document scope, operations stored with an error are skipped (`forwarding-logger-B9LLXItm.js:2112`, `:2164`). Lifecycle operations are in the global scope.
- **So:** a stored refusal becomes a success when the reducer of that version now accepts it, and a stored success becomes a refusal when it no longer does. This repo has seen the second: a queue lost three tasks on its next write (`docs/migrations/2026-09-17-reducer-guards.md:70`; `powerhouse-knowledge/AGENT.md:488`).
- **Unknown types are no-ops.** The generated reducer returns the state unchanged for a type it does not know (`document-models/knowledge-note/v2/gen/reducer.ts:283-284`). Such an operation is stored as applied. It would take effect on replay once the type exists.

#### 5b. The options

- **Let ARCHIVE_NOTE accept DRAFT and IN_REVIEW in v2 — rejected.**
  - Every stored ARCHIVE_NOTE that was refused from a draft would apply on that note's next write.
  - The plugin tells agents to walk a duplicate to CANONICAL before archiving it (`skills/connect/SKILL.md:81`). "Archive refused, then submit, approve, archive" is therefore a likely history in vaults agents have worked.
  - Replay would retire such a note at the first attempt, refuse the next three, and rewrite its timeline.
- **The same change in a new version, v3 — safe but costly.** Operations recorded before the upgrade replay under v2. The cost:
  - a third copy of the model (the versioning spec puts the note model at about 4.2k generated lines, `docs/superpowers/specs/2026-09-18-document-model-versioning-design.md` §5);
  - an UPGRADE_DOCUMENT on every note before it can be retired: 319 in Liberuum, each reindexing every scope and showing in Activity (`docs/migrations/2026-09-18-model-v2-upgrade.md`, "Side effects");
  - a REST lint that branches on each note's version.
- **Two new operations in v2 — recommended.**
  - RETIRE_NOTE and RECORD_VERIFICATION are new names. No stored operation changes outcome, except one already carrying such a name. The REST surface refuses unknown types (`lint/index.ts:75-77`), and the drift audit confirms there are none before release.
  - The new state field `verification` is nullable. It is generated as `.nullish()`, like `provenance` (`v2/gen/schema/zod.ts:164`), so every stored note still validates.
  - CLAUDE.md asks for a new version when existing documents cannot satisfy the state. They can.
- **Approval and the queue:** no reducer change. FAIL_TASK, BLOCK_TASK and ADD_TASK are used as they are. The failure reason is read from the log.

#### 5c. Making the change (CLAUDE.md's process)

1. Load the KnowledgeNote model document in Vetra. If `getDocuments` shows nothing, import `backup-documents/KnowledgeNote.phd` into the vetra drive.
2. Read `getDocumentModelSchema` for `powerhouse/document-model`. Then send one `addActions` batch (scope global) against the latest specification, v2:
   - `SET_STATE_SCHEMA`: add `enum VerificationVerdict { READY LOOK_CLOSER }`, `type Verification { verifiedAt: DateTime! verifiedBy: String! verdict: VerificationVerdict! findings: [String!]! }`, and `verification: Verification` on `KnowledgeNoteState`. `SET_INITIAL_STATE` with `"verification": null`.
   - RETIRE_NOTE in module `lifecycle`: `ADD_OPERATION`; `SET_OPERATION_SCHEMA` with `input RetireNoteInput { id: OID! actor: String! timestamp: DateTime! comment: String! }`; `SET_OPERATION_REDUCER`; `ADD_OPERATION_ERROR` `INVALID_STATUS_TRANSITION` / `InvalidStatusTransitionError` (the lifecycle module's existing pair).
   - A new module `verification`: `ADD_MODULE`; `ADD_OPERATION` RECORD_VERIFICATION; `SET_OPERATION_SCHEMA` with `input RecordVerificationInput { verifiedAt: DateTime! verifiedBy: String! verdict: VerificationVerdict! findings: [String!]! }`; `SET_OPERATION_REDUCER`; `ADD_OPERATION_ERROR` `MISSING_FINDINGS` / `MissingFindingsError`, thrown for LOOK_CLOSER with no findings.
3. Codegen regenerates `knowledge-note.json`, `v2/schema.graphql` and `v2/gen/`. `git diff document-models/` must show only these changes. The hand-written reducers in `v2/src/reducers/` match the document's reducer code. Export the document back to `backup-documents/KnowledgeNote.phd`.
4. RECORD_VERIFICATION replaces `verification`. It does not stamp `updatedAt`, because a check is not an edit. It is legal in every status.

### 6. Testing and measuring

- **The model:**
  - RETIRE_NOTE from DRAFT, IN_REVIEW and CANONICAL (the event, both timestamps); refused from ARCHIVED, tested with the operation-index pattern; RESTORE_NOTE after RETIRE_NOTE.
  - RECORD_VERIFICATION: READY with and without findings, LOOK_CLOSER, a second record replacing the first, `MissingFindingsError`.
  - A replay test: a v2 history with ARCHIVE_NOTE refused from DRAFT rebuilds to the same state under the new reducers.
  - `bun run test:coverage` stays at 95% or more on lines, branches, functions and statements.
- **REST:** the lint's status sets, RETIRE_NOTE, LOOK_CLOSER with no findings; `canMutate` is asked for RETIRE_NOTE.
- **The piece:** Verify records one RECORD_VERIFICATION per checked note and none for a retired one; it retires duplicates with RETIRE_NOTE; it falls back to REJECT_NOTE on `UNKNOWN_ACTION`.
- **The editors** (pure functions, node environment):
  - the groups and their order, and the To retire selection;
  - the own-note check across letter case, ENS name and the engine key;
  - the actor's resolution order, and the key map;
  - the 3-second hold, its undo, and the flush on leaving;
  - `planRetry`: FAIL then ADD for a held or blocked task, ADD only for a failed one, the source status only for INBOX, never EXTRACTED → EXTRACTING, a new id every time, nothing when an open task exists;
  - the stopped classification: deleted, archived, tried again, 2 hours, no task;
  - the source editor reading the latest task.
- **The desktop, end to end** (`knowledge-vault-app/e2e`):
  - In an open vault, a note in review is approved with `a`. Its lifecycle event's actor is the engine key. No request leaves the computer.
  - A source with a failed task shows Try again. Pressing it adds a task with a new id at create.
- **The replay audit, before release:** after `bun run build`, `node scripts/audit-replay-drift.mjs --drive t2lgNDhnAWzjVppfZ72J0d0NoBbFeEpj4f7KCIS0_iM --origin http://127.0.0.1:4201`, with the Switchboard CLI's profile pointed at the same engine (the script lists documents through it). Harmful drift must be 0.
- **Live, on Liberuum:**
  - the counts by status before and after (the morning's 249 / 6 / 64 / 0 grew to 405 in review by 19:50);
  - retiring the duplicates that sit as drafts;
  - one timed review session over a source's notes, in seconds per decision;
  - the labels the queue gives the failed tasks (59 in the morning, 60 at 19:50).

## Decisions for review

1. **Batch approval.**
   - **Recommended:** none. One decision per note, one key each, with a 3-second undo.
   - **Alternatives:** (a) "Approve all Ready in this source", listing the titles in a confirmation; (b) approve every READY note in the vault at once.
   - **Why:** approving says a person read the claim and holds it as the vault's settled view (`sample-source.ts:47`). Only approved notes go out in `llms-full.txt` (`subgraphs/http/routes/llms.ts:69-75`). Notes in review already work in search and answers (`query.ts:207-214`; `docs/design/vault-view/README.md:62`). A batch would buy a smaller number and cost the meaning of "approved". At about 5 seconds per note, the 405 waiting at 19:50 take about 35 minutes; the 900-source import will add many more. If the timed session (§6) shows the pace is too slow, alternative (a) is the one to add: every title is on screen when it is confirmed.
2. **How a note is retired.**
   - **Recommended:** a new operation, RETIRE_NOTE, in v2, legal from DRAFT, IN_REVIEW and CANONICAL. The UI uses it everywhere.
   - **Alternatives:** (a) let ARCHIVE_NOTE accept drafts in v3; (b) the same in v2; (c) RETIRE_NOTE from DRAFT and IN_REVIEW only, keeping ARCHIVE_NOTE as the only way out of CANONICAL.
   - **Why:** (b) rewrites stored histories on replay. (a) costs a model copy and an upgrade of every note. (c) leaves two actions for one idea.
3. **Keeping Verify's verdict on the note.**
   - **Recommended:** yes. RECORD_VERIFICATION and a nullable `verification` field.
   - **Alternatives:** (a) write per-note lines into the verify handoff's text and parse them: no model change, but free text and per source only; (b) keep nothing and show only facts the list can compute (links, maps, source).
   - **Why:** the guide promises the verdict; it is the fastest triage signal; the field is nullable, so stored notes are unaffected.
4. **Verify retires confirmed duplicates by itself.**
   - **Recommended:** yes, RETIRE_NOTE instead of REJECT_NOTE.
   - **Alternative:** keep REJECT_NOTE and let the person retire them from "To retire".
   - **Why:** Verify already decides and links them. A rejected draft stays in search and can be picked as a survivor later. Retiring is visible (banner, history) and undone with Restore.
5. **Your own notes in a one-person vault.**
   - **Recommended:** keep the rule. Such notes stay in review, marked "yours".
   - **Alternative:** allow approving your own note with a required reason. That changes the reducer, needs v3, and changes how stored approvals replay.
   - **Why:** the rule is the vault's method. A note in review loses nothing in search or answers.
6. **Who acts on an open local vault.**
   - **Recommended:** the engine's key from `GET ping`, shown as "this computer".
   - **Alternatives:** (a) a name typed once and kept on the computer; (b) the fixed words "this computer".
   - **Why:** it is unique and stable, REST writes from the same computer already carry it, and the host declaration does not change.
7. **Where review lives.**
   - **Recommended:** the "To review" filter in Notes opens the list.
   - **Alternative:** a sidebar place, "To review", shown while any note waits, as Contradictions is.
   - **Why:** the approved design frames review as optional and done while reading (`docs/design/vault-view/README.md:33-34`, `:62`). A permanent count in the hundreds would nag.
8. **Liberuum's retired duplicates (6 in the morning, 24 at 19:50).**
   - **Recommended:** the "Retire all" button, pressed by you.
   - **Alternative:** a one-time repair in the desktop watchdog at start-up, recorded as the desktop app.
   - **Why:** a person acts and is recorded, and the same button serves every vault, in Connect as well.
9. **Connect without a sign-in.**
   - **Recommended:** approving needs a sign-in.
   - **Alternative:** today's typed name, pre-filled and kept per browser.
   - **Why:** the record of who approved should be an identity, not a string.
10. **Who may approve in a shared vault.**
    - **Recommended:** WRITE access is the gate for now. Correct AGENT.md and the guide. Ask upstream for operation restrictions that inherit, as grants do.
    - **Alternative:** add an APPROVE_NOTE restriction row to every new note when it is created.
    - **Why:** per-note rows would have to follow every note forever, and a missing row silently opens approval to all writers.
11. **The reach of Try again.**
    - **Recommended:** failed, blocked, held for 2 hours, and extracting with no task.
    - **Alternative:** failed tasks only.
    - **Why:** on a server nothing frees a held task, and on the desktop a held task with a finished phase holds a local model's queue for up to 2 hours (`new-pipeline-task.ts:153-158`). The action and its writes are the same in every case.

## What changes, by file

- **`bai-knowledge-note`, the model** (through reactor-mcp, §5c; generated files are never edited by hand):
  - `document-models/knowledge-note/knowledge-note.json`, `v2/schema.graphql`, `v2/gen/**`: regenerated.
  - `v2/src/reducers/lifecycle.ts`: `retireNoteOperation`.
  - `v2/src/reducers/verification.ts` (new): `recordVerificationOperation`.
  - `v2/tests/lifecycle.test.ts`, `v2/tests/verification.test.ts` (new), `v2/tests/reducer-coverage.test.ts`.
  - `backup-documents/KnowledgeNote.phd`: exported again.
- **`bai-knowledge-note`, the editors:**
  - `editors/shared/use-actor.ts` (new): the actor, its label and names.
  - `editors/shared/retry.ts` (new): `planRetry` and the stopped classification.
  - `editors/shared/document-revisions.ts`: a type filter for `fetchDocumentOperations`.
  - `editors/knowledge-vault/components/NoteList.tsx`: the filter row, sort and line; it switches to the list.
  - `editors/knowledge-vault/components/review/ReviewList.tsx`, `review/ReviewRow.tsx` (new): groups, rows, keys, actions, the hold.
  - `editors/knowledge-vault/lib/review.ts` (new, pure): grouping, ordering, To retire, the own-note check.
  - `editors/knowledge-vault/hooks/use-review-notes.ts` (new): the IN_REVIEW note documents and the queue's Verify lines.
  - `editors/knowledge-vault/components/DriveExplorer.tsx`: the queue document for Notes and Sources.
  - `editors/knowledge-vault/components/SourceList.tsx`: the stopped line.
  - `editors/knowledge-vault/components/ActivityView.tsx`: RETIRE_NOTE and RECORD_VERIFICATION.
  - `editors/knowledge-vault/components/chat/SaveAnswer.tsx`: the actor id as author.
  - `editors/knowledge-note-editor/editor.tsx`: actions on every tab; retire and replace wiring; the verdict line.
  - `editors/knowledge-note-editor/components/status-bar.tsx`: no actor field; reasons; errors shown; the own-note message.
  - `editors/knowledge-note-editor/components/replace-dialog.tsx` (new): "Replaced by…".
  - `editors/knowledge-note-editor/components/superseded-banner.tsx`: "Retire it".
  - `editors/knowledge-note-editor/components/links-section.tsx`: the offer to retire after a SUPERSEDES link.
  - `editors/knowledge-note-editor/components/lifecycle-timeline.tsx`, `components/provenance-info.tsx`: actor labels; the pre-filled author.
  - `editors/knowledge-note-editor/lib/revisions.ts`: the two operations' names.
  - `editors/pipeline-queue-editor/editor.tsx`, `lib/tasks.ts`, `components/task-table.tsx`: the dispatch, "Stopped", reasons, Try again, Try all again, "At verify".
  - `editors/source-editor/editor.tsx`: the latest task, the stopped line, the "Queued" wording.
- **`bai-knowledge-note`, the rest:**
  - `processors/graph-indexer/summarize.ts`: "Retired: …", "Verified: ready to approve", "Verified: look closer".
  - `subgraphs/http/lib/lint/rules/knowledge-note.ts`: status sets; RETIRE_NOTE; LOOK_CLOSER needs findings.
  - `subgraphs/http/lib/write.ts`: RETIRE_NOTE in the lifecycle set.
  - `pieces/knowledge-vault/lib/agent/verify.ts`: RETIRE_NOTE with the REJECT_NOTE fallback; a record stage.
  - `pieces/knowledge-vault/lib/actions/verify-notes.ts`: the record stage in write mode; the summary.
  - `docs/http-api.md:53`: RETIRE_NOTE among the lifecycle operations.
- **`knowledge-vault-app`:**
  - `e2e/review.spec.ts` (new): approve with a key in an open vault; Try again.
  - The vault package version in `sidecar/package.json`, `host/package.json` and `bun.lock`.
- **`powerhouse-knowledge`:**
  - `AGENT.md:552`, `:722-725`, `:865` and the copies `scripts/build-agent.mjs` generates: RETIRE_NOTE; what operation restrictions do.
  - `skills/connect/SKILL.md:81`, `skills/verify/SKILL.md:116-122`: retire instead of approving first.
  - `scripts/lint-actions.mjs`: the `VerificationVerdict` values.
  - The vault guide, chapters 2, 3, 5 and 6: archiving rules, Verify's verdict, the Notes filter, operation restrictions.

## Rollout

1. Land after the extraction-quality spec; both change `pieces/knowledge-vault/lib/agent/verify.ts`.
2. The model change through reactor-mcp (§5c). Regenerate, diff, write the reducers and tests.
3. The REST lint and write path, the indexer's phrases, the piece, the editors. Run `bun run tsc`, `bun run lint:fix`, `bun run test:coverage` and `bun run build`. The subgraph change needs the build and a Switchboard restart (CLAUDE.md).
4. The replay audit against Liberuum: harmful drift 0.
5. Publish a dev version of `@powerhousedao/knowledge-note`, as for the extraction spec. Move the desktop app to it and run its tests and end-to-end suite.
6. Update shared Switchboards to the package before anyone retires or verifies against them from a newer app (Risks).
7. The doc corrections in `powerhouse-knowledge`.
8. On Liberuum: Notes → To review → "Retire all" for the duplicates that sit as drafts. Then measure as in §6.

## Risks

- **Mixed versions.** A Switchboard on an older package ignores RETIRE_NOTE and RECORD_VERIFICATION: the generated reducer's default case returns the state unchanged. Its state then differs from a newer engine's, and once a keyframe passes the operation, the difference stays until a full rebuild. The desktop ships its engine and its UI together; shared servers must be updated first.
- **A stored operation already named RETIRE_NOTE or RECORD_VERIFICATION** would take effect on replay. The REST surface refuses unknown types; the audit must find none.
- **A misfired key** would approve a note that can then only be retired. The 3-second hold covers it.
- **Reading every note in review** for the list (405 at 19:50): six at a time and cached, while the rows already show from the graph data. A few seconds on the local engine, longer on a remote server.
- **No verdict for notes extracted before this ships**, the import's included. They show "No verdict"; each source's Verify line still helps.
- **Try again on a source that fails every time** fails again, with the same reason. The causes are the extraction spec's (long sources) and spec B's (failures recorded).
- **Notes a person wrote in a one-person vault** cannot be approved (Decision 5).
- **An agent can still approve under a made-up name.** The UI cannot prevent it (non-goal).
