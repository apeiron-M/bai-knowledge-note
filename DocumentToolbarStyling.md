# DocumentToolbar Styling Guide

How to customize the `DocumentToolbar` component from `@powerhousedao/design-system/connect` to match a custom theme.

## Overview

The `DocumentToolbar` has three layers of styling control:

| Layer | What it affects | How |
|-------|----------------|-----|
| Container | Toolbar background, border, rounding | `className` prop (uses `twMerge`) |
| Buttons inside | Undo/redo/export/history/close buttons | CSS child selectors via `className` |
| Revision History panel | Opened by the history button | CSS in `style.css` scoped to `#document-editor-context` |

## 1. Container styling via `className`

The toolbar accepts a `className` prop that merges with the defaults using `twMerge`. The default classes are:

```
flex h-12 w-full items-center justify-between rounded-xl border border-gray-200 bg-slate-50 px-4
```

Override them directly:

```tsx
<DocumentToolbar className="!bg-[#181825] !border-white/10" />
```

The `!` prefix ensures your classes win over the defaults via `twMerge`.

## 2. Button styling via child selectors

The buttons inside don't have their own props. They use hardcoded classes:

- **Undo/Redo/History/Close buttons**: `border-gray-200 bg-white` with `Icon` children using `text-gray-900` or `text-gray-500`
- **Export button**: Same pattern plus a `<span>` for the label
- **Document name**: `<h1>` with `text-gray-500`

Target them with Tailwind arbitrary child selectors in the `className` prop:

```tsx
<DocumentToolbar
  className={[
    // Container
    "!bg-[#181825] !border-white/10",
    // Button backgrounds and borders
    "[&_button]:!bg-[#1e1e2e] [&_button]:!border-white/10",
    "[&_button:hover]:!bg-[#313244]",
    // Icons inside buttons
    "[&_button_svg]:!text-gray-400 [&_button:hover_svg]:!text-gray-200",
    // Text inside buttons (Export label)
    "[&_span]:!text-gray-400 [&_button:hover_span]:!text-gray-200",
    // Document title
    "[&_h1]:!text-gray-400 [&_h1:hover]:!text-gray-200",
  ].join(" ")}
/>
```

### Selector reference

| Selector | Targets |
|----------|---------|
| `[&_button]` | All buttons (undo, redo, export, history, close) |
| `[&_button_svg]` | Icons inside buttons |
| `[&_button_span]` | Text labels inside buttons (e.g. "Export") |
| `[&_h1]` | Document name in the center |
| `[&_button:hover]` | Hover state for buttons |
| `[&_button:disabled_svg]` | Disabled button icons |

## 3. Revision History panel styling

The revision history panel is rendered by Connect (not your editor) when the user clicks the history button. It lives inside `#document-editor-context` in the DOM.

Since there are no props to style it, use CSS in your project's `style.css`:

```css
/* Scope to your document type to avoid affecting other editors */
#document-editor-context[data-document-type="your/document-type"] {
  background-color: #1e1e2e;
  color: #cdd6f4;
}

/* Header pills (DOC ID, BRANCH, scope selector) */
#document-editor-context[data-document-type="your/document-type"] .bg-slate-50,
#document-editor-context[data-document-type="your/document-type"] [class*="bg-gray-50"] {
  background-color: #313244 !important;
  color: #a6adc8 !important;
}

/* Revision cards */
#document-editor-context[data-document-type="your/document-type"] article {
  background-color: #1e1e2e !important;
  border-color: rgba(255, 255, 255, 0.1) !important;
}

/* Timeline content area */
#document-editor-context[data-document-type="your/document-type"] .rounded-md.bg-slate-50 {
  background-color: #181825 !important;
}

/* Timeline left border */
#document-editor-context[data-document-type="your/document-type"] .border-slate-100 {
  border-color: rgba(255, 255, 255, 0.1) !important;
}

/* Day separator headers */
#document-editor-context[data-document-type="your/document-type"] h2.bg-slate-50 {
  background-color: #181825 !important;
}

/* Text color overrides */
#document-editor-context[data-document-type="your/document-type"] .text-gray-900 {
  color: #cdd6f4 !important;
}
#document-editor-context[data-document-type="your/document-type"] .text-stone-300 {
  color: #a6adc8 !important;
}
#document-editor-context[data-document-type="your/document-type"] .text-gray-600 {
  color: #7f849c !important;
}

/* Border overrides */
#document-editor-context[data-document-type="your/document-type"] .border-gray-200 {
  border-color: rgba(255, 255, 255, 0.1) !important;
}
#document-editor-context[data-document-type="your/document-type"] .bg-white {
  background-color: #1e1e2e !important;
}
```

Replace `your/document-type` with your actual document type (e.g. `bai/knowledge-note`).

### Revision History internal structure

```
#document-editor-context[data-editor][data-document-type]
└── div.p-6                              ← main container
    ├── header                           ← top bar
    │   ├── button[name="close-revision-history"]  ← back arrow
    │   ├── h1                           ← document title
    │   ├── button.bg-slate-50           ← DOC ID pill
    │   ├── button.bg-slate-50           ← BRANCH pill
    │   └── div[id="scope select"]       ← scope dropdown
    ├── div.rounded-md.bg-slate-50       ← timeline content area
    │   └── div.border-slate-100         ← timeline with left border
    │       ├── h2.bg-slate-50           ← day separator ("Changes on Mar 26")
    │       └── article.bg-white         ← revision card (repeated)
    │           ├── RevisionNumber       ← "Revision 26."
    │           ├── Operation            ← "SET_CONTENT"
    │           ├── Timestamp            ← "committed at 13:56 UTC"
    │           ├── Signature            ← "1/1 signature verified"
    │           └── Errors               ← "No errors"
    └── div (pagination, if needed)
```

## Available `DocumentToolbar` props

```typescript
type DocumentToolbarProps = {
  className?: string;                          // CSS classes (merged via twMerge)
  enabledControls?: DocumentToolbarControl[];   // Which buttons to show
  // Default: ["undo", "redo", "export", "history"]
  // Available: "undo" | "redo" | "export" | "history" | "timeline"
  disableRevisionHistory?: boolean;            // Disable history button
  onExport?: (document: PHDocument) => void;   // Custom export handler
  onClose?: () => void;                        // Custom close handler
  onSwitchboardLinkClick?: () => void;         // Custom switchboard handler
  initialTimelineVisible?: boolean;            // Show timeline on mount
  defaultTimelineVisible?: boolean;            // Show timeline toggle button
  document?: PHDocument;                       // Override selected document
};
```

## Full dark theme example

See `editors/knowledge-note-editor/editor.tsx` and `style.css` in this project for a complete Catppuccin Mocha dark theme implementation covering the toolbar, buttons, and revision history.
