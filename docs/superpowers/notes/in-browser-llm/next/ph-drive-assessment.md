# ph-drive as a target for the in-browser NL → document-action chat

Source read: local checkout `<local ph-drive checkout>` (read-only). No clone was made: local HEAD `f18c98d` equals `origin` HEAD (`git ls-remote`). The repo is PUBLIC, with 4 commits, all dated 2026-06-24. Latest upstream `@powerhousedao/reactor-drive` (6.2.3-dev.78) was unpacked to `scratchpad/rd/` for comparison.

## 1. What it is

- **Purpose.** A Google-Drive-style two-way file sync. A Connect editor shows a folder/file UI with drag-drop upload. A standalone Node `file-watcher/` (chokidar, 3-way reconcile, graphql-ws subscription) mirrors the drive to a local directory through one Switchboard and its attachment store.
- **Custom document models: 1.** `phdrive/file` (`document-models/ph-drive-file/ph-drive-file.json`, spec copy in `specs/phdrive-file.json`).
  - It has 1 module (`content`) and 1 op, `SET_FILE_CONTENT` (global), with input `{content: String!, mimeType: String!, size: Int!, sha256: String!, parentFolder: String}`.
  - State is 5 nullable fields.
  - It declares 0 errors and 0 examples. The op has a description.
  - The reducer (`v1/src/reducers/content.ts`) copies the inputs.
- **Drive model (not in this repo).** It is `powerhouse/reactor-drive` from `@powerhousedao/reactor-drive` (6.2.0-dev.29 installed). Its spec has 7 ops:
  - `SET_DRIVE_NAME` and `SET_DRIVE_ICON` (global);
  - `SET_SHARING_TYPE` and `SET_AVAILABLE_OFFLINE` (local);
  - `ADD_FOLDER`, `UPDATE_FOLDER` and `REMOVE_FOLDER` (**scope `document`**). Their reducer is `return state`; the folder tree exists only in a read-model projection (`drive_node` table).
  - All 7 descriptions are `""`. There is no zod, no barrel and no errors. The spec is identical in 6.2.3-dev.78.
- **File lifecycle is not spec ops.** See `lib/drive-client.ts`:
  - create = `createEmptyDocument` + `SET_FILE_CONTENT` + `renameDocument` + `ADD_RELATIONSHIP` (`drive/child`, document scope);
  - rename = the `renameDocument` mutation;
  - delete = `REMOVE_RELATIONSHIP` + the `deleteDocument` mutation;
  - there is **no move-file**, and `parentFolder` is duplicated in file state and in the relationship metadata.
- **Op total: 8 spec ops (1 + 7).** About 8–10 user intents. The knowledge vault has 99 ops in 12 models.
- **Editor.** `editors/ph-drive-explorer/` (536-line `editor.tsx`) targets `powerhouse/reactor-drive` and is used as a drive app via `preferredEditor`.
  - It **bypasses reactor-browser**: it uses `fetch` to `/graphql/r`, keeps the Switchboard and drive URLs in localStorage, and has no hooks and no `DocumentToolbar`.
  - The UI offers upload, new folder (`window.prompt`) and delete only. It has no rename or move.
  - `powerhouse.manifest.json` lists the editor for `["phdrive/file"]`, which contradicts `module.ts` (`["powerhouse/reactor-drive"]`). `apps: []`.
- **Stack.**
  - ph-cli, connect, reactor, reactor-browser and document-model are 6.2.0-dev.32; reactor-api, attachments and drive are 6.2.0-dev.29.
  - `pnpm-workspace.yaml` links Connect and reactor-browser from `/Users/benjaminjordan/projects/powerhouse/powerhouse-feature-0` (6.2.0-dev.37), a patched checkout for reactor-drive support.
- **How it runs.** Four processes: `pnpm reactor` (:4001), `pnpm create-drive`, `pnpm connect --default-drives-url …` (:3000) and `pnpm watch` (:4111). It is Chrome-only. There is no Vetra flow.
- **Build and test.** I did not run `ph-cli build`.
  - `tsc --noEmit` gives **1 error** in `processors/factory.ts`. It is the type-only clash between two copies of `@powerhousedao/shared`, and the README already mentions it.
  - `vitest`: 1 suite failed and 1 passed. `v1/tests/document-model.test.ts` expects a ZodError for invalid state, but every field is nullable, so none is thrown.
- **AI/MCP.** There is only `.mcp.json` (reactor-mcp at `localhost:4001/mcp`) and the template `CLAUDE.md`/`AGENTS.md`. The app code has none.

