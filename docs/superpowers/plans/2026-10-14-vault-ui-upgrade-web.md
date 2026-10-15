# Vault UI Upgrade (web app) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `editors/knowledge-vault` in line with `docs/design/vault-view/final.html` — starting with the theme tokens, then the shell frame, then the sidebar, then the landing view — so the vault reads as one designed surface instead of a tab row plus four sidebar sections.

**Architecture:** The design HTML is a proposal, not code to copy. This plan ports its *decisions* — token values, a three-layer surface model, one labelled sidebar, one question box as the front door — into the existing React shell, reusing every hook that already reads the vault. Data is untouched: the plan adds no fetching. Each task is independently shippable and reversible, and the last task puts the mock's contrast gate onto the real app so Task 1's correction cannot silently regress.

**Tech Stack:** React 19 (rendered through Connect), Tailwind utilities + inline `style={{}}` with `var(--bai-*)`, TypeScript, Vitest + `renderToStaticMarkup` (node environment — no jsdom in `vitest.config.ts`, so nothing observable depends on layout), oxlint, Playwright for the one theme gate.

**Spec:** `docs/design/vault-view/README.md` and `docs/design/vault-view/final.html`. The README's "Light theme and contrast" section is the authority for every colour value below; its findings 1–14 are the authority for what changes structurally.

## Global Constraints

- **Theme blocks are selector lists, not single selectors.** `style.css:26-28` (dark) is `.bai-theme, [data-bai-theme="dark"], html[data-bai-toast-theme="dark"]`; `style.css:66-68` (light) is `[data-bai-theme="light"], html[data-bai-toast-theme="light"]` — note light has **no** `.bai-theme`. Any block added by this plan **must repeat the selector list of the block it extends**, so `.bai-theme` subtrees and the toast surface get the `--v-*` roles too.
- **Dark must stay pixel-identical to today.** The README states dark "resolves every new role to today's values". Exactly one existing dark token moves: `--bai-text-muted`.
- **Every colour is a token.** No literal hex or rgba in TSX. Values live in `style.css` only.
- **No new data.** This plan adds no fetches and no hooks. `useKnowledgeNotes`, `useKnowledgeMocs`, `useKnowledgeTensions`, `useVaultName`, `useFileNodesInSelectedDrive` and the counts `DriveExplorer` already derives are the only sources.
- **No host contract changes.** `ViewMode` keeps its `"chat"` and `"search"` members; `OPENABLE_VIEWS` and `takeOpenView`'s once-per-drive read stay as they are. `"ask"` is a *place id* that maps to `viewMode: "chat"`, never a renamed member.
- **No feature is removed before its replacement is live.** The section tabs stay in the code, unrendered, until Task 4 deletes them.
- **Every task passes `npm run tsc`, `npm run lint:fix`, `npm run test`.** Line anchors below were checked against `ui-upgrade` and are accurate as written.

## Review Focus

1. **A 1060 px window** — Expect: the sidebar column drops to 220 px, the host bar and places list stay readable, nothing clips. Not unit-observable (node environment, no jsdom); pinned by Task 6's browser pass.
2. **A vault with zero topics** — Expect: Ask's topic chips are omitted entirely, not rendered empty. → Task 5
3. **A vault with zero notes** — Expect: sidebar counts are omitted, never a bare `0`. → Task 3
4. **Opening a scope of work, then switching theme** — Expect: its rail re-themes with everything else and still reaches the top of the window. → Task 2
5. **`prefers-color-scheme` flipping while the vault is open** — Expect: repaint, no reload, no flash of the wrong theme. The attribute is driven by `editors/shared/theme-context.tsx` from Connect's provider, not by `style.css`; pinned by Task 6's browser pass.

---

## File Structure

| File | Responsibility |
|---|---|
| `style.css` | The only place a colour value is written. Extends the existing two theme blocks with the `--v-*` surface roles. |
| `editors/knowledge-vault/lib/theme.ts` (new) | The role *names* the shell styles against, so a typo in a `var(--…)` is a compile error. |
| `editors/knowledge-vault/lib/theme-contrast.test.ts` (new) | Parses `style.css`, computes WCAG contrast for the pairs the shell renders, fails the build when one drops below its floor. |
| `editors/knowledge-vault/components/VaultShell.tsx` (new) | The frame: host bar over a sidebar column and a content column. Owns the grid; knows nothing about notes. |
| `editors/knowledge-vault/components/VaultPlaces.tsx` (new) | The labelled places list alone. No fetching; counts arrive as props. |
| `editors/knowledge-vault/components/VaultContextList.tsx` (new) | The sidebar's "follows what you're in" mode. Presentational, plus a pure `stepId`. |
| `editors/knowledge-vault/components/AskView.tsx` (new) | The landing: question box, largest topics, what changed. |
| `editors/knowledge-vault/components/VaultSidebar.tsx` | Publishes its own width; delegates its body to `VaultPlaces` / `VaultContextList`. |
| `editors/knowledge-vault/components/DriveExplorer.tsx` | Keeps owning data and view routing. Delegates the frame to `VaultShell`. |

`VaultShell`, `VaultPlaces`, `VaultContextList` and `AskView` are extracted rather than grown because `DriveExplorer.tsx` is 1023 lines and `VaultSidebar.tsx` 1329; adding to them without a seam makes every later task a merge conflict.

---

### Task 1: Theme tokens — the AA corrections and the layering roles

The design's largest finding is that light fails contrast in 776 places and has no depth: canvas `#f8f9fc` against cards `#fff` is 1.04:1, so the eye finds no edges. This task fixes the palette and introduces the three surface layers everything else sits on. Nothing else can be judged until it lands.

