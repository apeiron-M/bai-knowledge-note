import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The `data-tour` anchors the landing's guided tour finds the vault's controls by
 * (knowledge-vault-landing, app/(try)/try/onboarding/rules.ts). A contract: renaming
 * one here without the tour's step skips that step for every visitor.
 */
const ANCHORS: Record<string, string[]> = {
  "editors/knowledge-vault/components/VaultPlaces.tsx": ["data-tour={`place-${place.id}`}"],
  "editors/knowledge-vault/components/VaultSidebar.tsx": ['data-tour="search"', 'data-tour="add-sources"', 'data-tour="settings"'],
  "editors/knowledge-vault/components/VaultMenu.tsx": ["data-tour={item.tour}"],
  "editors/knowledge-vault/components/DriveExplorer.tsx": ['tour: "settings-queue"', 'tour: "settings-health"', "data-tour={`sources-${tab.key}`}"],
  "editors/knowledge-vault/components/NoteList.tsx": ['tour={index === 0 ? "note-card" : undefined}', "data-tour={tour}"],
  "editors/knowledge-vault/components/chat/ChatConnectPanel.tsx": ['data-tour="ai-connect"'],
  "editors/knowledge-note-editor/editor.tsx": ["data-tour={`note-${key}`}"],
  "browser/BrowserVault.tsx": ['data-tour="corner"'],
};

describe("the tour's anchors", () => {
  for (const [file, anchors] of Object.entries(ANCHORS)) {
    it(`are in ${file.split("/").pop()}`, () => {
      const source = readFileSync(file, "utf8");
      for (const anchor of anchors) expect(source, anchor).toContain(anchor);
    });
  }
});
