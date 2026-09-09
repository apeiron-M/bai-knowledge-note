# Vault Authorization — Design (Plan A: Switchboard-level enforcement)

**Status:** DRAFT — for review. No implementation until approved.
**Date:** 2026-09-09
**Stack:** `@powerhousedao/*` 6.2.2-dev.85 (verified present)
**Scope:** authorization for the Powerhouse Knowledge Vault (`@powerhousedao/knowledge-note`)

---

## 1. Executive summary

Three findings reshape this work:

1. **Do not build an auth system.** The Powerhouse stack ships two complete ones. Every
   primitive we need is already in the `6.2.2-dev.85` we just installed.
2. **The vault is currently wide open** — read, write, delete, reindex, and
   semantic-search poisoning, all anonymous. This is not a hardening exercise; it is
   closing a door that has never been shut.
3. **The one thing we *must* build ourselves is our own subgraph's gate.** Our
   `knowledgeGraph*` API reads the graph-indexer's own Postgres tables, not the reactor,
   so it inherits none of the stack's enforcement. Turning on stack auth changes nothing
   for it.

**Plan A is the right call**, and it means: enforcement moves to the server, and the
client-side plugin hooks are demoted to what they actually are — developer ergonomics.

---

## 2. Current state: the anonymous capability surface

Evidence: `grep -rn "assertCanRead\|assertCanWrite\|ctx.user\|Authorization\|permission" subgraphs/ processors/`
returns **no matches**. No `AUTH_ENABLED`, `ADMINS`, `DEFAULT_PROTECTION` or
`DOCUMENT_PERMISSIONS_ENABLED` appears in `powerhouse.config.json`, `Dockerfile` or
`docker/*`. The deployed policy is therefore `OPEN`: *"every check passes for everyone,
including anonymous callers."*

`AGENT.md` states it plainly: **"A hosted vault needs no auth for reads."**

And `scripts/drive-sync/data/powerhouse-knowledge/auth.json` records that **all 1,467
documents carry `state.auth` version 0 — uninitialized.** Zero documents have any policy.

### What one person with the URL and `curl` can do today

| Capability | Path | Notes |
|---|---|---|
| Enumerate every drive | `/mcp` `getDrives()`, `DocumentDrive` queries | slugs are guessable; `resolveCanonicalDriveId` accepts them |
| Dump the whole graph incl. full note bodies | `knowledgeGraphNodes(driveId)` | `content` is never truncated server-side |
| Dump 4,718 edges with reasoning | `knowledgeGraphEdges` | 843 carry `reason` + `confidence` |
| Read the scope-of-work | `document(identifier)` on `/graphql/r` | envelope owners, **budgets, currency, spend, progress** |
| Read all 403 sources | `document(identifier)` | largest text volume; not graph-indexed |
| Harvest the audit log + a contributor address book | `knowledgeGraphActivity` / `History` | `inputJson` diffs, **real ETH addresses**, `signerApp`, `signature` |
| Semantic-search the vault | `knowledgeGraphSemanticSearch` | embeds server-side; no model needed |
| Read raw processor tables | `knowledgeGraphDebug` | `rawNodes`, `rawEdges`, namespace |
| Live-surveil every write | `ws://…/graphql/subscriptions` `documentChanges` | |
| Create documents of any of 12 types | `{Model} { createDocument }` | |
| Apply **arbitrary unvalidated actions** | `mutateDocument(actions: [JSONObject!]!)` | "JSONObject lets the resolver accept arbitrary actions without per-type validation" |
| Delete any document | `deleteDocument` on `/graphql/r` | |
| Induce the **server** to create documents | `addRelationship(a,b,"CONTRADICTS")` | graph-indexer's `automation.ts` then creates a `bai/tension` + `ADD_TENSION` on every affected MoC, using the host's own `IReactorClient` |
| Turn on indexing for an arbitrary drive | create one `bai/vault-config` | `factory.ts:22` treats its presence as the decision |
| DoS the reactor | `knowledgeGraphReindex` | ~63 s/call, DELETEs + rebuilds, and **CREATEs tables** in a namespace that has none |
| Permanently poison semantic search | `knowledgeGraphUpsertEmbedding` | arbitrary vector, stored with a hash that makes the staleness gate agree so it is never re-embedded |

### Signing does not help — it actively launders

An anonymous write is **not rejected**. The Switchboard signs it with **its own** identity
and stamps the user from **its own** `ph login` session. Per the plugin's own hook:
*"an unsigned agent write is attributed to whoever logged the server in — or to nobody."*
So anonymous writes are attributed to the operator. `signerApp` is a self-asserted env
var, so the labels are spoofable too.

**Signing is descriptive, not permissive.** It is provenance, not access control.

### The client-side hooks are not a control