**Files:**
- Modify: `style.css:26-97` (the two theme blocks) and append a role block after each
- Create: `editors/knowledge-vault/lib/theme.ts`
- Test: `editors/knowledge-vault/lib/theme-contrast.test.ts`

**Interfaces:**
- Consumes: nothing. First task.
- Produces: CSS custom properties `--v-rail`, `--v-rail-hover`, `--v-rail-current`, `--v-rail-current-soft`, `--v-rail-current-shadow`, `--v-raise`, `--v-input`, `--v-panel`, `--v-read`, `--v-note`, `--v-map`, `--v-line`, `--v-review`, `--v-field`, `--v-sky`; corrected `--bai-*` values. Tasks 2–5 style against these.
  Deliberately **not** produced: `--v-shadow`, `--v-scrim`, `--v-outside`. They exist in the mock but are app-shell concerns, and this plan ports the vault, not the desktop app.

- [ ] **Step 1: Write the failing contrast test**

Create `editors/knowledge-vault/lib/theme-contrast.test.ts`. It reads `style.css` with `node:fs` and **merges every block that matches a theme's selector list into one map per theme** — Task 1 adds a second block per theme, so a parser that stops at the first `}` returns `undefined` for every `--v-*` role and the test cannot pass. Merge by scanning every `{ … }` in the file and attributing it to a theme when its selector list mentions that theme.

It resolves `color-mix(a X%, b)` against `b`, then asserts:

```ts
// Text on the surface it sits on. Floors: 4.5 for body, 3 for icons/outlines.
const LIGHT_TEXT_PAIRS: Array<[string, string, number]> = [
  ["--bai-text", "--v-rail", 4.5],
  ["--bai-text-secondary", "--v-rail", 4.5],
  ["--bai-text-tertiary", "--v-rail", 4.5],
  ["--bai-text-muted", "--v-rail", 4.5],
  ["--bai-text-secondary", "--bai-surface", 4.5],
  ["--bai-text-tertiary", "--bai-surface", 4.5],
  ["--bai-text-muted", "--bai-surface", 4.5],
  ["--bai-text-tertiary", "--bai-bg", 4.5],
  ["--bai-text-muted", "--bai-bg", 4.5],
  ["--bai-accent", "--v-rail", 3],
  ["--v-field", "--v-rail", 3],
  ["--bai-warn", "--bai-warn-soft", 4.5],
  ["--bai-ok", "--bai-ok-soft", 4.5],
  ["--bai-danger", "--bai-danger-soft", 4.5],
];
```

plus the same table for dark, and one structural test for light: `lstar(--bai-bg)` and `lstar(--bai-surface)` differ by ≥ 5; `lstar(--v-rail) ≤ lstar(--bai-bg) − 5`; `lstar(--v-read) ≤ lstar(--bai-surface) − 5`. That last is the README's "no surface sits within 5 L\* of what is behind it".

Name them `it("light: every text pair clears its floor")`, `it("dark: every text pair clears its floor")`, `it("light: the three layers separate by 5 L* or more")`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run editors/knowledge-vault/lib/theme-contrast.test.ts`
Expected: FAIL — `--v-rail` undefined, and light `--bai-text-muted` on `--bai-bg` is 2.1:1 against the required 4.5.

- [ ] **Step 3: Write the token-contract tests**

Same file, so a later hand-edit cannot quietly undo the pass:

```ts
it("light carries the AA-corrected values", () => {
  expect(light["--bai-text-tertiary"]).toBe("#565c69");
  expect(light["--bai-text-muted"]).toBe("#5b6270");
  expect(light["--bai-accent"]).toBe("#732dec");
  expect(light["--bai-warn"]).toBe("#945104");
  expect(light["--bai-ok"]).toBe("#04704e");
  expect(light["--bai-danger"]).toBe("#c01d1d");
  expect(light["--v-note"]).toBe("#275cc5");
  expect(light["--v-review"]).toBe("#1555e2");
  expect(light["--v-field"]).toBe("#747d95");
});

it("dark changes one text token and nothing else", () => {
  expect(dark["--bai-text-muted"]).toBe("#979da8");
  expect(dark["--bai-text-tertiary"]).toBe("#9ca3af");
  expect(dark["--bai-accent"]).toBe("#cba6f7");
});

it("every role is defined in both themes", () => {
  for (const name of Object.values(ROLE)) {
    expect(light[name], `light ${name}`).toBeTruthy();
    expect(dark[name], `dark ${name}`).toBeTruthy();
  }
});
```

- [ ] **Step 4: Apply the corrections to `style.css`**

Inside the existing **light** selector list replace: `--bai-bg` → `#edf0f5`; `--bai-deep` → `#ffffff`; `--bai-hover` → `#e4e8ef`; `--bai-border` → `#d7dbe3`; `--bai-text-tertiary` → `#565c69`; `--bai-text-muted` → `#5b6270`; `--bai-accent` → `#732dec`; `--bai-accent-soft` → `rgba(124, 58, 237, 0.105)`; `--bai-warn` → `#945104`; `--bai-warn-soft` → `rgba(217, 119, 6, 0.15)`; `--bai-ok` → `#04704e`; `--bai-ok-soft` → `rgba(5, 150, 105, 0.13)`; `--bai-danger` → `#c01d1d`.

Inside the existing **dark** selector list change exactly one line: `--bai-text-muted` → `#979da8`.

Then append one role block per theme, **each repeating that theme's full existing selector list** so `.bai-theme` and the toast theme get the roles too:

