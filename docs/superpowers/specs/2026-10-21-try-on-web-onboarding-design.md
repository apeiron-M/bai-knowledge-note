# Try on web: welcome, guided tour and the way to the full vault — design

Date: 2026-10-21 · Repos: `knowledge-vault-landing` (`/try`: the welcome, the contact form, the tour layer,
the nudges, the funnel events) and `bai-knowledge-note` (`browser/`, `editors/`: tour anchors and three
small `BrowserVault` props). Builds on `2026-10-21-try-on-web-pipeline-design.md`; the tour shows the
pipeline's results. Inputs: the user's brief, the tour goals, and the team meeting of 2026-10-21
(*the preview is a funnel to the full product*).

## Why

A visitor who opens /try lands in a full app with no idea what it is, that it lives only in their
browser, or what the real product adds. They should learn three things before anything else — the vault
is theirs and local; clearing browser data deletes it; the full Knowledge Vault does much more, and the
team is one form away — and then be shown around the real app, not a video of it. *(user)*

The preview exists to win users for the full product. *(meeting)* It is cheap to run because the
visitor's browser does all the work — no server and no container per visitor — and that same choice sets
its limits: nothing is saved on our servers, clearing the browser deletes the vault, and large
collections get slow. So the preview says this plainly and first, and wherever a visitor meets a limit
it shows the way up: **the cloud vault** we host, or **the desktop app**. *(meeting)*

## Goals

1. **The welcome**, a prominent popup and the first thing on load *(user, meeting)*:
   - The vault runs fully in this browser. Nothing is saved on our servers. Clear the browser's data
     and the vault is gone.
   - The browser does all the work, so big collections get slow. *(meeting)*
   - This preview has no integrations (Google Drive, Dropbox, Gmail, Calendar, notes apps), and no MCP
     or API access.
   - The way up: the cloud vault (saved, backed up, secure, any size) or the desktop app. *(meeting)*
     The cloud path is the landing's own contact form. *(user)*
   - The visitor confirms with **I understand**.
2. **The offer**: a second, small modal asks whether they want to be shown around. *(user)*
3. **The tour**: a layer over the live app that walks every view with a highlight and an arrow, and
   says in a line or two what it is and how to use it. Every step can end the tour; the tour resumes
   from a button in the bottom-right corner, where "Download the desktop app" is today. *(user)*
4. **What a visitor can do afterwards** *(user)*: move around the app; chat with the vault with
   OpenRouter or a local AI; read the graph; open notes and maps; see the source behind the notes; read
   Sources › Timeline; open the settings' Health check and Processing queue; add a source and watch it
   become notes.
5. **The way up, at the moments that matter** *(meeting; the moments are my calls)*: a permanent
   **Get the full vault** in the corner, and once-only, non-blocking nudges when the visitor adds a big
   source, when their own first source has become notes, when the vault grows large, and at the tour's
   end.
