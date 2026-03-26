# Team Knowledge Sync — Work Breakdown

**Model:** `bai/knowledge-note` v0.1
**Goal:** Migrate canonical vault from filesystem to Reactor, accessible via MCP from Claude sessions

---

## Phase 1: Document Model Implementation — DONE

- [x] Schema design via MCP (35 fields, 3 enums, 4 nested types)
- [x] 19 operations across 5 modules (content, provenance, linking, lifecycle, local)
- [x] 10 error types, 15 placements
- [x] Reducer implementation (5 files in `src/reducers/`)
- [x] Code generation (`ph-cli generate`)
- [x] Quality gate (tsc: 0 errors, lint: 0 errors)
- [x] Reviewer audit (1 blocker fixed: null provenance guard on APPROVE_NOTE)

## Phase 2: Vault Data Import — DONE

- [x] `powerhouse.manifest.json` populated
- [x] Import script (parses YAML frontmatter, content, topics, relevant notes)
- [x] 94/94 notes imported to local reactor (localhost:4001)
- [x] 13/13 cross-note links resolved with real document IDs
- [ ] **BLOCKED** — Import to remote reactor (runtime module not deployed)

## Phase 3: Package Deployment & MCP Access — ACTIVE

- [ ] **Option A: Publish npm package** — publish `knowledge-note` to npm, add to remote reactor's packages config. Proper production path, enables team-wide use.
- [ ] **Option B: Local MCP server** — run a second Reactor MCP pointing at localhost:4001. Faster for solo testing, temporary.
- [ ] Re-import 94 notes to target reactor (script ready, needs working endpoint)
- [ ] Drive organization — create `canonical-knowledge` and `inbox-apeiron` drives, assign documents
- [ ] CLAUDE.md migration — replace `/mnt/f/PowerhouseVault/knowledge/` with MCP connection config

> **Decision needed:** Do Option B now to validate, then Option A for production.

## Phase 4: v0.2 — Future

- [ ] Document editor (markdown editor, metadata sidebar, link manager, lifecycle toolbar)
- [ ] Subgraph (query notes by type, topic, status, author — enables health checks)
- [ ] Processor: auto-move on APPROVE (inbox → canonical drive)
- [ ] Session mining integration (wire `/extract`, `/seed` to MCP instead of filesystem)
- [ ] Obsidian local sync (reactor → filesystem → Obsidian reads .md files)

---

## Known Issues

| Issue | Severity | Workaround |
|-------|----------|------------|
| Codegen bug: `KnowledgeNote_Local_State` wrong type name in `gen/local/operations.ts` | Medium | Manual fix after each `pnpm run generate` |
| Drive rebuild error on local reactor after restart | Medium | Create standalone documents (no `parentIdentifier`) |
| `personalTags` in local state has no operations | Low | Remove or add ops in v0.2 |
| 13 old "unresolved" links alongside resolved ones | Low | Cleanup pass needed |