```css
/* Layering roles. Light separates the three surfaces the eye navigates by —
   canvas, raised card, rail — each ≥5 L* from what it sits on. Dark resolves
   every role to today's value, so nothing moves. */
.bai-theme,
[data-bai-theme="dark"],
html[data-bai-toast-theme="dark"] {
  --v-rail: var(--bai-deep);
  --v-rail-hover: color-mix(in srgb, var(--bai-hover) 65%, transparent);
  --v-rail-current: var(--bai-hover);
  --v-rail-current-soft: color-mix(in srgb, var(--bai-hover) 55%, transparent);
  --v-rail-current-shadow: none;
  --v-raise: none;
  --v-input: var(--bai-bg);
  --v-panel: color-mix(in srgb, var(--bai-surface) 50%, var(--bai-bg));
  --v-read: var(--bai-deep);
  --v-note: #89b4fa;
  --v-map: #cba6f7;
  --v-line: rgba(205, 214, 244, 0.14);
  --v-review: #89b4fa;
  --v-field: #7a7d99;
  --v-sky: 0.5;
}

.bai-theme[data-bai-theme="light"],
[data-bai-theme="light"],
html[data-bai-toast-theme="light"] {
  --v-rail: #dbe0ea;
  --v-rail-hover: rgba(255, 255, 255, 0.6);
  --v-rail-current: #ffffff;
  --v-rail-current-soft: #ffffff;
  --v-rail-current-shadow: var(--v-raise);
  --v-raise: 0 1px 2px rgba(16, 24, 40, 0.06), 0 1px 3px rgba(16, 24, 40, 0.07);
  --v-input: #ffffff;
  --v-panel: #ffffff;
  --v-read: #e4e8ef;
  --v-note: #275cc5;
  --v-map: #7c3aed;
  --v-line: rgba(31, 41, 55, 0.16);
  --v-review: #1555e2;
  --v-field: #747d95;
  --v-sky: 0.32;
}
```

Verify BOTH selector lists against `style.css:26-28` and `:66-68` before committing. Dark must include `.bai-theme`; light must NOT (the existing light block has no `.bai-theme` selector). Copy each list verbatim — a wrong attribute selector silently leaves the role block dead for that theme.

- [ ] **Step 5: Create `editors/knowledge-vault/lib/theme.ts`**

```ts
/** The surface roles from style.css. Reference these, never raw strings: a
 *  misspelled token falls back to transparent and reads as "no colour", which
 *  no test would catch. */
export const ROLE = {
  rail: "--v-rail",
  railHover: "--v-rail-hover",
  railCurrent: "--v-rail-current",
  railCurrentSoft: "--v-rail-current-soft",
  railCurrentShadow: "--v-rail-current-shadow",
  raise: "--v-raise",
  input: "--v-input",
  panel: "--v-panel",
  read: "--v-read",
  note: "--v-note",
  map: "--v-map",
  line: "--v-line",
  review: "--v-review",
  field: "--v-field",
} as const;

/** `var(--name)` for a role. */
export const role = (name: keyof typeof ROLE): string => `var(${ROLE[name]})`;
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run editors/knowledge-vault/lib/theme-contrast.test.ts`
Expected: PASS, all tests.

- [ ] **Step 7: Run the full gate**

Run: `npm run tsc && npm run lint:fix && npm run test`
Expected: all pass. The token change alone fixes light-theme contrast globally — this is why no component task carries its own colour edits.

- [ ] **Step 8: Commit**

```bash
git add style.css editors/knowledge-vault/lib/theme.ts editors/knowledge-vault/lib/theme-contrast.test.ts
git commit -m "fix(theme): pass AA contrast and layer the light surfaces"
```

---

### Task 2: The shell frame

Findings 2, 3 and 4: three bars stack before any content and the vault's name appears four times. This task replaces the top bar and the flex row with one named frame. It also settles a question the current code answers implicitly: **the sidebar owns its own width**, and publishes it to the shell as a custom property.

**Files:**
- Create: `editors/knowledge-vault/components/VaultShell.tsx`
- Create: `editors/knowledge-vault/components/VaultShell.test.tsx`
- Modify: `editors/knowledge-vault/components/DriveExplorer.tsx:463-690`
- Modify: `editors/knowledge-vault/components/VaultSidebar.tsx:93-131, 690-729, 756-762`
- Modify: `style.css` (the 220 px breakpoint and the raised-component rule)

**Interfaces:**
- Consumes: `role`, `ROLE` from Task 1.
- Produces:
  ```ts
  export type VaultShellProps = {
    /** Shown in the host bar, left of the controls. */
    title: string;
    /** The content column. Owns its own scrolling. */
    children: ReactNode;
    /** The sidebar column. Omit when `sidebarHidden`. */
    sidebar?: ReactNode;
    /** Set by the sidebar's own width state; the shell only reads it. */
    sidebarWidth?: number;
    /** The scope-of-work editor brings its own rail (DriveExplorer:137). */
    sidebarHidden?: boolean;
    /** Right-hand host-bar controls: processing status, settings. */
    barControls?: ReactNode;
    /** Drop target for files dragged over the whole frame. */
    fileDrop?: { rootProps: Record<string, unknown>; overlay: ReactNode };
  };
  export function VaultShell(props: VaultShellProps): JSX.Element;
  ```

- [ ] **Step 1: Write the failing shell test**

`VaultShell.test.tsx`, following `ChatView.host.test.tsx` (`renderToStaticMarkup`, node environment — so assert on markup and inline custom properties, never on computed layout):

