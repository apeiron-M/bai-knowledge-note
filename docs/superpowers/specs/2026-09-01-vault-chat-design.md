# Chat with the Knowledge Vault — Design

**Status:** approved design, not yet implemented
**Date:** 2026-09-01
**Scope:** a browser-only, read-only AI chat inside the knowledge-vault drive app

## Goal

Let a user ask the vault questions in natural language and get answers grounded
in its own notes, with citations that open the real documents.

The existing search field answers "which notes match these words". It cannot
answer "what do we believe about X, and what contradicts it" — that needs
several searches, a few link traversals, and a synthesis. Today the only thing
that can do that is the Claude plugin, which requires a terminal. This feature
puts the same capability in the app, driven by a model the user connects
themselves.

## Non-goals

- **No writes.** The chat cannot create, edit, or delete anything. Enforced
  structurally: the tool executor is a fixed switch over read-only queries, so
  neither `knowledgeGraphReindex` nor `knowledgeGraphUpsertEmbedding` is
  reachable.
- **No server-side component.** No proxy, no backend, no key on any Powerhouse
  host. The browser talks to OpenRouter and to Switchboard directly.
- **No new document model.** Chat history is browser-local. A document model
  would sync to Switchboard, which contradicts the requirement.
- **No sources indexing and no embedding chunking.** Sources stay out of the
  graph index; the chat reads them through the reactor API instead (see
  "Reading arbitrary documents").
- **No provider beyond OpenRouter in v1.** See "Why OpenRouter".

## Verified constraints

Everything below was checked against live endpoints on 2026-09-01, not inferred
from documentation.

| Fact | Evidence |
|---|---|
| Browser may call OpenRouter directly | `access-control-allow-origin: *` on `/api/v1/auth/keys` and `/api/v1/chat/completions`; `Authorization` present in `access-control-allow-headers` |
| Tool calling is broadly available | 353 of 419 catalog models list `tools` in `supported_parameters` |
| Switchboard is browser-reachable | `access-control-allow-origin: *` on `/graphql` and `/graphql/knowledgeGraph` |
| Search is fast enough to be interactive | `knowledgeGraphSemanticSearch` returns in ~0.42s on the local vault (521 nodes, 2,211 edges) |
| No new dependencies are required | `fetch`, `crypto.subtle` (PKCE S256), `TextDecoder` (SSE) are native |

`crypto.subtle` requires a secure context. Production Connect is HTTPS and dev
is `localhost`, so both qualify.

### Forward dependency on Switchboard auth

Switchboard currently returns `Access-Control-Allow-Headers: content-type`.
When authentication is added, `authorization` **must** be added to that list or
every browser query fails preflight — including the ones this feature depends
on, and the existing search field.

## Prerequisite: markdown link sanitization

Both markdown renderers interpolate an unvalidated href into HTML that is then
passed to `dangerouslySetInnerHTML`:

```ts
out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a class="md-link" href="$2">$1</a>');
```

- `editors/shared/markdown-preview.tsx:210` (render at `:247`)
- `editors/knowledge-note-editor/components/markdown-preview.tsx:120` (render at `:152`)

Today this is a latent bug. This feature turns it into an exploit chain: note
content is attacker-influenceable, the model quotes note content, chat renders
model output as markdown, and a `javascript:` URL executes in the vault's
origin — where the OpenRouter API key is stored. One poisoned note could
exfiltrate the user's key.

**Fix before anything else:** allow only `http:`, `https:`, `mailto:`, and
relative URLs; drop the `href` otherwise. Applies to both files. Ships with
tests that fail before the fix.

This does not make prompt injection impossible — a note can still mislead the
model into a wrong answer. It makes injection unable to *execute*, which is the
part that matters. Wrong answers are visible and correctable; a stolen key is
neither.

## Why OpenRouter

Investigated per-provider OAuth for Gemini, Grok, OpenAI, Kimi, Qwen and
DeepSeek. Where OAuth exists at all it is built for CLI coding agents redeeming
a consumer subscription, not for browser apps:

