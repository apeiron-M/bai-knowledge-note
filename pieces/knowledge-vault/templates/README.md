# Pipeline template

`pipeline.json` is the *Vault pipeline (auto)* workflow and its Knowledge Vault connection, exported as a
**replayable operation list**: the two documents' own operations, in order, with every environment-specific
value replaced by a placeholder. The desktop app instantiates it per vault — it creates a fresh
`powerhouse/connection` and `powerhouse/workflow` in its Workflows drive and replays the operations through the
reactor's `execute` mutation with the placeholders filled. The template is versioned with the piece, so the
two cannot drift.

Placeholders: `{{DRIVE_ID}}` (the vault drive), `{{CONNECTION_ID}}` (the connection document the instantiator
just created), `{{SWITCHBOARD_ORIGIN}}` (the engine, origin only), `{{TOKEN_SECRET_REF}}` and
`{{LLM_SECRET_REF}}` (workflow-runtime secrets — `secret://…` refs from `createSecret`), `{{LLM_BASE_URL}}` and
`{{LLM_MODEL}}` (the model settings), `{{PIECE_VERSION}}` (the installed piece), `{{WORKFLOW_NAME}}`,
`{{CONNECTION_NAME}}`, `{{NOW}}` (an ISO timestamp for `publishedAt`). `{{trigger.payload.…}}` expressions are
the workflow runtime's own and are left untouched.

Dropped on export: `CREATE_DOCUMENT` and `UPGRADE_DOCUMENT` (the instantiator's fresh document has its own),
`SET_LAST_TEST`, `RECORD_CHECK_RESULT` and `SET_ACCOUNT_LABEL` (runtime history), rejected operations, and all
but the final `SET_WORKFLOW_STATUS`. The connection's `SET_CONFIG` gains `llm_base_url`, which the hosted
connection leaves at the piece's default.

Re-export after changing the workflow (read-only; the token comes from the CLI profile):

```bash
node scripts/export-workflow-template.mjs --profile remote-powerhouse-knowledge \
  --workflow D08x67E0Nsojko6uUQlqszFjyiBwaUKdUbSTczDT1Jk --connection w7URVnjZgl-msYAd3DgQxJDf8dpCy_Iah3XlwoJGZrQ
```

One step was added by hand after the last export: **Check vault health** (`check-health`, *When: after the
last queued source*), after *Verify notes*, which rewrites the vault's health report once a batch is through.
A re-export from a live workflow must include it: add the step to that workflow first.

The script refuses to write a template in which a concrete value survived. Importable from the package as
`@powerhousedao/knowledge-note/pieces/knowledge-vault/templates/pipeline.json` (copied into `dist/` by
`scripts/copy-runtime-assets.mjs`).

# Reweave template

`reweave.json` is the *Reweave notes* workflow, written by hand in the same replayable format (no live
workflow to export it from): the **Unwoven notes** trigger, polling every 5 minutes, into one **Reweave
notes** step, then **Check vault health** (when the queue is idle, and only when the vault's health changed),
since reweaving rewrites older notes. It has no connection of its own — the desktop app instantiates it per vault with the vault
pipeline's connection (`{{CONNECTION_ID}}`), so it runs on the same model and key.

The pipeline runs each source once. A note extracted before its neighbours existed (the first section of a
long report, connected while the vault held nothing like it) or one a run cut off between its steps left
behind stays alone; this workflow gives such notes a second pass. While the pipeline is idle, the trigger
picks up to 6 notes the graph has as orphans — in no Map of Content, linked from nothing — at least 10 minutes
old, oldest first; the step links each one with fewer than 2 links to its semantic neighbours today, places
each one no MoC holds (a new TOPIC MoC only when three or more share a theme), and catches up any pipeline
task their source left open. A note is tried again only an hour later and once the vault holds 5 more notes,
at most 3 times. "Also notes with no links" on the trigger widens it to notes in a MoC with no links of their
own.

Policy: `QUEUE` (one run at a time; nothing is dropped), no deadline, `NOTIFY` on failure. Placeholders:
`{{DRIVE_ID}}`, `{{CONNECTION_ID}}`, `{{LLM_MODEL}}` (left empty in the step so the connection's model
applies), `{{PIECE_VERSION}}`, `{{WORKFLOW_NAME}}`, `{{NOW}}`. On a hosted vault, build the same two blocks
in Workflow Studio: trigger *Unwoven notes*, step *Reweave notes* with Note ids
`{{trigger.payload.note_ids}}` and Mode *Write*.