```tsx
it("names the vault in the host bar", () => {
  const html = renderToStaticMarkup(
    <VaultShell title="Liberuum" barControls={<button>All sources read</button>}>
      <p>content</p>
    </VaultShell>,
  );
  expect(html).toContain('class="vault-hostbar"');
  expect(html).toContain("Liberuum");
  expect(html).toContain("content");
});

it("takes the sidebar width from the sidebar, not from itself", () => {
  const html = renderToStaticMarkup(
    <VaultShell title="V" sidebar={<nav>rail</nav>} sidebarWidth={312}><p>c</p></VaultShell>,
  );
  expect(html).toContain("--vault-sidebar-w: 312px");
  // Omitted entirely when the sidebar owns the column (see Step 3).
  const owned = renderToStaticMarkup(
    <VaultShell title="V" sidebar={<nav>rail</nav>} sidebarHidden><p>c</p></VaultShell>,
  );
  expect(owned).not.toContain("--vault-sidebar-w");
});

it("gives the hosted editor's rail its own column and top row", () => {
  const html = renderToStaticMarkup(
    <VaultShell title="V" sidebar={<nav>rail</nav>} sidebarHidden><p>c</p></VaultShell>,
  );
  expect(html).toContain("data-vault-hosts-editor");
  expect(html).toContain("--vault-topbar-h");
  expect(html).toContain('grid-column: 2');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run editors/knowledge-vault/components/VaultShell.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `VaultShell.tsx`**

One `div.vault-frame`, `grid-template-columns: var(--vault-sidebar-w, 236px) minmax(0, 1fr)`. The host bar spans both columns **only when `sidebarHidden` is false**.

When `sidebarHidden` is true, do **not** improvise: copy `DriveExplorer.tsx:487-521` exactly. It sets `data-vault-hosts-editor` (consumed by `editors/scope-of-work/lib/styles.ts:35-37`), pins columns to `var(--sow-rail-w, 0px) minmax(0, 1fr)`, reserves `--vault-topbar-h` as row 1, places the bar at `gridColumn: 2, gridRow: 1`, and spans the content `gridColumn: 1 / -1, gridRow: 1 / -1`. The rail must reach the top of the window; that is the whole point of the arrangement, and the `gridColumn: 2` on the bar exists precisely so the rail keeps row 1.

Two more constraints from the code being copied: the content column carries **no** `z-index` (see the comment at `DriveExplorer.tsx:616-619` — it would open a stacking context and trap the scope-of-work rail toggle), and the bar's `zIndex` is `settingsOpen ? 40 : 5`.

When `sidebarHidden` is false, `sidebarWidth` publishes `--vault-sidebar-w` onto the frame; when it is absent the fallback `236px` applies.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run editors/knowledge-vault/components/VaultShell.test.tsx`
Expected: PASS.

- [ ] **Step 5: Hand the sidebar's width to the shell**

`VaultSidebar` already owns it: `sidebarWidth` state, `DEFAULT_WIDTH`/`MIN_WIDTH`/`MAX_WIDTH` and a drag handle (`VaultSidebar.tsx:93, 108-131, 726-729`), plus a collapsed branch (`:690-714`). Keep all of it. Add an `onWidthChange?: (px: number) => void` prop called from the drag handler, `DriveExplorer` holds that value, and passes it as `sidebarWidth`. The collapse button and its reopen stub are untouched — they stay the only way out of a collapsed sidebar.

Remove the sidebar's own vault-name header (`:756-762`); the name moves to the host bar. Hoist `useVaultName()` from `VaultSidebar.tsx:10` into `DriveExplorer` so one hook call feeds both, and pass `title={vaultName}`.

- [ ] **Step 6: Wire `DriveExplorer` to `VaultShell`**

Replace the `div.flex.h-full` at `:463` and the nested `div[data-vault-hosts-editor]` at `:487` with one `<VaultShell>`. `fileDrop` passes through untouched. The content switch (`:640-690`) moves into `children` unchanged — all seven views render exactly as they do today, so this task is reviewable on its own.

- [ ] **Step 7: Add the breakpoint and raised-component rule to `style.css`**

```css
@media (min-width: 900px) and (max-width: 1179px) { .vault-frame { --vault-sidebar-w: 220px; } }
.vault-frame :is(.vault-hostbar, .vault-sidebar, .vault-card) { box-shadow: var(--v-raise); }
```

- [ ] **Step 8: Run the full gate**

Run: `npm run tsc && npm run lint:fix && npm run test`
Expected: all pass. In Connect, confirm all seven tabs still render, the sidebar still resizes and still collapses, and the scope-of-work editor still reaches the top of the window.

- [ ] **Step 9: Commit**

```bash
git add editors/knowledge-vault/components/VaultShell.tsx editors/knowledge-vault/components/VaultShell.test.tsx editors/knowledge-vault/components/DriveExplorer.tsx editors/knowledge-vault/components/VaultSidebar.tsx style.css
git commit -m "refactor(shell): one frame for the host bar, sidebar and content"
```

---

### Task 3: The sidebar becomes a list of places

Findings 1, 5, 6, 7 and 8: four sidebar sections plus the tab row's Notes are two navigation systems for one thing, ~20 ALL-CAPS kind rows pull the eye, and "MOCs", "Signals" and "Tree" sit at 2.5:1. This task replaces the sections with the places list and retires the duplicate Notes and Search tab entries.

**Files:**
- Create: `editors/knowledge-vault/components/VaultPlaces.tsx`
- Create: `editors/knowledge-vault/components/VaultPlaces.test.tsx`
- Modify: `editors/knowledge-vault/components/VaultSidebar.tsx:86, 785-839, 1020-1022`
- Modify: `editors/knowledge-vault/components/DriveExplorer.tsx:53, 325-460`