`pre-write-identity.py`, `pre-link-articulation.py`, `pre-apply-lint.py` are bypassable
five independent ways: the documented `POWERHOUSE_KNOWLEDGE_ALLOW_UNSIGNED=1` escape
hatch; raw GraphQL (`matcher: "Bash"` only, and `classify()` requires the binary be
`switchboard`); fail-open when the hook itself errors; prefixing your own
`SWITCHBOARD_APP_NAME`; and the trust boundary — they run inside one cooperating agent's
process and cannot see the browser, the Python scripts, MCP, other agents, or anyone with
the URL.

Keep them. They are good ergonomics. Never rely on them.

---

## 3. What the stack already provides (three layers)

### Layer 1 — Perimeter (`reactor-api` middleware)

| Env | Effect |
|---|---|
| `AUTH_ENABLED=true` | selects `ADMIN_ONLY`, verifies bearer, populates `ctx.user` |
| `RESOLVE_CALLER_IDENTITY=true` | populates `ctx.user` while policy stays `OPEN` — **resolves identity, enforces nothing** |
| `REQUIRE_AUTHENTICATED_CALLER=true` | **401 to every anonymous GraphQL request before any resolver runs**; subgraphs, supergraph and SSE alike. Refuses to boot without one of the two above |

The `RESOLVE_CALLER_IDENTITY=true` + `AUTH_ENABLED` unset cell is documented as
*"the one a custom subgraph needs when it does its own authorization: its resolvers learn
who is calling without every non-admin being locked out."* **That is exactly our case.**

### Layer 2 — Host document permissions (`DOCUMENT_PERMISSIONS` policy)

The system `auth-editor` manages. Postgres tables `DocumentPermission`,
`OperationUserPermission`, `DocumentProtection`; migrations run at boot under
`DOCUMENT_PERMISSIONS_ENABLED=true`.

- Subjects: **lowercased Ethereum addresses** (not `did:key`), one flat namespace
- `READ` < `WRITE` < `ADMIN`, ranked 1/2/3 via `PERMISSION_RANK` + `satisfies()`
- **Allow-only. There is no DENY.**
- Grants **inherit down the document tree** (BFS, cycle-protected)
- `protected: Boolean` per document (default from `DEFAULT_PROTECTION`); protected if the
  document **or any ancestor** is. Unprotected ⇒ anyone, including anonymous, passes
- `ownerAddress` = implicit ADMIN, transferable
- `ADMINS` env = supreme admin, unconditional override everywhere
- Decision order: `supreme admin → unprotected (self or ancestor) → owner → inherited grant ≥ required`
- Per-operation grants are **allow-list-by-existence**: granting the *first* per-operation
  permission implicitly locks that operation for everyone else
- Server helpers available: `assertCanRead` / `assertCanWrite` / `assertCanCreate` /
  `assertCanExecuteOperation(s)`, `ForbiddenError`
- **No groups.** `createGroup`/`addUserToGroup`/`groupPermissions` do not exist in dev.85

### Layer 3 — Document auth scope (reactor ABAC, "auth-scope")

Policy lives **on the document**, in an `auth` scope, as an ordered grant list folded by
`applyAuthAction` — so it syncs, replays and converges like content. Verified exported
from `@powerhousedao/shared@6.2.2-dev.85`: `PHAuthState`, `Grant`, `Principal`,
`Capability`, `Condition`, `Operand`, `PHGroupState`, `applyAuthAction`,
`createAuthState`, `defaultAuthState`.

```typescript
type Grant = {
  id: string; description: string;
  effect: "allow" | "deny";
  principal: { anyone: true } | { address: string } | { group: string } | { match: Condition };
  capability: { can: "read"; scope?: string }
            | { can: "execute"; scope?: string; operation?: string[] };
  where?: Condition;
};
```

- Four actions: `INITIALIZE_AUTH`, `SET_GRANT`, `REMOVE_GRANT`, `MOVE_GRANT`.
  `UNDO`/`REDO`/`PRUNE` refused on the `auth` scope
- **Last applicable grant wins**; default deny
- Supports **deny**, **groups** (`powerhouse/reactor-group` rosters), and **conditions**
- Flags, all default off, each requiring its predecessor: `documentDecisions`
  (`REACTOR_DOCUMENT_DECISIONS`) → `authEnforcement` (`REACTOR_AUTH_ENFORCEMENT`) →
  `authGroups` / `authConditions`
- Limits: ≤100 grants/policy, condition ≤100 nodes and ≤10 deep, ≤100 operations per capability

Three footguns:
- **An allow on `execute` confers `read` on that scope.** `{can:"execute", scope:"*"}`
  publishes every domain scope. Administer on `scope: "auth"`, never `"*"`
- **A capability that omits `scope` covers `auth`** — i.e. hands over policy administration
- **A grant whose flag is off is skipped, not honoured** — so a conditional *deny* is
  weaker than it reads. Fails closed for allows, open for denies

---

## 4. The central decision: which layer is "the source of truth"?

The stack is **mid-migration from Layer 2 to Layer 3.** auth-scope stage 9 expresses the
host tables as grants; stage 10 retires the tables. Neither has shipped.