| Provider | Browser OAuth yielding a user-billed key |
|---|---|
| OpenRouter | Yes — PKCE, no backend, no client secret |
| Gemini | No — Vertex OAuth bills the developer's GCP project, not the user |
| Grok | No — SuperGrok OAuth targets CLI/agent harnesses |
| Kimi | Partial — RFC 8628 device grant, designed for terminals |
| Qwen | No — free OAuth tier discontinued April 2026 |
| DeepSeek | No — API key only |
| OpenAI | No — no flow mints a user-billed key |
| Anthropic | Prohibited for third-party apps by policy |

OpenRouter is therefore the only browser-native OAuth that reaches all the
named models, and it reaches them through one flow instead of six.

A **bring-your-own-key** field is offered alongside OAuth for users who already
hold a key or want direct provider billing.

## Architecture

All browser-side. Follows the existing `graphqlFetch` idiom in
`editors/knowledge-vault/hooks/use-graph-search.ts`: plain `fetch`, no client
library.

```
editors/shared/
  document-state.ts        fetchDocumentState(id) — extracted from use-reactor-docs
  markdown-preview.tsx     (modified: href allow-list)

editors/knowledge-vault/lib/chat/
  openrouter-auth.ts       PKCE begin/complete; key storage
  openrouter-client.ts     streamChat(): SSE parsing + tool_call accumulation
  vault-tools.ts           tool schemas + read-only executor
  chat-storage.ts          thread persistence, drive-scoped
  system-prompt.ts         harness text + vault orientation

editors/knowledge-vault/hooks/
  use-chat.ts              the agent loop
  use-openrouter.ts        connection state, model catalog
  use-vault-name.ts        extracted from VaultSidebar

editors/knowledge-vault/components/
  ChatView.tsx
  chat/ChatComposer.tsx  chat/ChatMessage.tsx  chat/ChatToolTrail.tsx
  chat/ChatCitation.tsx  chat/ChatConnectPanel.tsx  chat/ChatHistoryMenu.tsx
```

Each file has one job; none should need to know another's internals beyond its
exported signature.

### Two endpoints, both already resolved

`editors/shared/subgraph-endpoint.ts` provides both, derived from
`window.location.hostname`:

- `resolveKnowledgeGraphEndpoint()` → `<origin>/graphql/knowledgeGraph` — the
  seven graph tools.
- `resolveReactorEndpoint()` → `<origin>/graphql` — the two document tools.

### Reusing the document read path

`fetchDocOutcome` in `editors/knowledge-vault/hooks/use-reactor-docs.ts:86-119`
already issues exactly the query the chat needs:

```graphql
query DocState($id: String!) {
  document(identifier: $id) { document { id name documentType state } }
}
```

The transport moves to `editors/shared/document-state.ts` as a plain
`fetchDocumentState(id)`. The existing hook keeps its caching and calls the
extracted function. The chat calls it directly. One query path, so the two
cannot drift.

## The agent loop

1. Build messages: system prompt + thread history + user turn.
2. `POST /api/v1/chat/completions` with `stream: true`, `tools`, `tool_choice: "auto"`.
3. Parse SSE. Text deltas stream to the UI immediately. `tool_calls` deltas
   accumulate by index — arguments arrive as JSON string fragments across
   frames and must be concatenated before parsing.
4. On `finish_reason: "tool_calls"`: execute each call locally against
   Switchboard, append one `{role: "tool", tool_call_id, content}` per call,
   return to step 2.
5. On `finish_reason: "stop"`: done.

**Iteration cap: 6 rounds.** On exhaustion the loop makes one final call with
`tool_choice: "none"`, forcing an answer from what was gathered. An uncapped
loop on a paid API is a runaway cost bug.

A `stop` control aborts the in-flight fetch and leaves the partial answer.

## Tool surface

Nine read-only tools. Every argument is validated client-side before dispatch.