**Interfaces:**
- Consumes: `role` from Task 1; `VaultShell` from Task 2.
- Produces:
  ```ts
  export type VaultPlaceId =
    | "ask" | "notes" | "topics" | "sources" | "work" | "graph" | "contradictions";

  export type VaultPlace = {
    id: VaultPlaceId;
    label: string;
    /** Rendered right-aligned. Omit rather than passing 0. */
    count?: number;
    tone?: "warn";
  };

  export type VaultPlacesProps = {
    places: VaultPlace[];
    active: VaultPlaceId;
    onSelect: (id: VaultPlaceId) => void;
    onOpenSettings: () => void;
  };
  export function VaultPlaces(props: VaultPlacesProps): JSX.Element;

  /** place id → the sidebar body that shows when no context overrides it. */
  export const PLACE_SECTION: Record<VaultPlaceId, "none" | "notes" | "topics" | "sources" | "work" | "graph" | "contradictions">;
  ```

  **Precedence, fixed once here so no later task re-decides it:** when `VaultSidebar`'s `context` prop is set, that wins; otherwise `graphFocus` wins; otherwise the body comes from `PLACE_SECTION[place]`. `VaultSidebar` computes the body from that one expression and nothing else decides.

- [ ] **Step 1: Write the failing places test**

```tsx
it("lists the places in the design's order, with the vault's words", () => {
  const html = renderToStaticMarkup(
    <VaultPlaces
      places={[
        { id: "ask", label: "Ask" },
        { id: "notes", label: "Notes", count: 217 },
        { id: "topics", label: "Topics", count: 18 },
        { id: "sources", label: "Sources", count: 98 },
        { id: "work", label: "Work", count: 9 },
        { id: "graph", label: "Graph" },
        { id: "contradictions", label: "Contradictions", count: 2, tone: "warn" },
      ]}
      active="notes" onSelect={() => {}} onOpenSettings={() => {}}
    />,
  );
  expect([...html.matchAll(/data-place="([a-z]+)"/g)].map((m) => m[1]))
    .toEqual(["ask", "notes", "topics", "sources", "work", "graph", "contradictions"]);
  expect(html).not.toMatch(/MOCs|Signals|Tree/);
  expect(html).toContain("217");
  expect(html).toContain('aria-current="page"');
  expect(html).toContain("Vault settings");
});

it("omits a count of zero rather than showing a bare 0", () => {
  const html = renderToStaticMarkup(
    <VaultPlaces places={[{ id: "topics", label: "Topics", count: 0 }]} active="ask"
      onSelect={() => {}} onOpenSettings={() => {}} />,
  );
  expect(html).toContain("Topics");
  expect(html).not.toContain(">0<");
});

it("renders no rows at all when the vault has no places yet", () => {
  const html = renderToStaticMarkup(
    <VaultPlaces places={[]} active="ask" onSelect={() => {}} onOpenSettings={() => {}} />,
  );
  expect(html).not.toContain("data-place=");
  expect(html).toContain("Vault settings");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run editors/knowledge-vault/components/VaultPlaces.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `VaultPlaces.tsx`**

`nav.vault-places` of buttons: each row `height: 34px; border-radius: 8px; color: var(--bai-text-secondary)`, hover `background: var(--v-rail-hover)`, `aria-current="page"` giving `background: var(--v-rail-current); color: var(--bai-text); box-shadow: var(--v-rail-current-shadow)`. A `tone: "warn"` row colours its count `var(--bai-warn)`. "Vault settings" is a footer row with a gear icon, separated by a top border, never interleaved.

Export `PLACE_SECTION` mapping `"ask" → "none"` (the landing has no sidebar body), `"notes" → "notes"`, `"topics" → "topics"`, `"sources" → "sources"`, `"work" → "work"`, `"graph" → "graph"`, `"contradictions" → "contradictions"`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run editors/knowledge-vault/components/VaultPlaces.test.tsx`
Expected: PASS.

- [ ] **Step 5: Swap the section tabs for the places list**

In `VaultSidebar.tsx`, stop rendering the four-button block at `:785-839` and render `<VaultPlaces …>` there. Keep the existing section bodies (`notes`, `mocs`, `signals`, `folders`) and their `section` state at `:86` — Task 4 deletes them; nothing is lost if this step needs reverting. Add a `place?: VaultPlaceId` prop and derive the body with the precedence expression from the Interfaces block.

Finding 8's contrast fix: the sidebar search input's *text* is already `var(--bai-text-secondary)` at `:777`; the unreadable part is the `::placeholder` rule in the component's inline `<style>` at `:1020-1022`. Change that one to `var(--bai-text-muted)`.

- [ ] **Step 6: Build the places list in `DriveExplorer` and retire the duplicate tab entries**

Remove the **Notes** and **Search** entries from `TABS` (`:325-460`). Leave `"search"` in `OPENABLE_VIEWS` (`:53`) — the desktop host still sends `openView: "search"`, and killing it would break a shipped contract this plan does not change.

Build the places array from data already in scope: `notes.length`; `mocs.length`; the `sourceCount` `DriveExplorer` already derives at `:201-203` (do **not** call `useKnowledgeNotes()` for `serverFileNodes` — this component uses `useFileNodesInSelectedDrive()`); `projectCount`; `tensions.length`. Omit `count` where it is 0.

Map each place to a view mode: `ask → "chat"`, `notes → "notes"`, `topics → "notes"` (the MOCs section), `sources → "sources"`, `work → "projects"`, `graph → "graph"`, `contradictions → "tensions"`. The map lives in `DriveExplorer`; `VaultPlaces` never sees a view mode.

- [ ] **Step 7: Run the full gate**