## 2. Fit as a demo

- **The English is natural, and the set is tiny.** Typical requests: "make a folder called Invoices", "rename Drafts to Archive", "move Q3 into Reports", "delete the old folder", "rename the drive", "make it available offline", "share it publicly".
- **Most of it is refs.** `ADD_FOLDER` has a parent ref plus a free-text name. `UPDATE_FOLDER` (rename or move) has 1–2 refs. `REMOVE_FOLDER` has 1 ref. File rename and delete would have refs too.
- **Free text** appears only in names. There are no enums (`sharingType` is a free `String` defaulting to `"private"`), no dates and no cross-document PHIDs.
- **The one custom op is not chat-addressable.** Every `SET_FILE_CONTENT` argument is machine-derived (attachment ref, sha256, size).
- **Almost everything is drive-level.** ph-drive is effectively a drive-ops demo. Compare the vault: 51 ref ops, 13 vocabularies, date ops, lifecycles and 99 ops.
- **It exercises little of what the LoRA and Kev were trained on.** Kev's 8-way choice collapses to about 8 options in total.

## 3. Derivable vs hand-written (per GENERIC-VS-SPECIFIC.md)

- **D-auto, in principle:** op names, the field list from the input SDL, and the ref flag (`folderId` and `parentFolderId` match `/Id$/`).
- **Not D in practice:**
  - **zod.** `buildCatalog` needs `<Op>InputSchema` from a barrel (`op-catalog.ts:369` throws otherwise), and reactor-drive has none. It needs a hand-written barrel or shim.
  - **Descriptions:** 7 of 8 are empty and live in an upstream package, so they cannot be fixed via MCP here. They would have to be hand-written in `OP_DESCRIPTIONS`.
  - **Ref targets:** 0 of 3 are derivable. The reducers are no-ops and the targets are in the read model, not document state. `REF_EXTRACTORS`, `replay.ts`, fixture derivation and `ref-scenarios.ts` have nothing to replay. Candidates would have to come from `DriveGql.listTree()` or reactor-browser drive nodes.
  - **Ids:** `folderId` is `String!`, not `OID`. On `ADD_FOLDER` it is a new id, which needs a `DEFAULT_FIELD_OVERRIDES` entry.
  - **Errors:** there are none, so replay validation cannot reject bad states.
- **Wholly hand-written:**
  - file rename, delete and move intents, which are synthetic ops backed by mutations;
  - ref pools of folder and file names;
  - seed drive trees;
  - dev and blind eval sets.

## 4. Gaps and risks

1. **Executor mismatch (the main blocker).** `ChatView` dispatches `entry.creator(input)` through `dispatchActions(action, doc.id)`. It is untested whether reactor-browser accepts the document-scope `ADD_FOLDER`/`UPDATE_FOLDER`/`REMOVE_FOLDER`. File intents need GraphQL mutations, not actions. A chat tab needs a pluggable "intent executor", or a DriveGql-backed one.
2. **The chat's target document becomes the drive itself,** and refs resolve against an off-document tree.
3. **Versions.**
   - ph-drive is on 6.2.0-dev.29/32 with a linked feature checkout.
   - Our `explore/in-browser-llm` and `main` `package.json` say **6.2.2-dev.47**, not 6.2.3-dev.7x as briefed. npm `dev` is 6.2.3-dev.78.
   - Our 6.2.2-dev.47 reactor-browser already ships `DRIVE_DOCUMENT_TYPES = [document-drive, reactor-drive]`, so the linked checkout is probably obsolete. This is unverified: I did not run it. The README's second patch (preserving `header.meta` in the reactor's `document-view.ts`) also needs checking.
4. **Wiring.** The editor is not built on reactor-browser, and Connect needs the reactor-drive drive-app path. Porting the vendored wllama and chat core means either adding reactor-browser hooks to the editor or running the chat in a separate tab against GraphQL.
5. **Hygiene.** There is a manifest/module docType mismatch, the tsc error, the failing suite, no `DocumentToolbar`, and an AGPL licence.

**Verdict.** The phrasing is pleasantly natural, but structurally ph-drive is the worst case for the current pipeline. Its ops are system-scope, its ref targets live off the document, three intents are not document-model ops at all, and it has no zod or descriptions. It works as a drive-level NL demo only after chat-core gains a pluggable catalog and executor, plus about 8 hand-written intent specs. It would not test the trained LoRA/Kev pipeline in a meaningful way.