6. **Measure the funnel** *(my call, for the meeting's goal)*: count each step from opening /try to
   contacting the team or downloading the app, in the landing's existing Umami — event names and small
   numbers, never content.
7. **Words**: simple and direct, few words. **Look**: the landing's. *(user)*

## Non-goals

- A tour on phones (/try already shows "works best on a computer" below 768 px).
- Translations (/try and the vault app are English).
- Changing the vault app's own screens, except stable anchors for the tour.
- Payments or sign-up inside /try. Until a hosted plan has its own page, the cloud path goes to the team
  through the contact form. *(my call — see "Needs your answer")*
- Counting anything about the vault's content: no text, titles, ids or file names in events.

## Anti-goals

- The landing's global CSS leaking into the vault app, or the vault's into the welcome.
- A tour that breaks when a view is slow or missing: a step whose target is not there waits briefly,
  then skips, and the tour goes on.
- Promises the browser cannot keep (e.g. "your AI turns it into notes" when none is connected — the tour
  says how to connect one).
- A hard sell: a nudge that blocks, repeats, or interrupts the tour or a modal.

## Constraints

- /try has its own root layout; it loads the vault's stylesheet, not the landing's `globals.css`
  (whose base rules — `* { border-color }`, `html { background }`, fonts — would restyle the vault).
  Utility classes clash too: both builds define e.g. `text-muted` with different tokens.
- The contact form posts to the landing's `/api/demo-request` with the fields and checks it has today
  (name, company, email, question, the `website` trap, `locale`, `page`). The cloud path is told apart
  by `page` only — the endpoint does not change.
- The vault app's DOM is the package's; the tour reaches it only through stable `data-tour` attributes
  the package adds (anchors listed below), never through class names.
- The package carries no analytics and no sales copy: it reports what happened (`onEvent`), and the
  landing decides what to show and what to count.
- Umami on /try keeps its settings (do-not-track honoured, query strings excluded); events are added to
  it, nothing replaces it.

## Cognitive audit (Six Minds)

- **Vision:** first, one message — "this vault lives in this browser". One accent (lavender) marks the
  one action on each screen; the tour's spotlight is the only bright thing while it runs.
- **Wayfinding:** the tour follows the sidebar from top to bottom, opens each place itself, and shows
  "3 of 15" — the visitor always knows where they are and how much is left. The corner button is the
  one way back in, and the one place the way up always lives.
- **Memory:** conventions the visitor knows — a centred modal with one primary button, a product-tour
  spotlight with Next / Back, Esc to close, the sidebar as the map, a small card in the corner.
- **Language:** novices. No "MoC", "pipeline", "reactor": maps, notes, sources, steps. Sentences of a
  few words.
- **Decision:** one decision per screen — understand; tour or not; next or stop. The way up is a side
  door on each, never a gate: outlined buttons beside the visitor's own next step.
- **Emotion:** the worry is "where does my data go / will I lose it": answered first and plainly. The
  appeal: watching their own source become notes. Mastery: the step count and a short "You're set"
  at the end. The way up appears when the visitor feels a limit or has something of their own to lose,
  framed as keeping their work, not as a sale.

## Concepts considered

- **A — Minimal:** one modal with the facts, a bare checklist tour in a side panel. Fast, but the panel
  covers the app and the visitor reads instead of sees.
- **B — Conventional:** a modal, then a classic spotlight tour with popovers. Familiar, reliable.
- **C — Immersive:** an animated intro, a drawn lavender arrow that travels from step to step.
  Memorable, but slower and louder than the brief's "few words".

**Chosen: B, with C's one bold element** — the spotlight and a hand-drawn lavender arrow from the step's
card to its target — and everything else quiet.

## Design (decided)

### 1. Look *(my calls, from the landing)*

- Colours — the landing's tokens: ink `#0c0b12`, surface `#15141d`, raised `#1e1d29`, line `#29283a`,
  text `#eceaf4`, dim `#a5a1b6`, muted `#8a869e`, lavender `#c3a4f7` (actions and the spotlight), green
  / amber / cyan only for state.
- Type — Geist for headings (the landing's `.voice`: 600, tight tracking), Manrope for text.
- Shapes — the landing's dialog: 18 px radius, 1 px line border, blurred ink backdrop, the `demo-in`
  entrance; buttons as the landing's (lavender filled primary, outlined secondary, fully rounded).
- One stylesheet for the welcome, the form, the tour and the nudges, scoped to their own root element,
  with the landing's values; no Tailwind base rules on /try, and no class names shared with the vault app.

### 2. The welcome *(copy: my calls, content: user and meeting)*

Shown once the vault is on screen — its sidebar shown, then a beat — never over the loading screen.
*(user, after trying it: the first version opened on load, over the blank "starting" page.)*

> **Your vault lives in this browser**
> Nothing is saved on our servers. No account, no backup.
> Clear your browser's data, and the vault is gone.
> Your computer does the work, so big collections get slow.
>
> **This is a preview.** The full Knowledge Vault adds:
> - Your vault saved, backed up and secure, at any size
> - Connections to Google Drive, Dropbox, Gmail, Calendar and your notes apps
> - MCP and an API, for your tools and agents
>
> [ Cloud vault ]  [ Desktop app ]            [ **I understand** ]

- **Cloud vault** turns the modal into the landing's contact form, headed "Get a cloud vault" (same
  fields, same endpoint, same states; `page` records `/try · cloud · <where>`), with a way back. Sent, it
  says so and returns to the welcome.
- **Desktop app** opens the landing's download in a new tab, so the vault stays open.
- **I understand** — or Esc — closes it. Shown once per browser; reopened from the corner ("About this
  vault").

### 3. The offer *(copy: my calls)*

> **Want a quick tour?**
> About two minutes. Stop anytime.
> [ I'll look around ]   [ **Show me around** ]
> *The tour waits in the bottom-right corner.*

Shown after the welcome once the vault is ready.

### 4. The tour *(steps: my calls, from the user's list)*

A full-page layer: the app dimmed in ink except a rounded cut-out around the target with a lavender ring;
a card (title, one or two lines, "3 of 15", Back / Next, ×) beside the target; a drawn lavender arrow
from the card to the target. The tour opens each view itself (as if the visitor clicked) so the target
is on screen; clicking the highlighted element also moves on. It recomputes on resize, scroll and
layout changes. Esc ends it.

| # | Target (`data-tour`) | Title | Line |
|---|---|---|---|
| 1 | `place-ask` | Ask your vault | Chat with your notes. Answers cite them. |
| 2 | `ai-connect` | Connect your AI | OpenRouter, or an AI on your computer. What you ask and add goes to it. |
| 3 | `place-notes` | Notes | One idea per note. |
| 4 | `note-card` | Open a note | Read it, and see where it came from. *(opens a chosen guide note with links and history — see below)* |
| 5 | `note-links` | Links | How this note connects, and why. |
| 6 | `note-history` | History | Every change, kept and signed. |
| 7 | `place-topics` | Topics | Maps that group related notes. |
| 8 | `place-graph` | Graph | See how everything connects. |
| 9 | `place-sources` | Sources | Where your notes came from. |
| 10 | `sources-timeline` | Timeline | When each source came in, and what it became. |
| 11 | `add-sources` | Add your own | Paste text or drop a file. Your AI turns it into notes. |
| 12 | `settings-queue` | Processing queue | Watch your AI work, step by step. |
| 13 | `settings-health` | Health check | Is everything linked and complete? |
| 14 | `search` | Search | Find anything. Ctrl K. |
| 15 | `corner` | You're set | Want to keep your vault? Cloud vault or desktop app. *(both buttons on the card, beside Done)* |

- Progress is kept per browser; **End tour** keeps the step; the corner button reads **Continue the
  tour** (paused) or **Take the tour** (ended or never). An OpenRouter sign-in that leaves the page
  mid-tour resumes at the next step on return.
- A missing target (e.g. no AI connect buttons because an AI is already connected) waits up to 2 s, then
  the step is skipped.
- Steps 4–6 open a chosen guide note — one with links and history — by its id in `guideIds` (the guide's
  ids follow its new dates); a vault seeded before `guideIds` existed falls back to the first card.
  *(my call, after review)*

### 5. The way up *(meeting; placement and moments: my calls)*

**The corner.** The landing passes no `downloadUrl`, so the banner's own download link goes, and its
`bannerActions` render, in this order: **Get the full vault** (lavender), the tour button, About this
vault — then the banner's Reset. **Get the full vault** opens a small card above the corner:

> **Get the full vault**
> **Cloud vault** — we host it. Saved, backed up, secure, any size.  [ Talk to us ]
> **Desktop app** — on your own computer.  [ Download ]

**The nudges.** The same card, opened by itself with a one-line reason on top, at the moments a visitor
meets a limit or has something to lose. Each at most once per browser; never during the tour or a modal
(it waits for them to close); × or Esc dismisses it; it never blocks the app.

| Moment | Signal (`onEvent` from the vault) | Line on top |
|---|---|---|
| Their own first source has become notes | `source-processed` with `own: true`, the first time | Your notes live only in this browser. Keep them? |
| A big source | `source-added` split into 2+ parts, or too long for one AI read | Big files are slow here. The full vault handles them. |
| A large vault | `source-processed` with 200+ notes in the vault | Your vault is growing. It will get slow here. |

The tour's last step is the fourth moment (table above). The thresholds are constants in one place in
the landing, so they can be tuned without touching the package.

### 6. Measuring the funnel *(my call)*

The landing sends Umami events (`umami.track`) — names and small numbers only. The vault's part reaches
the landing through `onEvent`; the landing alone talks to Umami.

| Event | Data | Step |
|---|---|---|
| (page view, exists) | — | opened /try |
| `try-understood` | — | read the welcome |
| `try-tour-start` / `try-tour-end` / `try-tour-done` | `{ step }` on end | toured |
| `try-ai-connected` | `{ kind: "openrouter" \| "local" }` | connected an AI |
| `try-source-added` | `{ parts }` | added their own source |
| `try-source-processed` | `{ notes }` rounded to tens | their source became notes |
| `try-nudge` | `{ moment }` | saw a nudge |
| `try-cloud` / `try-contact-sent` / `try-desktop` | `{ from: "welcome" \| "corner" \| "nudge-<moment>" \| "tour-end" }` | took the way up |

Read as a funnel: opened → understood → engaged (tour, AI, own source) → took the way up, and which
moment led there. The contact form's `page` field carries the same `from`, so the team sees in each
request where it started.

### 7. The vault package's part

- `data-tour` attributes on: the six places, the chat's connect area, the notes list's first card, a
  note's Links and History tabs, the Topics list, the graph, the Sources › Timeline tab, Add sources,
  Search, the settings menu's Processing queue and Health check items (and their opened views), and the
  corner banner.
- `BrowserVault` props:
  - `bannerActions?: ReactNode` — rendered inside the corner banner, before Reset.
  - `onReady?(ready: { guideIds; open(documentId: string): void })` — the landing waits for it before
    offering the tour, and opens the chosen guide note with `open`.
  - `onEvent?(event: TryEvent)` — `{ type: "ai-connected"; kind }`, `{ type: "source-added"; parts;
    oneRead: boolean }`, `{ type: "source-processed"; notes; own }`. Facts only, no copy and no
    analytics in the package.

## Settled after review

- **When it ships:** with the browser pipeline, built after it on the same branch
  (`feat/try-pipeline`) and released in the same package version — the tour's steps 11–13 and the
  nudges show the pipeline's results. *(conversation)*
- **"Where does my data go":** the welcome says nothing is saved on *our* servers and the vault is
  stored only in this browser — true whatever AI is connected — and the AI step says what you ask and
  add goes to the AI you connect. The welcome never claims nothing leaves the computer. *(my call)*
- **Which note the tour opens:** a chosen guide note via `guideIds`, else the first card. *(my call)*
- **The preview is a funnel:** prominent warning first, the way up always in the corner and at the
  moments above. *(meeting)*

## Needs your answer

1. **The cloud path's destination.** The landing's Pricing lists "Open source" and "With us"; there is
   no hosted plan to buy yet. Until there is, **Cloud vault** opens the contact form. If a sign-up or
   checkout page exists, its link replaces the form — one constant.
2. **Funnel events in Umami** (§6) — names and small numbers, never content, do-not-track honoured.
   Yes or no.
3. **The desktop app's offer.** The landing presents it as a free download; the meeting said "purchase".
   The copy stays "Desktop app — on your own computer" with no price unless you say otherwise.

## Left to the builder

- The tour engine (hand-written or a small library) — it must meet the look, the anchors, the 2 s skip
  and the recompute rules above.
- How the scoped stylesheet is produced and how the contact form is shared between the landing page and
  /try without copying its logic.
- Exact arrow drawing, card placement rules, and where the nudge card sits relative to the tour card.
- Tests: unit tests for step progression and persistence, and for the nudge rules (each once, none during
  the tour or a modal); a headless run of the whole tour against /try (every step finds its target or
  skips); the welcome's and the corner's forms posting to a stubbed `/api/demo-request` with the right
  `page`; the events fired with no content in them; and a check that /try's vault screens look unchanged
  with the welcome's CSS loaded.