Run: `npm run tsc && npm run lint:fix && npm run test`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add editors/knowledge-vault/components/VaultPlaces.tsx editors/knowledge-vault/components/VaultPlaces.test.tsx editors/knowledge-vault/components/VaultSidebar.tsx editors/knowledge-vault/components/DriveExplorer.tsx
git commit -m "refactor(sidebar): one labelled list of places"
```

---

### Task 4: The sidebar follows what you're in

The design's most-used behaviour: open a source folder, a topic map or a graph node and the sidebar becomes a list of that place's things, with a back control and ↑↓ stepping. `VaultSidebar` already half-does this (`graphFocus`, `:862-998`); this task makes it one pattern and adds keyboard stepping.

**Files:**
- Create: `editors/knowledge-vault/components/VaultContextList.tsx`
- Create: `editors/knowledge-vault/components/VaultContextList.test.tsx`
- Modify: `editors/knowledge-vault/components/VaultSidebar.tsx`

**Interfaces:**
- Consumes: `VaultPlaceId` from Task 3.
- Produces:
  ```ts
  export type VaultContextItem = { id: string; label: string; detail?: string };

  export type VaultContextListProps = {
    place: VaultPlaceId;
    title: string;
    subtitle: string;
    items: VaultContextItem[];
    activeId?: string;
    onOpen: (id: string) => void;
    onBack: () => void;
    /** Above the list: the current node, a link's stated reason. */
    header?: ReactNode;
  };
  export function VaultContextList(props: VaultContextListProps): JSX.Element;

  /** Pure: the id `delta` steps away, wrapping at both ends. */
  export function stepId(ids: string[], current: string | undefined, delta: number): string | undefined;
  ```

- [ ] **Step 1: Write the failing tests**

```tsx
it("steps through the list and wraps at both ends", () => {
  const ids = ["a", "b", "c"];
  expect(stepId(ids, "a", 1)).toBe("b");
  expect(stepId(ids, "c", 1)).toBe("a");
  expect(stepId(ids, "a", -1)).toBe("c");
  expect(stepId(ids, undefined, 1)).toBe("a");     // nothing selected: start at the top
  expect(stepId(ids, undefined, -1)).toBe("c");    // going back: land at the end
  expect(stepId(ids, "gone", 1)).toBe("a");        // stale id must not throw
  expect(stepId([], undefined, 1)).toBeUndefined();
});

