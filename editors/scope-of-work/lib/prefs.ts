/** Browser-local chrome prefs for the Scope of Work editor. Not document state. */

export type InspectorLayout = "modal" | "sidebar";

const INSPECTOR_LAYOUT_KEY = "sow:inspector-layout";

/** Default is modal. Only an explicit "sidebar" choice docks the inspector. */
export function readInspectorLayout(): InspectorLayout {
  try {
    return globalThis.localStorage.getItem(INSPECTOR_LAYOUT_KEY) === "sidebar"
      ? "sidebar"
      : "modal";
  } catch {
    return "modal";
  }
}

export function writeInspectorLayout(layout: InspectorLayout): void {
  try {
    globalThis.localStorage.setItem(INSPECTOR_LAYOUT_KEY, layout);
  } catch {
    // a blocked localStorage only loses the memory of the preference
  }
}

const RAIL_OPEN_KEY = "sow:rail-open";

/** Outline rail starts open. Only an explicit "0" hides it. */
export function readRailOpen(): boolean {
  try {
    return globalThis.localStorage.getItem(RAIL_OPEN_KEY) !== "0";
  } catch {
    return true;
  }
}

export function writeRailOpen(open: boolean): void {
  try {
    globalThis.localStorage.setItem(RAIL_OPEN_KEY, open ? "1" : "0");
  } catch {
    // a blocked localStorage only loses the memory of the preference
  }
}
