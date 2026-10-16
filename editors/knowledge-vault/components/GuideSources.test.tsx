import { describe, expect, it } from "vitest";
import {
  CREATE_ITEMS,
  GUIDE_PLACES,
  PLACE_VIEW,
  VAULT_MENU,
} from "./DriveExplorer.js";

describe("what the Getting started guide is built from", () => {
  it("lists every place the sidebar can show, Contradictions included, in the sidebar's order", () => {
    expect(GUIDE_PLACES.map((p) => p.id)).toEqual([
      "ask",
      "notes",
      "topics",
      "sources",
      "work",
      "graph",
      "contradictions",
    ]);
    expect([...GUIDE_PLACES.map((p) => p.id)].sort()).toEqual(
      Object.keys(PLACE_VIEW).sort(),
    );
  });

  it("exposes the vault menu and the create items with their labels", () => {
    expect(VAULT_MENU.map((i) => i.label)).toEqual([
      "Vault settings",
      "Who has access",
      "Processing queue",
      "Activity",
      "Health check",
      "Files and folders",
    ]);
    expect(CREATE_ITEMS.map((i) => i.label)).toEqual([
      "Write a note",
      "New topic",
      "Paste text as a source",
    ]);
  });
});
