# Plan: Semantic Graph Layout for GraphView

## Context

The knowledge graph view (`editors/knowledge-vault/components/GraphView.tsx`, 1099 lines) uses `cytoscape-cose-bilkent` force-directed layout. It reshuffles all node positions on every remount (tab switch, new doc, open/close), shows no semantic clustering, and MOC hubs don't visually organize their topic clusters. The user wants viewers to see relationships and structure from the layout itself.

## Approach: 4 incremental steps (each independently testable)

### Step 1: Replace cose-bilkent with fcose + fix useMemo deps

`cytoscape-fcose@2.2.0` is the direct successor — 2x faster, supports compound nodes and layout constraints needed for Steps 3-4.

**package.json** (use `bun` for all install/build/check commands):
- `bun remove cytoscape-cose-bilkent && bun add cytoscape-fcose`

**GraphView.tsx:**
- Replace import: `coseBilkent` → `fcose` (line 5), remove `@ts-expect-error`
- Replace registration: `cytoscape.use(fcose)` (line 11)
- Replace `getLayoutOptions()` (lines 411-425): `name: "fcose"`, function-form params (`nodeRepulsion: () => 6000` etc.)
- Fix `useMemo` deps (line 450): add `mocs, tensions` to dependency array

### Step 2: Position persistence via localStorage

Eliminates reshuffling by saving/restoring positions. Positions are presentation state → localStorage, not the document model.

**Add to GraphView.tsx:**
- `loadPositions()` / `savePositions(cy)` / `clearStoredPositions()` helpers using `localStorage` key `"bai-graph-positions"`
- Storage format: `Record<string, { x: number; y: number }>`

**Modify `getLayoutOptions(opts?)`:**
- Accept `savedPositions` and `newNodeIds` params
- If all nodes have saved positions → use `preset` layout (instant)
- If some nodes are new → use fcose with `fixedNodeConstraint` to pin existing nodes, layout only new ones
- If no positions → full fcose layout with `randomize: true`

**Modify `useEffect` (lines 524-601):**
- Load positions on mount, detect new nodes
- Save positions on `layoutstop` and `dragfree` events

**Modify `handleRelayout` (line 664):**
- Call `clearStoredPositions()` then run full fcose layout, save on completion

### Step 3: MOC compound nodes for topic clustering

fcose natively groups children inside parent bounding boxes. Restructure MOCs as compound parent nodes.

**In `buildElements` (lines 96-276):**
- Build `noteToMocParent` map: assign each note to the MOC that references it most via `coreIdeas` (one parent per note — Cytoscape limitation)
- Set `parent: mocId` on note elements that belong to a MOC
- MOC nodes with children → compound parents (rounded rectangle, faint purple fill, dashed border)
- MOC nodes without children → keep diamond shape
- Only create explicit CORE_IDEA edges for notes NOT parented to that MOC (parented notes are already visually inside)

**In `cyStylesheet`:**
- Replace single `node[?isMoc]` selector (lines 320-332) with two:
  - `node[?isCompound]:parent` → rounded rectangle, faint purple background, dashed border, label on top
  - `node[?isMoc]:childless` → diamond shape (existing behavior)

### Step 4: Relative placement constraints for directional edges

Apply top-down hierarchy for BUILDS_ON and DERIVED_FROM edges.

**Add `buildRelativePlacementConstraints(elements)` function:**
- Scans edges for BUILDS_ON / DERIVED_FROM link types
- Returns `[{ top: sourceId, bottom: targetId, gap: 100 }]` array

**Pass to fcose layout:**
- `relativePlacementConstraint` option in `getLayoutOptions`
- Source notes appear above their dependent notes

## Files to modify

| File | Changes |
|------|---------|
| `package.json` | Swap `cytoscape-cose-bilkent` → `cytoscape-fcose` |
| `editors/knowledge-vault/components/GraphView.tsx` | All 4 steps |

## Build & check commands (always use bun)

```bash
bun install                  # install deps after package.json changes
bun tsc --noEmit             # type check
bun eslint <file>            # lint
bun prettier --write <file>  # format
```

## Verification

1. **After Step 1:** `bun tsc --noEmit` passes. Graph renders with same visual appearance, all interactions work (hover, click, highlight, zoom, re-layout). Check that MOC diamonds and tension triangles still render correctly.
2. **After Step 2:** Switch tabs and return — positions preserved. Add a new note — only new node repositions. Click "Re-layout" — full recomputation. Drag a node — position persists.
3. **After Step 3:** Notes belonging to MOCs cluster visually inside faint purple rectangles. MOCs with no assigned notes keep diamond shape. Cross-cluster edges render correctly.
4. **After Step 4:** Notes connected by BUILDS_ON or DERIVED_FROM arrange top-to-bottom. Other notes unaffected.
5. **Scale test:** Verify with current 38 notes + 6 MOCs, and mentally validate that 500+ node behavior would be reasonable.
6. **Final check:** `bun tsc --noEmit && bun eslint editors/knowledge-vault/components/GraphView.tsx`