| | Layer 2 (host tables) | Layer 3 (document auth scope) |
|---|---|---|
| Maturity | live, working, in production use | stages 1–8 shipped; 9–10 pending |
| Source of truth | **the Switchboard** (private to one host) | **the document** (replicates everywhere) |
| Deny | ✗ | ✓ |
| Groups | ✗ in dev.85 | ✓ (`authGroups`) |
| Conditions | ✗ | ✓ (`authConditions`) |
| Per-scope granularity | ✗ (whole document) | ✓ |
| Admin dashboard | ✓ `auth-editor` shows the shape | ✗ nothing exists |
| Confidentiality of the ACL | private to the host | **published to every replica** |
| Future | **scheduled for retirement** | the destination |

**Recommendation: Layer 2 now, structured so Layer 3 is a swap, not a rewrite.**

Reasons: it matches your Plan A framing literally (the Switchboard *is* the source of
truth); it is the only layer with a working admin surface; it needs no fleet-wide flag
coordination; and Layer 3 has three blockers specific to our vault (§5.1, §5.2, §5.9).

**The decisive reason, found late:** our own subgraph gate (Ring 2) *only functions under
the `DOCUMENT_PERMISSIONS` policy* — under `OPEN` it is dead code, under `ADMIN_ONLY` it
locks out every non-admin (§5.7). Layer 2 is therefore a prerequisite, not a preference.

**Recorded dissent.** One research pass concluded the opposite — that the in-document grant
model "is the one you'd want to extend, not the reactor-api host tables" — on the grounds
that it replicates and is the stack's destination. Both are true. I still land on Layer 2
because Layer 3's preconditions are not currently satisfiable for this vault: flags must be
aligned across every replica including browsers we do not control (§5.1), signatures are
neither required nor verified so `{ address }` grants are satisfiable by a claim (§5.9),
and its documented safety sweep is not runnable from an installed package (§9). Layer 3 is
the destination; it is not the next step. Revisit when §5.1 and §5.9 are answerable.

---

## 5. Constraints and risks that shape the plan

### 5.1 Feature flags flip per fleet, never per node — BLOCKER for Layer 3

Replay decisions are consensus outcomes. *"Two replicas that share documents but disagree
on these flags therefore diverge"* — **permanently**. Our remote Switchboard, local
`ph vetra`, and every Connect browser reactor are replicas of the same drive. Enabling
`REACTOR_AUTH_ENFORCEMENT` on the remote alone would corrupt the vault. Layer 3 requires
coordinating every replica, including browsers we do not control.

### 5.2 Our documents have unsigned headers — WEAKENS Layer 3

*"Auth on an unsigned-header document does not resist an adversary… Anyone can run
`INITIALIZE_AUTH` first, and anyone can backdate one that retroactively re-evaluates the
whole history under a policy of their choosing."* Our 1,467 documents were created through
`scripts/drive-sync/lib/gql.py` raw GraphQL. **To confirm** (§9), but if unsigned: no
`creator` carve-out, so every policy must permanently retain an explicit `execute`-on-`auth`
grant or the document is locked out for good, on every replica, with no recovery.

### 5.3 Turning on host auth breaks the entire UI — SEQUENCING

`editors/shared/remote-reactor.ts` is the vault app's own write path and sends
`Content-Type: application/json` **and nothing else**. No bearer, no cookie. It is
architecturally committed to raw GraphQL because remote-first exists to dodge Chrome's
127 MiB IndexedDB cap. Exported writers `mutateDocumentRemote`, `createDocumentRemote`,
`createFolderRemote`, `deleteDocumentRemote` back create, mutate, delete, folder creation
**and vault boot init**.

**Enabling `REQUIRE_AUTHENTICATED_CALLER` without fixing this file first bricks the app.**
They must land in the same change.

### 5.4 The per-operation footgun

Granting the first per-operation permission silently locks that operation for everyone
else. Any UI must say so at the point of the decision, or admins will lock their team out
by granting one person a privilege.

### 5.5 Layer 2 publishes nothing; Layer 3 publishes the ACL

*"Migrating publishes every access list… A document whose access list must stay
confidential cannot have a replicated policy at all."* If team membership is sensitive,
that is an argument for Layer 2 beyond maturity.

### 5.6 Out of scope for authorization, but adjacent

- **LLM keys in `localStorage`** (`bai-chat-credentials:v1`, `bai-chat-providers:v1`):
  XSS-reachable, per-browser, centrally unmanageable, unrevocable by the vault
- **Chat egress**: note bodies (6k chars) and source text (8k chars) go to a user-chosen
  arbitrary base URL. Tools are structurally read-only (fixed switch over nine names), and
  `aiTools` re-exports ten read tools into Connect's assistant *"read-only by annotation,
  so the assistant never pauses for approval"*
- **`.ph/.keypair.json`** is an unencrypted private key on disk (gitignored)

These are real but separate; flagged, not solved here.

### 5.7 `assertCanRead` is policy-dependent — this reorders the plan

