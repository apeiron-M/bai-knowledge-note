# Extraction quality — design

**Date:** 2026-10-15 · **Status:** design approved in conversation; this spec awaits review
**Repos:** `bai-knowledge-note` (the workflow piece, the catch-up route, docs) and `knowledge-vault-app` (the model gateway, the queue watchdog)

## Why

Measured on the Liberuum vault in the desktop app on 2026-10-15. Its local model is gpt-oss-20b on llama.cpp, with a 32k context and one slot.

- Extraction kept 317 claims and rejected 1,023 on a gate (76%). 48 of 123 sources produced no notes, and all 48 were extracted by the local model.
- Five causes were found:
  1. **An undefined gate.** The candidate prompt's answer format offers `out_of_scope`, which the prompt never defines. Models use it to turn away subjects the vault has no notes on yet. ChatGPT (gpt-6.1-sol) rejected 32 of the Preface's 50 candidates and 20 of Chapter 0's 44 this way. The local model rejected 28 of 103 in Chapter 3.
  2. **Whole chapters in one call.** A source of up to 60,000 characters goes to the model whole. Drafting then sends every accepted claim plus the whole text again. "Chapter 3 Hardware" (31,477 characters) came back with no candidates in 3.7 s in the pipeline, and with 25 candidates, all rejected, when run again. With "medium" reasoning on the whole chapter, the model returned malformed JSON twice.
  3. **Practical statements rejected.** The local model rejects practical or descriptive statements as "not a claim". For example, "Most inference engineers use cloud GPUs" was rejected as "an opinion about usage patterns, not a testable claim".
  4. **Non-knowledge looks like failure.** Some sources hold no knowledge; "GPU Infrastructure" is a reading list. They end as "extracted, 0 notes", indistinguishable from a failed extraction. The design (the vault guide, chapter 3) says such material is archived.
  5. **No convergence.** A claim the vault already holds is skipped, so the existing note never gains the second source. The design says two sources that argue the same thing meet at one node.
- **A read-only probe** with the local model on 8,000-character windows and the revised prompt of §2 raised Chapter 3 from 0 to 17 kept claims and Chapter 1 Prerequisites from 0 to 10.

## Goals

- With the local model, the 48 empty sources are processed again in the desktop app. Book chapters produce notes, reading lists end archived, and any zero that remains is genuine.
- A claim made by two sources is one note, linked to both sources.
- Switching the model mid-run takes effect at the next window or model call, and nothing fails because of the switch.
- No workflow template change: no vault shows "needs update", and no run history is lost. No document model change.

## Non-goals

- Re-running sources that produced notes, or a general "Extract again" control (the chosen option was A).
- Linking the 92 unlinked notes (the Reweave setting), health checks, and a review or supersede UI. Each of these is separate work.
- Editing a note's text when it gains a second source.

## Design

### 1. Long sources are read in windows

- **Scope:** windows apply to the candidates stage and the drafting stage of Extract claims. The flows don't change.
- **Cutting:**
  - A window breaks at paragraph boundaries.
  - A heading stays with the text under it.
  - A paragraph longer than a window is split at sentence ends.
  - Each window is sent with the source title and the heading it falls under.
- **Size, chosen per model:**
  - **Local model:** 8,000 characters.
  - **Hosted model:** 24,000 characters.
  - **Known context size:** when it is known (the gateway's active-model answer, §1a, or the provider's model list, as OpenRouter's `context_length`), the window is the smaller of its base size and a quarter of that context, counting 3.5 characters per token.
  - **Minimum:** never below 2,000 characters.
  - **Override:** a new optional "Window size" prop on Extract claims, in characters. Blank means automatic.
- **Self-correcting:** a window whose answer is malformed twice, or empty twice (§2), is split in half and both halves are processed, down to the 2,000-character minimum.
- **Pace:** a local model gets one window at a time; a hosted one gets up to three at once.
- **Drafting:**
  - Each window's accepted claims are drafted with only that window's text.
  - A local model gets at most 8 claims per call, a hosted one 16.
  - The topic list is sent as today.
- **Across windows:**
  - The vault check runs once per candidate, as today.
  - The existing duplicate check between drafts runs once over every window's drafts, so a claim found in two windows becomes one note.
- **Short sources:** a source that fits in one window makes the same calls as today.

### 1a. Switching the model mid-run

- **The gateway** (desktop app) gets `GET /llm/v1/active`. It returns `{ model, locality: "local" | "hosted", contextTokens: number | null }` for the model currently configured. It is authenticated with the gateway key, like the other `/llm/v1` routes. `contextTokens` comes from the app's model catalog when that lists it, otherwise it is `null`.
- **The piece's model client** asks `{llm_base_url}/active`, cached for 5 s. If that fails (no gateway: a server's pipeline, OpenRouter, a custom endpoint), the client falls back to the connection's settings. Those are read at the start of each step, so a switch there applies from the next step.
- **Extract** checks the active model before each window. The windows still to come use that model's size, pace and call timeout. A window already sent finishes on the model the gateway sent it to.
- **Every model call** (`completeJson`) takes its timeout from the active model: 10 minutes local, 120 s hosted, as today. A call that times out after the active model changed since it was sent is sent once more under the new model's timeout. That resend does not count as one of its two attempts. Connect, Place, Verify and Reweave use the same helper.
- **How many sources run at once** already follows a switch: the queue trigger reads the connection's locality at every check, and the app rewrites the connection when the model changes.