### Graph tools (`/graphql/knowledgeGraph`)

| Tool | Backing query | Projection and caps |
|---|---|---|
| `search_vault(query, limit=8)` | `knowledgeGraphSemanticSearch` mode HYBRID | id, title, description, noteType, status, similarity, matchedBy. No `content`, no `topics`. limit capped 20 |
| `read_note(documentId)` | `knowledgeGraphNodeByDocumentId` | Full node incl. content, truncated to 6,000 chars; `topics` included (single node = one extra query) |
| `list_topics(limit=40)` | `knowledgeGraphTopics` | Sorted by count, sliced client-side |
| `notes_by_topic(topic, limit=25)` | `knowledgeGraphByTopic` | `content` projected away; sliced client-side |
| `related_notes(documentId, limit=8)` | `knowledgeGraphSimilar` | Semantic neighbours; `content` projected away |
| `linked_notes(documentId)` | `knowledgeGraphForwardLinks` + `knowledgeGraphBacklinks` | Both directions, 15 each |
| `vault_stats()` | `knowledgeGraphStats` + `knowledgeGraphDensity` | Counts only |

### Document tools (`/graphql`)

| Tool | Backing query | Behaviour |
|---|---|---|
| `list_documents(documentType, limit=50)` | `findDocuments(search:{type}, paging:{limit})` | Returns id, name, documentType. `documentType` is validated against the enum below |
| `read_document(documentId, offset=0)` | `fetchDocumentState` | Metadata plus an 8,000-char window of the primary text field, with `totalChars`, `offset`, `hasMore` |

#### `documentType` enum

Validated client-side; an unknown value is rejected before any request. Taken
from `powerhouse.manifest.json`:

`bai/source`, `bai/knowledge-note`, `bai/moc`, `bai/tension`,
`bai/observation`, `bai/research-claim`, `bai/derivation`, `bai/project`,
`bai/wbs`, `bai/health-report`, `bai/pipeline-queue`, `bai/vault-config`

In practice `bai/source` is the one that matters, because it is the only
substantial body of text the graph tools cannot reach. The rest are included
because they cost nothing extra and make questions like "what is this vault
configured to do" answerable.

#### Primary text field resolution

Document models name their body differently, so `read_document` picks the
first present, non-empty field of `state.global` in this order:

`content` → `orientation` → `description`

That covers `bai/source` and `bai/knowledge-note` (`content`), `bai/moc`
(`orientation`, which is what the indexer also treats as MoC body), and
degrades to `description` for models with no long-form field. The window is
applied to that field only; all other scalar fields of `state.global` are
returned whole as metadata, since they are small. Arrays are returned as
counts plus their first 20 entries, so a source's `extractedClaims` stays
traversable without a 500-element dump.

### Why these projections

Measured against the local vault:

- A `search_vault` result set of 8 hits costs **794 tokens** projected, versus
  **2,579 tokens** with `content` and `topics` included — 3.2x for data the
  model usually does not need.
- `KnowledgeGraphNode.topics` is a per-node field resolver: selecting it on an
  N-row result issues N extra queries. It is therefore never selected on a
  list, only on a single-node read.
- `knowledgeGraphTopics` has no server-side limit and returns all 613 topics
  (**5,826 tokens**). `list_topics` slices to 40 (~420 tokens).
- A full source is 25,780 chars — **6,997 tokens** in one read. Hence paging in
  `read_document`.

### Deliberately excluded

- `knowledgeGraphBridges` — O(V·(V+E)) with no limit.
- `knowledgeGraphNodes`, `knowledgeGraphDebug` — dump every node body.
- `knowledgeGraphConnections` — superseded by `linked_notes`, which uses the
  raw edge queries: cheaper (no per-node lookups), and bidirectional.
- Both mutations — read-only.

### Known limitation: note → source is not available