Verified in the shipped code (`reactor-api/dist/utils-lHoPB-ft.mjs`, `BaseSubgraph#resolveForCheck`):

```js
#resolveForCheck(identifier, ctx) {
  if (this.authorizationService.isSupremeAdmin(ctx.user?.address)) return null;   // skip the check
  if (this.authorizationService.config.policy !== AuthorizationPolicy.DOCUMENT_PERMISSIONS)
    throw new ForbiddenError();
  return this.resolveCanonicalDocumentId(identifier, ctx);
}
```

And `OpenAuthorizationService` — the policy in force on our deployment today:

```js
OpenAuthorizationService = class extends BaseAuthorizationService {
  isSupremeAdmin() { return true; }        // ← TRUE FOR EVERYONE, including anonymous
  canRead()  { return Promise.resolve(true); }
  canWrite() { return Promise.resolve(true); }
  ...
```

Three consequences:

1. **Under `OPEN`, adding `assertCanRead` to our subgraph does nothing.** Every caller is a
   "supreme admin", so the check returns skip. Ring 2 built alone is dead code.
2. **Under `ADMIN_ONLY`, `assertCanRead` throws `ForbiddenError` for every non-admin** — it
   does not fall back to a per-document check. Enabling `AUTH_ENABLED` without
   `DOCUMENT_PERMISSIONS_ENABLED` locks the whole team out of our subgraph.
3. **Ring 2 therefore only functions under `DOCUMENT_PERMISSIONS`.** Ring 1 must land
   before or with it — which is a correction to this document's original phase order.

This also settles §4: Layer 2 is not merely *preferable*, it is **required** for any working
per-document check in our own resolvers. Any guard we write must branch on
`authorizationService.config.policy`, never on `isSupremeAdmin` meaning "is an admin".

### 5.8 Ring 0 does not cover WebSockets

`createRequireAuthFetchMiddleware` is a **fetch** middleware; the WS upgrade path is
separate. `AuthService.authenticateWebSocketConnection` returns `null` for a tokenless
connection when `AUTH_ENABLED` is unset. So with `RESOLVE_CALLER_IDENTITY=true` +
`REQUIRE_AUTHENTICATED_CALLER=true` and `AUTH_ENABLED` unset, HTTP GraphQL 401s for
anonymous callers **but an anonymous `documentChanges` subscription is still admitted with
`user: null`** — live surveillance of every write survives Phase 2. Closing it needs
`AUTH_ENABLED=true` (i.e. Phase 3), and the Phase 2 exit test must assert the WS case
explicitly rather than assume it.

### 5.9 Signature verification is opt-in, and the auth subject is an unverified claim

`REQUIRE_SIGNATURES_DEFAULT = false` (verified in `switchboard/dist`). `SignatureVerifier`
no-ops entirely without an injected handler, and `createSignatureVerifier()` returns `true`
for an action carrying no signer at all.

Meanwhile the reactor's authorization decision reads its subject **straight off the action**:

```ts
{ address: action.context?.signer?.user.address,
  key:     action.context?.signer?.app.key }
```

So until signatures are both required and verified, a caller can assert any identity and
the reactor will authorize against it. This is a **deeper** problem for Layer 3 than the
unsigned-header issue in §5.2: it is not only that our documents lack a `creator`, it is
that grants naming `{ address }` can be satisfied by a claim. Layer 3 requires
`REQUIRE_SIGNATURES=true` plus a wired verifier to mean anything.

### 5.10 No package-level extension point for middleware or policy

A package contributes **document models, upgrade manifests, subgraphs, processors** — that
is the whole of `IPackageLoader`. There is no route, middleware, or `IHttpAdapter` access.
Confirmed non-exported: `createAuthorizationService`, `createRequireAuthFetchMiddleware`,
`getAuthContext`; and `Options` has no `authorizationService?` field, so the host policy is
chosen once at boot from env and **cannot be replaced**.

Therefore: all authorization we contribute **must live inside subgraph resolvers**. Ring 0
and Ring 1 are env toggles we consume, not code we write. This is a constraint on *where*
the work can go, and it is why Ring 2 is the only ring with an implementation task.

### 5.11 There are no API keys or sessions — Ring 3 must use Renown bearers

`Auth.md` documents a session API (`createSession`, `revokeSession`, `allowedOrigins`,
named/expiring sessions). **No implementation of it exists in the installed packages** —
treat that section as aspirational. The endpoint accepts exactly one scheme:
`Authorization: Bearer <did-jwt-vc>`.

So every service identity in Phase 1 is a Renown delegation credential: **7-day default
expiry**, no revocation list, and revocation lags up to the credential-verification cache
TTL (default 60 s). Two implementation details that will otherwise cost an afternoon each:

- The token must be minted **without an `aud` claim** — the Switchboard verifier rejects
  tokens carrying an audience.
- `verifyBearer` does `authorization?.split(" ")[1]`, so the token is positional; it never
  checks the literal `Bearer` prefix.