it("names the destination in the reader's words and offers stepping", () => {
  const html = renderToStaticMarkup(
    <VaultContextList place="sources" title="State of AI Report 2026"
      subtitle="74 sources, all read" items={[{ id: "s1", label: "A section", detail: "12 notes" }]}
      activeId="s1" onOpen={() => {}} onBack={() => {}} />,
  );
  expect(html).toContain("All sources");
  expect(html).toContain('aria-label="Previous"');
  expect(html).toContain('aria-label="Next"');
  expect(html).toContain("12 notes");
  expect(html).toContain('aria-current="true"');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run editors/knowledge-vault/components/VaultContextList.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `VaultContextList.tsx` and `stepId`**

`stepId` is pure: resolve `current`'s index, add `delta`, wrap with modulo; when `current` is absent or not in the list use `delta > 0 ? 0 : length - 1`; return `undefined` for an empty list.

The component renders a back button whose label comes from `place → backLabel` (`sources → "All sources"`, `topics → "All topics"`, `graph → "Back to the graph"`, `notes → "Back to Notes"`, `contradictions → "All contradictions"`, `ask → "Back to Ask"`, `work → "Back to Work"`), the title and subtitle, an optional `header`, then `role="listbox"` of rows with `aria-current` on the active one.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run editors/knowledge-vault/components/VaultContextList.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire it into `VaultSidebar`**

Add a `context?: { place: VaultPlaceId; title: string; subtitle: string; items: VaultContextItem[]; activeId?: string; onOpen: (id: string) => void; onBack: () => void; header?: ReactNode }` prop. When present it replaces both the places rail and the section body.

Port the existing `graphFocus` path onto it first — it is the only case already built, and the reference for the other three. Then add the key handler: `Alt+ArrowUp` / `Alt+ArrowDown` call `stepId` then `onOpen`, and do nothing when focus is in an input, textarea or contenteditable.

Only once all four sources are reachable, delete the four section buttons and the `section` state from `:86`.

- [ ] **Step 6: Run the full gate**

Run: `npm run tsc && npm run lint:fix && npm run test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add editors/knowledge-vault/components/VaultContextList.tsx editors/knowledge-vault/components/VaultContextList.test.tsx editors/knowledge-vault/components/VaultSidebar.tsx
git commit -m "feat(sidebar): the list follows the place you are in"
```

---

### Task 5: The landing view

Finding 1: the eye lands on ~20 ALL-CAPS kind badges and a gradient headline, not on the one thing the view is for. The design's answer is one raised question box, the vault's three largest topics, and what changed since you were last here.

**The composer stays `ChatView`'s.** `AskView` supplies the heading, the topics and the counts around it; it never reimplements the input. That keeps `ChatView`'s OAuth, draft and `sessionStorage` wiring (`ChatView.tsx:123-134`, `:219-222`) intact.

**Files:**
- Create: `editors/knowledge-vault/components/AskView.tsx`
- Create: `editors/knowledge-vault/components/AskView.test.tsx`
- Modify: `editors/knowledge-vault/components/ChatView.tsx:375, 389-408`
- Modify: `editors/knowledge-vault/components/DriveExplorer.tsx:94, 664-665`
- Modify: `style.css` (the constellation)

**Interfaces:**
- Consumes: `role` from Task 1; `VaultPlaceId`'s `"ask"` from Task 3.
- Produces:
  ```ts
  export type AskViewProps = {
    vaultName: string;
    /** Descending by note count; the view shows the first three. */
    topics: { id: string; title: string; notes: number }[];
    /**
     * What the vault holds right now. Deliberately NOT "since you were
     * last here": there is no last-visit timestamp in this package, and the
     * README defers one to its build step 6.
     */
    counts: { notes: number; topics: number; drafts: number; contradictions: number };
    /** The existing chat, with its own chrome suppressed. */
    chat: ReactNode;
    onOpenTopic: (topicId: string) => void;
    onOpenNotes: () => void;
    onOpenTopics: () => void;
    onOpenContradictions: () => void;
  };
  export function AskView(props: AskViewProps): JSX.Element;
  ```
  and, added to `ChatView`:
  ```ts
  /** Suppress the heading, the topic-chip row, the gradient and the
   *  "N notes · M links" subtitle, leaving the composer. */
  chrome?: "full" | "composer-only";
  ```

- [ ] **Step 1: Write the failing tests**

```tsx
it("leads with one question box, not a wall of badges", () => {
  const html = renderToStaticMarkup(
    <AskView vaultName="Liberuum" topics={[{ id: "t1", title: "Agents", notes: 42 }]}
      counts={{ notes: 217, topics: 18, drafts: 5, contradictions: 2 }}
      chat={<div>composer</div>} onOpenTopic={() => {}} onOpenNotes={() => {}}
      onOpenTopics={() => {}} onOpenContradictions={() => {}} />,
  );
  expect(html).toContain("Ask Liberuum");
  expect(html).toContain("composer");
  expect(html).toMatch(/217 notes/);
  expect(html).toContain("2 open contradictions");
  expect(html).not.toMatch(/OBSERVATION|IN REVIEW|MOC/);
  expect(html).not.toContain("linear-gradient");
  expect(html).not.toMatch(/new notes since/);   // no such data exists yet
});

it("omits the topic chips entirely for a vault with no topics", () => {
  const html = renderToStaticMarkup(
    <AskView vaultName="Learning" topics={[]}
      counts={{ notes: 0, topics: 0, drafts: 0, contradictions: 0 }}
      chat={<div>c</div>} onOpenTopic={() => {}} onOpenNotes={() => {}}
      onOpenTopics={() => {}} onOpenContradictions={() => {}} />,
  );
  expect(html).not.toContain('class="ask-topics"');
  expect(html).not.toContain(">0<");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run editors/knowledge-vault/components/AskView.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `AskView.tsx`**

Three stacked blocks: (1) the heading `Ask {vaultName}` at 22px in `var(--bai-text)`, **no gradient**, over the constellation at `--v-sky`; (2) the topic chips, only when `topics.length > 0`, each a raised piece carrying its note count; (3) one row per count — "217 notes", "18 topics", "5 drafts", "2 open contradictions" — each a button wired to its handler. Then `props.chat`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run editors/knowledge-vault/components/AskView.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add `chrome` to `ChatView`**

`chrome?: "full" | "composer-only"` defaulting to `"full"`. When `"composer-only"`, suppress **all four** chrome pieces — the `#topic` chip row (`:375`, which reads `orientation.topics` and would otherwise stack on top of `AskView`'s), the `h1` (`:399`), the gradient, and the "N notes · M links · read-only" subtitle (`:401-408`) — leaving the composer and the conversation.

`orientation.topics` becomes unused by the renderer but stays in the hook: other callers read it. No behaviour changes when `chrome` is absent, so `ChatView.host.test.tsx` and `ChatView.failure.test.tsx` pass untouched.

- [ ] **Step 6: Wire the landing in `DriveExplorer`**

At the `chat` branch (`:664-665`) render `<AskView … chat={<ChatView chrome="composer-only" … />} />`. Topics come from the existing `mocs` prop sorted by note count; the four counts from `notes.length`, `mocs.length`, `notes.filter(n => n.status === "draft").length`, and `tensions.length`. No fetch.

Make `"chat"` the default `viewMode` — **keep the member name**. `readReturnIntent()` at `:94` sets `viewMode: "chat"` when returning from a document, and the shipped desktop host sends `openView: "chat"`; renaming it would break both.

The landing's three blocks sit above `ChatView`. Once a conversation starts, `ChatView` swaps its whole layout for `inConversation` (`ChatView.tsx:379`) — the heading and topics stay above it, which is the intended reading: the question stays visible above the answer.

- [ ] **Step 7: Run the full gate**

Run: `npm run tsc && npm run lint:fix && npm run test`
Expected: all pass, including both pre-existing `ChatView` test files.

- [ ] **Step 8: Commit**

```bash
git add editors/knowledge-vault/components/AskView.tsx editors/knowledge-vault/components/AskView.test.tsx editors/knowledge-vault/components/ChatView.tsx editors/knowledge-vault/components/DriveExplorer.tsx style.css
git commit -m "feat(ask): one question box as the vault's front door"
```

---

### Task 6: The contrast gate, and the two cases unit tests cannot see

The mock is held to zero contrast failures because two scripts check it. Without the same gate here, Task 1's correction regresses as later tasks add colour. This task points the mock's measurement logic at the real app — and pins the two Review Focus cases that no unit test can observe.

**Files:**
- Create: `docs/design/vault-view/tools/app-contrast-audit.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `npm run test:theme`, which exits non-zero on any finding.

- [ ] **Step 1: Write the audit script**

Copy the **measurement** logic from `docs/design/vault-view/tools/contrast-audit.mjs` unchanged — it already handles see-through layers, opacity and the 4.5/3 floors correctly. Do not reimplement it.

Two things must change, and both are corrections to how the existing script assumes its environment:

1. **Playwright resolution.** The mock script hardcodes `createRequire("/home/beast/Documents/Powerhouse/knowledge-vault-app/package.json")`, and `@playwright/test` is **not** a dependency of this repo. Resolve it from `PH_PLAYWRIGHT_ROOT` (default `../knowledge-vault-app`); if that cannot be resolved, print a one-line skip notice and exit **0**, so the script never blocks a machine without the sibling checkout.
2. **Navigation.** There is no URL into a vault view: `takeOpenView` reads the desktop host's `globalThis` and is guarded to read once per drive (`DriveExplorer.tsx:317-323`), so it does not fire in plain Connect. After Task 3 the places list is the cheapest stable handle — click `[data-place="notes"]`, then `sources`, then `work`, then `graph`, then `ask` — and assert the active view before measuring. Do not add an `openView` host hook; that is the design's build step 2 and out of scope here.

Measure every state at 1449 px and 800 px, in `light` and `dark`.

- [ ] **Step 2: Pin the two browser-only cases in the same script**

Case 1 (1060 px) and Review Focus case 5 (OS theme flip) are layout and provider behaviour — the node test environment cannot observe either, and Task 1's test proves only that both theme blocks are *defined*, not that the app repaints. In the audit script:

- At 1060 px, assert `document.querySelector('.vault-frame')` resolves `--vault-sidebar-w` to `220px`, and that `document.documentElement.scrollWidth <= window.innerWidth`.
- Toggle `data-bai-theme` between `light` and `dark` on a mounted vault, await two animation frames, and assert no element's computed colour is unchanged for a sample of ten text nodes.

Name both clearly in the output so a failure names the case.

- [ ] **Step 3: Add the npm script**

```json
"test:theme": "node docs/design/vault-view/tools/app-contrast-audit.mjs"
```

- [ ] **Step 4: Run it and record the baseline**

Run: `npm run test:theme`
Expected: **non-zero** — the README's audit found labels at 2.5:1 that Tasks 1–5 do not touch. Record the exact count, then fix each offender by moving it to a nearer token (the note editor's title hint, the topic editor's "Core ideas" label and its knowledge-note meta lines, the `"/"` in the top bar — all faint grey used as text) until it exits zero. Do not weaken a floor to make a finding disappear.

- [ ] **Step 5: Run the full gate**

Run: `npm run tsc && npm run lint:fix && npm run test && npm run test:theme`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add docs/design/vault-view/tools/app-contrast-audit.mjs package.json
git commit -m "test: gate the vault's theme on contrast"
```

---

## Explicitly not in this plan

Named so nobody re-litigates them mid-build:

- **The desktop app's Vaults page and Settings** (`knowledge-vault-app`). The design's landing *is* that screen; porting it here would mean porting the app shell. Separate plan, after this one is proven.
- **Notes search, filters, paging, match highlighting** — the design's stage 4. Separate plan; needs the semantic search wired and a virtualised grid.
- **Ctrl K, the vault menu, and folding the five settings screens into one Vault settings view** — design stages 5 and 3. Separate plans.
- **Merging the Projects and Scope tabs into one Work place**, as the mock now does. Task 3 adds the sidebar entry and maps `work → "projects"`; the merge lands as its own task with its own tests.
- **An `openView` host callback** and **a per-vault last-visit timestamp** — the design's stages 2 and 6. Both are assumed absent here, deliberately.

## Self-review

**Spec coverage.** Findings 1, 2, 3, 4, 7, 8 → Tasks 2, 3, 5. Finding 5 (duplicate Notes navigation) → Task 3 Step 6. Light theme and contrast → Task 1 and Task 6. The sidebar-follows-you table → Task 4. The mock's Work place is scoped out above. Findings 9–14 are bugs and contradictions, not shell design.

**Step scan.** Every step names one file, one assertion set or one exact behaviour. No step says "add appropriate tests", and no step names a function another task has not defined.

**Type consistency.** `VaultPlaceId` is defined in Task 3 and consumed by Task 4 (`VaultContextListProps.place`) and Task 5 (`"ask"`). `role`/`ROLE` are defined in Task 1 and used from Task 2 on. `PLACE_SECTION` is exported in Task 3 and consumed by `VaultSidebar` in the same task. `chrome` is added in Task 5 Step 5 and used in Step 6.

**Review Focus.** Case 2 → Task 5's empty-topics test. Case 3 → Task 3's zero-count and empty-places tests. Case 4 → Task 2's `sidebarHidden` test asserts the hosted geometry is preserved verbatim, which is the regression that case describes. Cases 1 and 5 are **not** unit-observable and are pinned in Task 6's browser pass instead — the plan no longer claims a unit test covers them.

**Corrections from the builder check, folded in.** The AskView composer ownership and the `onAsk` dead callback (Task 5 now keeps the composer in `ChatView` and drops `onAsk`); sidebar width ownership and the collapse path (Task 2 Step 5); the host-bar/hosted-rail contradiction (Task 2 Step 3, with the `gridColumn: 2` rule called out as load-bearing); `vaultName` being fetched in two places (Task 2 Step 5 hoists one hook); the selector-list trap that would have left `--v-*` dead for `.bai-theme` and toasts (Global Constraints, Task 1 Step 4); the parser that had to merge blocks per theme (Task 1 Step 1); the three dropped tokens; `serverFileNodes` → the existing `sourceCount`; the placeholder's real location; the Playwright dependency; the `chat` rename; and `OPENABLE_VIEWS["search"]` staying.

**Proportion.** The plan is roughly the length of the README section it implements. Only test assertions, the CSS block Task 1 pastes verbatim, and short type signatures appear — no component bodies.