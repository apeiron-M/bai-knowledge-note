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

The script refuses to write a template in which a concrete value survived. Importable from the package as
`@powerhousedao/knowledge-note/pieces/knowledge-vault/templates/pipeline.json` (copied into `dist/` by
`scripts/copy-runtime-assets.mjs`).