---

## 6. Plan A architecture: four enforcement rings

```
Ring 0  Perimeter        REQUIRE_AUTHENTICATED_CALLER=true      → no anonymous GraphQL at all
Ring 1  Host policy      DOCUMENT_PERMISSIONS_ENABLED + ADMINS  → per-document READ/WRITE/ADMIN
Ring 2  Our subgraph     assertCanRead/Write in withCanonicalDriveIds → the 30 queries + 2 mutations
Ring 3  Service identity a bearer for remote-reactor.ts, drive-sync, and the processor
```

**Note on ordering:** the rings are numbered outside-in, but they are *built* in the
order 3 → 0 → 1 → 2 (Phases 1–4). Ring 3 comes first because giving every writer an
identity is a no-op while the host is still `OPEN`, and skipping it breaks the app the
moment Ring 0 closes (§5.3).

Two things fall out of the rings that were not obvious:

- **MCP closes itself.** `mcp-request-authorizer.ts` already requires `isSupremeAdmin`, so
  `/mcp` becomes genuinely admin-only the moment the policy is not `OPEN`. It needs no work
  of its own — it is only open today *because* `OPEN` makes everyone an admin (§5.7).
- **The dashboard's API does not exist until Ring 1.** The core `auth` subgraph is
  registered conditionally — `if (documentPermissionService) coreSubgraphs.push(AuthSubgraph)`
  — so every query the dashboard needs appears only under `DOCUMENT_PERMISSIONS_ENABLED`.

Ring 2 is the part only we can build. The key implementation insight: **`withCanonicalDriveIds`
(`subgraphs/knowledge-graph/resolvers.ts:33`) is already a universal wrapper over every
query and mutation, and it already holds the `driveId`.** One change there covers all 32
resolvers without touching a single resolver body. Three tiers:

| Tier | Members | Rule |
|---|---|---|
| Read | the 26 ordinary queries | `assertCanRead(driveId, ctx)` |
| Sensitive read | `knowledgeGraphDebug`, `History`, `Activity`, `ActivityByType` | ADMIN — raw tables and PII |
| Write/admin | `knowledgeGraphReindex`, `knowledgeGraphUpsertEmbedding` | ADMIN + rate limit; consider deleting `UpsertEmbedding` outright, the processor self-embeds |

---

## 7. The auth admin dashboard — Six Minds design

Designed with `.claude/skills/six-minds-design-skill.md` (Whalen, *Design for How People Think*).

### 🧠 COGNITIVE AUDIT CHECKPOINTS

**Audience:** one expert admin (you) who knows Powerhouse deeply but not this auth model,
plus teammates who only ever ask "what can I see?". Expert in the domain, novice in the
semantics.

- **Vision/Attention** — the first thing on screen must be **the vault's exposure verdict**,
  not a grant list. "This vault is readable by anyone on the internet" in high-contrast
  alarm styling. A tree of 1,467 documents as the landing view divides attention into
  nothing. One anchor, then detail.
- **Wayfinding** — admins arrive asking "who can see the vault?" Their mental map is the
  folder tree they already navigate in Connect (`/knowledge/notes`, `/sources`, `/ops`,
  `/projects`). Because permissions **inherit down that tree**, inheritance must be drawn,
  not implied — otherwise every "why can they see this?" becomes a spatial mystery.
- **Memory/Semantics** — they are referencing GitHub repo settings (public/private +
  collaborators) and Google Drive sharing (a "who has access" list + role dropdown). Align
  with those. Two schema violations need active counteracting: they will expect **deny**
  (IAM taught them) and Layer 2 has none; and they will expect **private by default** when
  the host default is open.
- **Language** — use their lexicon: drive, folder, document, note, source, read/write/admin,
  address, ENS name. Avoid the ABAC dictionary — principal, capability, effect, subject,
  grant — on the primary surface; surface it only in an expert disclosure for Layer 3.
- **Decision Making** — microgoals in order: (1) is anything exposed? (2) who has access to
  X? (3) grant Y access to X, (4) revoke, (5) confirm it took effect. Just-in-time facts
  needed at the moment of the decision: what WRITE actually permits; that a first
  per-operation grant locks that operation for everyone; that "unprotected" means anonymous.
- **Emotion** — immediate need: stop the bleeding. Mid-term: run a team without fear.
  Identity goal: *be a responsible custodian of the team's institutional memory.* The two
  acute anxieties are **"did I just lock myself out?"** and **"did I just leak the
  scope-of-work budgets?"** Both need explicit safety nets, not tooltips.

### 🎨 DIVERGENT CONCEPTS EVALUATED

- **Concept A — Exposure Console (task-oriented/minimalist).** One screen: a verdict banner
  and a ranked risk list, each row with a Fix action. No tree. Fastest path to "am I safe",
  weakest at "who can see this one document".
- **Concept B — Share Dialog (contextual/conventional).** Drive/folder/document tree left,
  access panel right; role dropdowns. Exactly the schema GitHub and Drive installed, and the
  shape `auth-editor` already validates. Strong for goals 2–4, silent on goal 1.
