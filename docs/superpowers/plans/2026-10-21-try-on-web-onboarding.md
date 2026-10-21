# Try on web: Welcome, Tour and the Way to the Full Vault — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A visitor to /try first learns, in a prominent popup, that the vault lives only in their browser and what the full product adds, with two ways up (cloud vault, desktop app); is offered a guided tour over the live app; and meets the way up again at the moments a limit or a loss is felt — every step counted in Umami.

**Architecture:** The vault package (`bai-knowledge-note`, branch `feat/try-pipeline`) adds stable `data-tour` anchors and three `BrowserVault` props (`bannerActions`, `onReady`, `onEvent`); it reports facts only. The landing (`knowledge-vault-landing`, branch `feat/try-onboarding`) owns everything a visitor reads: the welcome, the offer, the tour layer, the corner card, the nudges, the contact form (one hook shared with the landing page) and the Umami events, in a stylesheet scoped to its own root.

**Tech Stack:** React 19 / Next 16 (landing, Tailwind only outside /try), TypeScript, vitest (package), `node --test` with type stripping (landing's pure rules; no new dependency), Playwright (scratch e2e).

**Spec:** `docs/superpowers/specs/2026-10-21-try-on-web-onboarding-design.md` (approved 2026-10-21 with: cloud path = the contact form for now; Umami events yes; the desktop app is free).

## Global constraints

- Package: bun only; `bun run tsc`, `bunx oxlint --type-aware <files>`, tests per task; editors never import `browser/*`; nothing in `browser/` reaches the server build.
- Landing: no new dependencies (the lockfile is npm's); `next build` must pass; /try never loads `app/globals.css`; every onboarding selector is under `.kvo` (no class shared with the vault app); Tailwind classes are not available inside /try.
- Words: the spec's copy, exactly. Desktop app copy carries no price ("Free download").
- Events carry names and small numbers only — no text, titles, ids or file names. `page` for the contact form: `/try · cloud · <from>`.
- Motion: one entrance per modal/card, the arrow drawn once per step; all off under `prefers-reduced-motion`.

## Review Focus

1. A tour step whose target is missing (AI already connected; a slow view) → skipped after 2 s, the tour goes on; Esc ends it from any step; the corner resumes it.
2. Welcome and offer shown once per browser; a reload mid-tour, or the OpenRouter sign-in leaving the page at "Connect your AI", resumes at the right step.
3. Nudges: each at most once, never over the tour or a modal (queued until both are closed), dismissible, never blocking.
4. The contact form from /try posts the same fields as the landing's, with `page` = `/try · cloud · <from>`; a failed send keeps what was typed.
5. The vault app looks unchanged with the onboarding stylesheet loaded (no leaked selectors, fonts or resets).

---

### Task 1: The vault's side — anchors, ready, events

**Files:**
- Modify: `editors/knowledge-vault/components/VaultPlaces.tsx`, `VaultSidebar.tsx`, `VaultMenu.tsx`, `DriveExplorer.tsx`, `NoteList.tsx`, `chat/ChatConnectPanel.tsx`; `editors/knowledge-note-editor/editor.tsx`
- Modify: `browser/BrowserVault.tsx`, `browser/boot.ts`, `browser/index.ts`, `browser/pipeline/runner.ts`, `browser/pipeline/phases.ts`
- Test: `browser/tour-anchors.test.ts`, `browser/pipeline/runner.test.ts`, `browser/pipeline/phases.test.ts`

**Interfaces:**
- Produces `data-tour` anchors: `place-ask|notes|topics|sources|work|graph` (list and icon variants), `search`, `add-sources`, `settings`, `settings-queue`, `settings-health` (menu items, via `VaultMenuItem.tour?: string`), `sources-timeline`, `note-card` (first card), `note-links`, `note-history`, `ai-connect`, `corner` (the banner).
- Produces in `browser/BrowserVault.tsx`, exported from `browser/index.ts`:
  - `type TryEvent = { type: "ai-connected"; kind: "openrouter" | "local" | "connect" } | { type: "source-added"; count: number } | { type: "source-processed"; notes: number; partial: boolean } | { type: "source-failed"; reason: string }`
  - `type VaultReady = { guideIds: Readonly<Record<string, string>>; tourNote: string | null; open(documentId: string): void }`
  - `BrowserVaultProps` gains `bannerActions?: ReactNode` (inside the banner, before Reset), `onReady?(ready: VaultReady): void` (once the guide is written; at once on a return visit), `onEvent?(event: TryEvent): void`.
- `tourNote` = this vault's id of the guide note "Note citations give generated answers an inspectable evidence trail" (seed id `_7l7w_PAR44BwdULg3xFIbDoIPSDkxZpwCtKHxaqCAc`, mapped through `guideIds`), null when absent.
- Runner: `RunnerDeps.onEvent?(event: PipelineEvent)`; `PhaseOutcome.partial?: boolean` (create: only the first part was read).

- [ ] **Step 1: Write the failing tests:**
  - `tour-anchors.test.ts`: each anchor value above appears in its component source;
  - runner: tasks present at the first look are not "added"; one new claim task → `{ type: "source-added", count: 1 }`; two in one look → `count: 2`; a completed task → `{ type: "source-processed", notes, partial }` (notes from `GET stats`); a failed one → `{ type: "source-failed", reason }`;
  - phases: the 60 000-character source's create outcome has `partial: true`, a short one has none.
- [ ] **Step 2: Run** `bun run test browser` — expected FAIL.
- [ ] **Step 3: Implement.** `ai-connected`: BrowserVault reads `activeProvider(readSavedProviders())` every 2 s while ready, and reports a kind when none → some (once per kind and page); `onReady` fires once, after `vault.seeding` settles.
- [ ] **Step 4: Run** the tests, `bun run tsc`, the lint, `bun run build` — PASS.
- [ ] **Step 5: Commit** `feat(browser): tour anchors, a ready callback and plain events for the page that hosts the vault`

### Task 2: One contact form, two places

**Files:**
- Create: `components/landing/use-demo-request.ts` (landing)
- Modify: `components/landing/DemoRequest.tsx`

**Interfaces:**
- Produces `useDemoRequest(opts: { locale: string; page: () => string }): { state: "idle" | "sending" | "done" | "error"; invalid: boolean; sentTo: string; submit(event: React.FormEvent<HTMLFormElement>): Promise<void>; again(): void }` — posts `{ ...fields, locale, page }` to `/api/demo-request`; 400 → `invalid`; network/other → `error` keeping the fields.

- [ ] **Step 1: Write the check** in the scratch e2e (`run-onboarding.mjs`): on `/`, a `#talk` link opens the form; a submit to a stubbed `/api/demo-request` sends `name, company, email, question, website, locale, page="/"` and shows "Thank you. We have it."
- [ ] **Step 2: Refactor** DemoRequest onto the hook; markup unchanged.
- [ ] **Step 3: Run** `next build` and the check — PASS.
- [ ] **Step 4: Commit** `refactor(landing): the walkthrough form's sending is a hook /try can share`

### Task 3: The onboarding's rules

**Files:**
- Create: `app/(try)/try/onboarding/rules.ts` (no imports), `app/(try)/try/onboarding/rules.test.mjs`
- Modify: `package.json` — `"test": "node --test app/**/*.test.mjs"`

**Interfaces:**
- Produces: `TourStatus = "never" | "running" | "paused" | "ended" | "done"`; `OnboardingState = { welcomed: boolean; offered: boolean; tour: { status: TourStatus; step: number }; nudges: Moment[] }`; `readState(storage)`, `writeState(storage, state)` (key `kv-try:onboarding:v1`); `TOUR_STEPS: TourStep[]` — `{ id, target, title, line, prepare?: Prepare[] }` with `Prepare = { click: string } | { open: "tour-note" } | { menu: "settings" }`, the 15 steps of the spec's table; `resumeStep(state)`, `cornerLabel(state)`; `Moment = "first-notes" | "big-source" | "large-vault" | "tour-end"`; `momentFor(event: TryEvent, seen: Moment[]): Moment | null` (`LARGE_VAULT_NOTES = 200`, a big source = `count >= 2` or `partial`); `placeCard(target: Rect, card: Size, view: Size): { x: number; y: number; side: "right" | "left" | "below" | "above" }`; `arrowPath(from: Rect, to: Rect): string`.

- [ ] **Step 1: Write the failing tests:** persistence round trip and a corrupt store reading as new; 15 steps in the spec's order with the spec's titles; resume: paused → its step, running at "ai-connect" → the next, ended → 0; corner label "Continue the tour" (paused) / "Take the tour" (never, ended, done); moments: first processed source → "first-notes" once, a 2-part add or a partial read → "big-source", 200+ notes → "large-vault", nothing twice; card placement: right of a sidebar target, left when no room, clamped inside the view.
- [ ] **Step 2: Run** `node --test 'app/(try)/try/onboarding/rules.test.mjs'` — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(try): the onboarding's rules — steps, resume, moments, placement`

### Task 4: The welcome, the offer and the way up

**Files:**
- Create: `app/(try)/try/onboarding/{Onboarding.tsx, Welcome.tsx, WayUp.tsx, ContactForm.tsx, track.ts, onboarding.css}`
- Modify: `app/(try)/layout.tsx` (Geist and Manrope as variables on the onboarding root only; the stylesheet), `app/(try)/try/try-vault.tsx` (no `downloadUrl`; `bannerActions`, `onReady`, `onEvent`; the Starting screen's line → "Nothing is saved on our servers.")

**Interfaces:**
- Consumes Task 1's props/types (from the loaded module's types), Task 2's hook, Task 3's rules.
- Produces `track(name: string, data?: Record<string, string | number>)` → `window.umami?.track`.

- [ ] **Step 1: Write the e2e checks** (`run-onboarding.mjs`, against the dev server): the welcome is the first thing shown, with the spec's copy; Esc and "I understand" close it, and it does not come back on reload; "Cloud vault" shows the form headed "Get a cloud vault" and its submit sends `page = "/try · cloud · welcome"`; "Desktop app" opens `/` in a new tab; the offer follows once the vault is ready; the corner shows "Get the full vault", the tour button and "About this vault" before Reset.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS, plus `next build`.
- [ ] **Step 5: Commit** `feat(try): the welcome says where the vault lives and shows the way up`

### Task 5: The tour

**Files:**
- Create: `app/(try)/try/onboarding/Tour.tsx`
- Modify: `Onboarding.tsx`, `onboarding.css`

**Interfaces:**
- Consumes `TOUR_STEPS`, `placeCard`, `arrowPath`, `VaultReady.open`.

- [ ] **Step 1: Write the e2e checks:** "Show me around" walks all 15 steps — each target highlighted or skipped within 2 s; "3 of 15" shown; Back/Next; clicking the highlighted element moves on; Esc ends it and the corner then reads "Continue the tour" and resumes at that step; the last step shows the two ways up.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** (four dim panels around the target block stray clicks, an SVG mask draws the rounded cut-out, a ring, the card, an SVG arrow; recompute on resize, scroll and DOM changes). **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(try): a guided tour over the live vault`

### Task 6: The nudges and the funnel

**Files:**
- Modify: `Onboarding.tsx`, `WayUp.tsx`, `track.ts`, `onboarding.css`

- [ ] **Step 1: Write the e2e checks** (stub AI as in the pipeline e2e; `window.umami` stubbed to record): a pasted source, once processed, opens the "first-notes" card once; a nudge waits while the tour runs; Umami receives `try-understood`, `try-tour-start`, `try-tour-step` {step}, `try-ai-connected` {kind}, `try-source-added` {count}, `try-source-processed` {notes rounded to tens}, `try-nudge` {moment}, `try-cloud`/`try-contact-sent`/`try-desktop` {from} — and no event carries text.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** the whole onboarding e2e, the pipeline e2e and the browser suites, `next build` — PASS. Screenshots of each screen reviewed against the design (look, words, contrast, focus rings).
- [ ] **Step 5: Commit** `feat(try): the way up at the moments that matter, and the funnel counted`