### 2. The prompt, empty answers, and sources that hold no knowledge

- **Gates offered:** the answer format lists only `sentence | transclusion | falsifiability | coherence | independence | non_attribution | duplicate`. A rejection naming any other gate is still a rejection, but it is counted separately in the report as "rejected for a reason outside the gates" instead of being folded into `coherence`.
- **Two added sentences** (the probe's wording):
  - "A claim may describe how something works or what usually happens: keep it when a practitioner could reasonably say otherwise. Never strike a statement only because it is descriptive, practical or technical."
  - "Every subject the source covers is in scope, including subjects the vault has no notes on yet."
- **Whether the text holds knowledge:** the answer gains `source_kind: "knowledge" | "not_knowledge"` and a short `source_kind_reason`, for example "a list of references".
- **Empty answers:** an answer with nothing kept, nothing skipped and no non-claims, for a window of 2,000 characters or more, is asked once more. If it is still empty, the window is split as in §1. A 2,000-character part that stays empty is reported as "no claims found in this part".
- **Archiving:**
  - **When:** no claim survives (no new notes and no existing notes linked under §3), and every window said `not_knowledge`. A window whose answer leaves `source_kind` out counts as `knowledge`.
  - **What is written:** `RECORD_EXTRACTION_STATS`, then `SET_SOURCE_STATUS` → `ARCHIVED`. The source model allows `EXTRACTING → ARCHIVED`.
  - **The reason** goes into the report and the task handoff. The source stays visible in Sources, in the Archived group.
  - **Every other zero** stays `EXTRACTED` with its stats.
- **Downstream:** Connect, Place, Verify, the catch-up route's create rule and Extract's rerun guard all treat an `ARCHIVED` source with recorded stats as finished with no notes, as they treat "extracted, 0 notes" today.

### 3. A claim found in two sources (convergence)

- **When a verdict counts:** drafting may name an existing note instead of writing one. The verdict is accepted only if all three hold; otherwise the claim goes back into the drafting round and is written as a new note:
  - the note was among that candidate's vault matches with similarity ≥ 0.75;
  - the note is not archived;
  - the note has no incoming `SUPERSEDES`.
- **What is written:**
  - `POST relationships`: the existing note → the new source, `DERIVED_FROM`, confidence `grounded`. The reason reads: `Also argued in "<source title>" (<locus>): "<evidence>"`, capped at 900 characters.
  - `ADD_EXTRACTED_CLAIM` on the new source; it is idempotent.
  - The note's text is not touched.
- **Counts:**
  - `claimCount` = new notes + linked existing notes, so it now means "claims this source makes".
  - The source model refuses stats whose `claimCount` differs from the claim list's length (`ExtractionStatsMismatchError`), and the claims must be added before the stats. Linked existing notes are therefore added to the list first; that's what keeps the count and the list equal.
  - `skipRate` keeps its formula.
  - The report and handoff say, for example, "12 new notes, 3 already in the vault (now also linked to this source)".
- **The extractor's mark:** `extractedBy` = `extract-claims 2 · <model>`. Previously it was `extract-claims · <model>`.
- **Notes this source created:** a note on the source's list that also has `DERIVED_FROM` to a different source is left out of Connect and Place (their shared `sourceNotes` helper) and out of Verify (its own read). It was linked, placed and checked when it was first written.
- **The catch-up route** already treats every note derived from a source as one of its claims, so it agrees with this list without changes.

### 4. Re-running the 48 sources, once

- **Where:** the desktop app's queue watchdog. Its start-up rule `planSourceRepairs` gains one case: a source to **reopen and queue** when it:
  - is `EXTRACTED`;
  - has no claims;
  - has recorded stats whose `extractedBy` starts with `extract-claims · ` (the old mark);
  - has no live note derived from it.
- **Actions:** `SET_SOURCE_STATUS → EXTRACTING`, then `ADD_TASK` (a `claim` task with a fresh id), unless an open task for the source exists.
- **Never picked:**
  - anything the new extractor processed (its mark differs);
  - archived sources;
  - sources extracted by other tools, such as the Claude Code plugin's `knowledge-agent`.
- **Order:** the repairs run first, then the vault's catch-up, as today. A reopened source with no notes is not proven extracted, so its task waits at `create` and the pipeline processes it.
- **The log** says how many sources were re-queued.
- **Other users' vaults** get the same one-time catch-up when they update. Connect needs nothing for this.

### 5. Testing and measuring

- **The piece:**
  - window cutting and size choice: local, hosted, a known context, the override, and halving after a failure;
  - the active-model check before each window, and the resend after a timeout that follows a switch;
  - the prompt: the gate list and the two sentences;
  - the empty-answer retry and archiving;
  - convergence: the floor, liveness, the link and its reason, the source's list and count, and Connect, Place and Verify skipping notes from another source;
  - an archived source passing through every step and the catch-up.
- **The app:**
  - `GET /llm/v1/active`;
  - `planSourceRepairs` picking exactly the old-mark empty sources, and only once.
- **Regressions:** every existing suite stays green. Reducer coverage is unaffected because no model changes.
- **Live measurement:**
  - The app is switched to the local model first; it is set to ChatGPT at the time of writing.
  - The new version of the app starts, and the 48 run through the real pipeline.
  - Report per source: notes before and after, archived or honest zero, and time. Spot-check the new notes and the convergence links.

## What changes, by file

- **`bai-knowledge-note`:**
  - `pieces/knowledge-vault/lib/agent/staged.ts`: windows, prompt, empty answers, `source_kind`, draft batching, convergence verdicts, report.
  - `lib/agent/extract.ts`: the gate list.
  - `lib/agent/llm.ts`: the active model, per-call timeouts, the resend after a switch.
  - `lib/agent/write.ts`: convergence writes, counts, archiving, the new mark.
  - `lib/actions/extract-claims.ts`: the Window size prop, orchestration, the archived pass-through.
  - `lib/agent/connect.ts`, `lib/agent/verify.ts`: notes this source created; archived sources.
  - `subgraphs/http/lib/reconcile.ts`: an archived source with stats counts as extracted.
  - `docs/design/source-editor/README.md`: the source header's note count now includes linked existing notes. The 2026-09-17 migration record stays as written, since it is history.
- **`knowledge-vault-app`:**
  - `sidecar/src/gateway/gateway.ts`: `GET /llm/v1/active`.
  - `sidecar/src/queue-watchdog.ts`: the one-time rule.
  - The vault package version in `sidecar/package.json`, `host/package.json` and `bun.lock`.

## Rollout

1. Build and test the piece. Publish a dev version of `@powerhousedao/knowledge-note` (`bun run build`, `ph publish --tag dev`), as with 1.0.54-dev.33. Publishing needs your registry login.
2. Move the app to that version, with the gateway and watchdog changes, and test.
3. Switch the app to the local model, then restart it. The watchdog re-queues the 48, and the pipeline processes them in the background.
4. Measure and report as in §5.

## Risks

- **More notes to review.** If the probe's yield holds across the 48, expect a few hundred, on top of the 249 waiting.
- **Time.** On the local model, a window costs roughly 10–60 s to find candidates plus up to a minute or two to draft. The 48 (median 3,000 characters; 12 over 5,000; the largest 40,000) should take a few hours in the background.
- **Wrong convergence links.** Guarded by the 0.75 floor and the liveness checks. Every link carries its reason and stays visible on the note.
- **Hosted models see the prompt changes too.** They share the prompt. Removing `out_of_scope` is the fix for ChatGPT's rejections, and the unit tests cover both kinds of model.