- **Concept C — Access Map (immersive/emotional).** Render the drive as the graph the vault
  already draws (cytoscape/pixi are in the tree), colour nodes by exposure, animate a grant
  propagating down the inheritance chain. Highest emotional legibility for inheritance;
  expensive, and poor at "who has access to X" as a list.

**Selected blend: A as the landing screen, B as the working surface, and one borrowed
element from C.** Evidence for the blend rather than a pick: the audit says goal 1 (am I
exposed?) is a different question from goals 2–4 (manage access), and only A answers the
first while only B answers the rest. From C we take **only the inheritance-chain strip** —
a small inline breadcrumb showing which ancestor confers a document's protection — because
the audit identified inheritance as the specific locus of both spatial confusion and the
lockout anxiety. A full graph view is rejected: high cost, and it answers the question the
tree already answers better.

### 💻 IMPLEMENTATION SKETCH

```
┌─ Exposure  ────────────────────────────────────────────────────────┐
│ ⚠ THIS VAULT IS OPEN TO ANYONE ON THE INTERNET                    │  ← Ring 0 verdict, popout
│ 1,467 documents · 0 have a policy · anonymous read+write+delete    │
│ [ Close the vault ]  ← one action, opens a preview-first wizard    │
├─ Risks (ranked) ───────────────────────────────────────────────────┤
│ ● Semantic search can be poisoned anonymously        [Fix]        │
│ ● Audit log exposes 12 contributor addresses         [Fix]        │
│ ● Reindex is an open DoS lever (~63s/call)           [Fix]        │
├────────────────────────────────────────────────────────────────────┤
│ Tabs:  [Exposure*]  [People]  [Documents]  [Advanced ▸]           │
└────────────────────────────────────────────────────────────────────┘

Documents tab (Concept B, conventional):
  tree │ ┌ Who has access ───────────────────────────────┐
       │ │ Inherited from: /sources  ← inheritance strip │
       │ │ liberuum.eth (0x12…ab)   ADMIN   owner        │
       │ │ alice.eth    (0x34…cd)   WRITE   [Revoke]     │
       │ │ [+ Add person]  address ▸ role ▾              │
       │ │ ⓘ WRITE lets them edit and delete this and    │
       │ │   everything beneath it.                      │
       │ └───────────────────────────────────────────────┘
```

Non-negotiable behaviours the audit produced:

1. **Preview before apply.** Every change shows "before → after, for these people" and is
   confirmable. `auth-editor` fires `Revoke`, `Delete Group`, `Unprotect` and
   `Transfer ownership` immediately, with no confirmation — do not copy that.
2. **Lockout prevention.** Refuse, in the UI, any change that would leave the acting admin
   without ADMIN. Say why. This directly answers anxiety #1 and mirrors Layer 3's own
   born-locked-out validation.
3. **Name the per-operation footgun inline** at the moment of granting, not in docs.
4. **Say "no deny" out loud.** A one-line explainer where an IAM user would hunt for it.
5. **Search, filter and sort from day one.** `auth-editor` has none and is unusable past
   ~50 documents; we have 1,467.
6. **Use the design system.** `auth-editor` is raw `<div>`s with inline hex; we have
   `@powerhousedao/design-system` and `document-engineering` already.

### 🔍 SIX MINDS MAPPING

- **Vision:** single high-contrast verdict banner as the visual anchor; ranked risks below;
  the 1,467-row tree deferred to its own tab so it never competes for first fixation.
- **Wayfinding:** the Connect folder tree as the shared landmark, plus an inheritance strip
  giving each document its "you are here, protected by /sources" coordinates.
- **Memory:** the Google-Drive/GitHub share schema — a people list with role dropdowns —
  reused rather than reinvented; the two places we violate expectation (no deny, open by
  default) are called out explicitly rather than left to surprise.
- **Language:** drive/folder/document/read/write/admin/address on the surface; grant,
  principal, capability, scope and condition quarantined behind **Advanced** for Layer 3.
- **Decision:** the tabs are the microgoal sequence — exposure first, then people, then
  documents; the WRITE explainer and the per-operation warning sit at the decision point.
- **Emotion:** *Appeal* — one honest verdict and one button. *Enhance* — search/filter and
  preview-before-apply make it usable at 1,467 documents for the next six months.
  *Awaken* — lockout prevention and a reversible preview soothe the two named fears and
  support the custodian identity.

**Dashboard hosting decision (open, §10.5):** `auth-editor`'s `powerhouse/auth-dashboard`
document type stores only `switchboardUrl` — a bookmark. We can copy that pattern (a
per-drive config document) or make it a view inside the existing `knowledge-vault` app,
where the admin already is. My inclination is the latter.

---

## 8. Phased plan

Each phase is independently shippable and ends with a verification that does not trust a
dispatch. **No phase is started before §10 is answered.**