The graph indexes only `bai/knowledge-note` and `bai/moc`
(`processors/graph-indexer/factory.ts:69-78`). The local vault contains **zero
`DERIVED_FROM` edges**: measured edge types are `RELATES_TO` 1,520,
`CORE_IDEA` 415, `BUILDS_ON` 237, `CHILD_MOC` 37, `CONTRADICTS` 2.

The source→note relationship lives inside source state as `extractedClaims[]`,
not as an edge. So the chat can traverse **source → its notes** (read the
source, follow `extractedClaims`) but **not note → its source**. Building the
reverse index would require reading all sources on every lookup.

The system prompt states this limitation so the model does not claim a
provenance link it cannot verify.

## Authentication

### OAuth PKCE

1. Generate a 64-byte random `code_verifier`; `code_challenge =
   base64url(SHA-256(verifier))` via `crypto.subtle`.
2. Store the verifier in `sessionStorage` (single-use, tab-scoped).
3. Redirect to
   `https://openrouter.ai/auth?callback_url=<current-url>&code_challenge=<c>&code_challenge_method=S256`.
4. On return, read `?code=`, `POST https://openrouter.ai/api/v1/auth/keys` with
   `{code, code_verifier, code_challenge_method: "S256"}`, receive `{key}`.
5. Store the key; strip `code` from the URL with `history.replaceState` so a
   reload cannot replay a spent code.

Codes are single-use and expire after 10 minutes. `S256` is used, never
`plain`.

#### Surviving the redirect

The flow leaves the page, so the app remounts on return. Two pieces of state
must survive or the user comes back to a broken-feeling app:

- **The view.** `viewMode` is component state (`DriveExplorer.tsx:38`) and no
  vault code touches `window.location`, so the default `"search"` view would
  render on return — connected, but with the chat gone.
- **The draft.** Whatever the user had typed in the composer.

Before redirecting, write `bai-chat:oauth-return:v1` to `sessionStorage`
holding `{driveId, draft}`. On mount, `DriveExplorer` checks for the key; if
present and the drive matches, it sets `viewMode` to `"chat"` and clears the
key. `ChatView` restores the draft into the composer.

`sessionStorage` (not `localStorage`) is correct here: the intent is scoped to
this tab and this navigation, and must not resurrect in a tab opened next week.

The key is cleared before the token exchange runs, so a failed exchange still
lands the user in the chat view with an error rather than looping.

### Bring your own key

A text field accepting an OpenRouter key directly, validated with a
`GET /api/v1/key` probe before being stored.

### Storage and its honest risk

The key lives in `localStorage` under `bai-chat-credentials:v1`. This is
same-origin-readable, so any XSS in Connect can steal it — which is why the
markdown fix is a prerequisite rather than a follow-up.

`sessionStorage` was considered and rejected: it would force re-authentication
on every tab, and it is equally XSS-readable, so it trades real usability for
no security gain. The mitigations that do work are the href allow-list, never
rendering model output as raw HTML, and a visible **Disconnect** that deletes
the key.

## Chat history

Browser-only, drive-scoped, following the existing
`bai-graph-snapshot:v1:<driveId>` convention.

- Key: `bai-chat:v1:<driveId>`.
- Up to **20 threads**, most-recent-first, older ones dropped.
- Reachable through a **Recent** popover in the chat header, using the same
  click-catcher idiom as `CreateMenu` / `SettingsMenu`.
- Persisted per message: role, text, and citation stubs (`documentId`, `title`).
- **Not persisted:** raw tool payloads. Re-running a search costs ~0.42s, while
  storing full note bodies would exhaust the ~5MB budget within a few
  conversations.
- On quota exhaustion: drop oldest threads, then fail soft to in-memory only.

## Model selection

Fetched live from `GET https://openrouter.ai/api/v1/models`, filtered to those
listing `tools` in `supported_parameters` (353 of 419 today), presented as a
searchable dropdown showing name, context length, and prompt/completion price.

The catalog changes weekly, so it is never hardcoded. The stored preference is
the model id string; if it disappears from the catalog the picker falls back to
the default and says so.

