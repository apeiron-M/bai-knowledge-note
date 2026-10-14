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