### Phase 0 — Measure (no changes)
Confirm the exposure empirically against the remote; confirm whether document headers are
signed; run `preflight:auth`. Deliverable: a findings note. *This phase is the one that can
start immediately — it writes nothing.*

### Phase 1 — Ring 3 first: give every writer an identity
`editors/shared/remote-reactor.ts`, `scripts/drive-sync/lib/gql.py` (a `PH_ACCESS_TOKEN`
env), `reindex.py`, and a service identity for `processors/graph-indexer/automation.ts`.
**Must precede Phase 2** or the app breaks (§5.3). Exit: every write path carries a bearer
while the host is still `OPEN`, so nothing changes behaviourally and nothing can regress.

### Phase 2 — Ring 0: close the perimeter
`RESOLVE_CALLER_IDENTITY=true` + `REQUIRE_AUTHENTICATED_CALLER=true`.

Exit: anonymous `curl` gets `401 {"error":"Authentication required"}`; the vault app, CLI,
drive-sync and MCP all still work. **The exit test must also assert the WebSocket case** —
an anonymous `documentChanges` subscription is still admitted at this phase (§5.8), so
record it as a known-open surface rather than assuming Ring 0 closed it.

This is the single biggest risk reduction in the plan: one env pair, on top of Phase 1.

### Phase 3 — Ring 1: per-document permissions
`AUTH_ENABLED=true`, `DOCUMENT_PERMISSIONS_ENABLED=true`, `ADMINS`, `DEFAULT_PROTECTION`.

**Moved ahead of Ring 2 (§5.7).** Our subgraph's `assertCanRead` is a no-op under `OPEN` and
a blanket `ForbiddenError` under `ADMIN_ONLY`; it only behaves per-document under
`DOCUMENT_PERMISSIONS`. So the policy must be in force before the gate is worth writing.
This phase also closes `/mcp` (admin-only in code already) and the anonymous WS hole from
Phase 2.

Rehearse against the committed production snapshot first — `scripts/drive-sync/README.md`
says that snapshot exists precisely for *"testing Switchboard authorization … against real
data before touching remote."*

Exit: the §2 capability matrix is empty for an anonymous caller and correct for each role;
`DEFAULT_PROTECTION` is set deliberately rather than by default.

### Phase 4 — Ring 2: gate our own subgraph
`assertCanRead` / `assertCanWrite` threaded through `withCanonicalDriveIds`
(`subgraphs/knowledge-graph/resolvers.ts:33`), with the three tiers from §6. The guard
branches on `authorizationService.config.policy` — never on `isSupremeAdmin` (§5.7).

Exit: an authenticated non-admin still gets search but cannot call `knowledgeGraphDebug`,
`knowledgeGraphReindex`, `knowledgeGraphUpsertEmbedding`, or the `History`/`Activity`
audit queries; a caller naming a drive they have no grant on gets `FORBIDDEN`, including
when they name it by slug rather than UUID.

### Phase 5 — The dashboard
Per §7, in phases matching the tabs: Exposure, then People, then Documents.

**Scope note:** the dashboard is a second subsystem, not a task in this one. It should get
its own spec → plan cycle once Phases 0–4 have settled what it is administering — building
an admin UI before the model it administers is chosen would be wasted work. This document
specifies its *design* (§7) so the cognitive work is not lost, but the executable plan for
it is deliberately deferred.

### Phase 6 — Layer 3, only if §10.1 says so
Requires fleet-wide flag coordination (§5.1) and a signed-header story (§5.2).

---

## 9. Verification steps (for you — I was blocked from probing the remote)

Unauthenticated requests to your remote host trip the sandbox classifier, so these are
yours to run:

```bash
# 1. Is the remote actually open? (expect 200 + data today, 401 after Phase 2)
curl -sS -o /dev/null -w "%{http_code}\n" https://switchboard.eager-hen-55.vetra.io/graphql \
  -X POST -H 'content-type: application/json' -d '{"query":"{ __typename }"}'

# 2. Are document headers signed? (decides §5.2)
switchboard docs get <any-note-id> --format json | python3 -c \
  "import json,sys; h=json.load(sys.stdin).get('header',{}); print('sig:', bool(h.get('sig') or h.get('signature')))"

# 3. Does any document already carry a policy? (snapshot says all 1,467 are version 0)
python3 -c "import json; a=json.load(open('scripts/drive-sync/data/powerhouse-knowledge/auth.json')); \
  print('initialized:', sum(1 for v in a.values() if (v or {}).get('version',0) > 0), 'of', len(a))"

# 4. NOT AVAILABLE TO US — see note below
```

**On `preflight:auth`:** the spec makes it the gate for enabling `authConditions`, but it
is **not a user-facing command**. It resolves to an internal script in the reactor package
(`@powerhousedao/reactor`: `preflight:auth -> tsx src/admin/run-stream-order-check.ts`),
and it is not exposed through `ph-cli`, not a `bin` entry, and its `src/` is not in the
published dist we install. So we cannot run the sweep that Layer 3's condition support
requires without working from a reactor source checkout. **This is an additional argument
for deferring Layer 3** (§5.2) — one of its documented safety preconditions is not
something we can currently check.