## Interface

Gemini's shape, as briefed: a centered greeting over a large pill composer with
suggestion chips; on first send the greeting lifts away, the transcript takes
the column, and the composer docks to the bottom.

Greeting: **"Ask <vault name> anything"**, resolved through the same precedence
`VaultSidebar.tsx:108-151` already uses — `bai/vault-config` name, then drive
name, then "Knowledge Vault". Extracted to `use-vault-name.ts` so the two
cannot diverge.

Three details keep it specific to this vault rather than a generic chat clone:

1. **Suggestion chips are built from the vault's real top topics**, so the
   empty state is a portrait of this vault instead of stock prompts.
2. **Progress is a reading trail, not a spinner.** Each tool call appears as a
   compact row — `searched "audit trails" → 8 notes`, `read "Event sourcing
   guarantees…"` — expandable to the hits, reusing SearchView's existing
   similarity buckets (≥0.7 green, ≥0.45 amber, else grey) so a result looks
   the same in chat as in search.
3. **Citations are live doors**, calling `setSelectedNode(documentId)` to open
   the actual note.

The trail is the one deliberately prominent element; everything else stays
quiet and matches the house style.

### Empty, error and disconnected states

- **Not connected:** the composer is replaced by a connect panel explaining
  what connecting does, that the vault is never written to, and that the key
  stays in this browser.
- **Connected, no messages:** greeting, composer, topic chips.
- **Tool failure:** the trail row shows the failure and the loop continues; a
  failed search is not a failed conversation.
- **Stream failure:** the partial answer is kept, with a Retry control.
- **Rate limit / 402:** surfaced verbatim from OpenRouter, since only the user
  can resolve billing.

### Wiring

Three edits to `editors/knowledge-vault/components/DriveExplorer.tsx`:
add `| "chat"` to the `ViewMode` union (`:26-35`), add a `TABS` entry (`:136`),
and add a branch to the content switch (`:316-338`) **before** the final
`NoteList` fallthrough — that switch has no default guard, so a missing branch
silently renders the Notes list.

## Testing

Vitest, following `editors/knowledge-vault/lib/boot.test.ts`.

| Unit | Cases |
|---|---|
| `markdown-preview` | `javascript:`, `data:`, `vbscript:` dropped; http/https/mailto/relative preserved. **Written first, must fail before the fix** |
| `openrouter-auth` | verifier/challenge round-trip against a known SHA-256 vector; code stripped from URL; spent verifier cleared |
| oauth return | return intent restores the chat view and the draft; intent cleared after use; intent for a different drive is ignored |
| `openrouter-client` | SSE frames split mid-JSON; tool-call arguments accumulated across deltas; `[DONE]` handling; comment payloads ignored |
| `vault-tools` | each tool's projection and cap against a stubbed fetch; unknown tool name rejected; no mutation reachable |
| `chat-storage` | 20-thread cap evicts oldest; drive scoping; quota exhaustion degrades to memory |
| `use-chat` | tool round-trip advances the loop; 6-iteration cap forces a final answer; abort keeps partial text |
| `use-openrouter` | catalog filtered to tool-capable models; stored model missing from catalog falls back to default and reports it |
| `system-prompt` | vault orientation injected with real stats and topics; note-to-source limitation stated |

Manual verification against the local vault (`ph vetra`, drive
`1d7fab7d-166c-4b55-ba8b-c1a66321b4ed`): connect via OAuth, ask a question
requiring two searches and a link traversal, confirm citations open the right
notes, reload and confirm history survives, disconnect and confirm the key is
gone.

## Rollout

1. Markdown href allow-list (independently shippable security fix).
2. `fetchDocumentState` extraction, `use-vault-name` extraction.
3. Auth + client + tools, headless and unit-tested.
4. UI, wired into the view switch.
5. Manual pass against the local vault.

Steps 1 and 2 are safe to merge on their own; the chat is inert until step 4
adds the tab.