---

## 10. Decisions — ANSWERED 2026-09-09

| # | Question | Answer |
|---|---|---|
| 1 | Layer 2 or Layer 3? | **Layer 2.** Host document permissions |
| 2 | Threat model | **Authenticated read, restricted write.** Anyone signed in may read; only named addresses may write |
| 3 | Supreme admin | `0xadbA7C2F82139031D7564D18aC22D09B12A0BcA4` (single — see risk below) |
| 4 | Read posture | Open to any signed-in user, not anonymous. Renown login required (see 5.3) |
| 5 | Dashboard home | Inside `knowledge-vault`, as an entry in `SettingsMenu` (`editors/knowledge-vault/components/DriveExplorer.tsx:442`, `SETTINGS_ITEMS` at :532) |
| 6 | Chat `localStorage` keys | **Separate piece of work.** Out of scope |

Additional answers folded in:

- **§5.1 is largely dissolved.** The vault app drive no longer creates local syncs with the
  remote Switchboard — it is a pure client that reads from Switchboard. Browsers are
  therefore not replicas, so the fleet is just the remote Switchboard and local `ph vetra`
  (which drive-sync moves data between). This removes the main objection to Layer 3 later;
  it does not change the Layer 2 decision.
- **§5.2 — no schema changes, and nothing to initialize.** The auth scope is
  `PHBaseState.auth`, a sibling of `document`, entirely outside `KnowledgeNoteState`.
  Nothing in `document-models/*/v1/schema.graphql` moves. And because Layer 2 stores
  permissions in Postgres rather than on documents, `INITIALIZE_AUTH` is not used at all —
  the 1,467 documents are never touched.
- **§5.3 — a Renown login gate is required in the app**, and the read check uses
  `userDocumentPermissions` (the caller's *own* grants). Not `documentAccess`, which itself
  requires ADMIN and would fail for exactly the users being gated.
- **§5.8 is closed by `AUTH_ENABLED=true`**: `authenticateWebSocketConnection` throws
  `"Missing authorization in connection parameters"` on a tokenless connection when
  `config.enabled` is true. The hole only existed in the `RESOLVE_CALLER_IDENTITY`-only
  configuration.

### The chosen target configuration

```bash
AUTH_ENABLED=true
ADMINS="0xadbA7C2F82139031D7564D18aC22D09B12A0BcA4"
DEFAULT_PROTECTION=true
DOCUMENT_PERMISSIONS_ENABLED=true
```

**We build directly against this**, accepting that the vault is non-functional until the
plan lands. The user does not currently depend on it, and developing against the end state
removes a migration step. Consequences, all verified in the shipped code:

- Every document is protected (`isProtectedWithAncestors` returns `defaultProtection` for a
  document with no row — none of the 1,467 has one), so only the admin address passes
- `assertCanCreate` throws `AuthenticationRequiredError` for a caller with no address, so
  document creation fails regardless of protection
- Anonymous WebSocket connections throw
- `/mcp` returns 401 (no bearer) and would 403 for any non-admin

Note `AUTH_ENABLED=false` + `DOCUMENT_PERMISSIONS_ENABLED=true` **refuses to boot**
(`assertAuthRequiredForDocumentPermissions`). The two flags move together.

### Expressing "authenticated read, restricted write" in Layer 2

Layer 2 has **no `anyone` principal** and protection is binary across read and write, so the
rule is expressed by **grants on the drive**, which inherit: `#hasGrantInHierarchy`
*"walks the parent hierarchy … on the document or any ancestor."*

- one `READ` grant on the drive per reader → inherits to all 1,467 documents
- one `WRITE` grant on the drive per writer

N rows where N is the team size. Two gaps to accept or handle in Ring 2:

1. `canCreate = isSupremeAdmin(addr) || !!addr` — **any authenticated user can create
   documents**, grants notwithstanding.
2. Per-operation restrictions do **not** inherit (`isOperationRestricted` is keyed by
   `documentId` with no ancestor walk), so they are not a scalable tool here.

### Risk accepted: a single supreme admin

`ADMINS` holds one address. With `DEFAULT_PROTECTION=true`, losing that key leaves no
principal able to grant anything, and the vault becomes unadministrable through the API.
**Recommendation: add a second admin address before Phase 4.**

## 11. What I am explicitly NOT proposing

- Building any new authorization primitive. Three exist.
- Taking `@powerhousedao/auth-editor` as a dependency — it is **AGPL-3.0-only**, and its
  group UI is broken against dev.85 (it selects a `groupPermissions` field that does not
  exist, so GraphQL validation fails and its whole document-permissions panel never
  renders). Design reference only.
- Relying on the plugin hooks, or on signatures, for access control.
- Enabling `REACTOR_AUTH_ENFORCEMENT` on the remote alone (§5.1).
