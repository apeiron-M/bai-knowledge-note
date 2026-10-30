// M5: the sheet's manifest is the vault's models plus nl-drive's
// document-drive ops (`VAULT_SHEET_MANIFEST`). The drive ops join a
// document's step-1 list on a drive word; Kev and the trie must take that
// mixed list for every vault document type.
import { describe, expect, it } from "vitest";
import { DOCUMENT_DRIVE_OPS, DRIVE_DOCUMENT_TYPE } from "nl-drive";
import { answersFor, kevRequest, scopedCandidates, stepOneScope } from "nl-runtime";
import { VAULT_ARTIFACTS } from "../../editors/knowledge-vault/chat/vault-artifacts.js";
import {
  VAULT_DOCUMENT_TYPES,
  VAULT_MANIFEST,
  VAULT_SHEET_MANIFEST,
} from "../../editors/knowledge-vault/chat/vault-manifest.js";

const M = VAULT_SHEET_MANIFEST;
const docTypes = [...new Set(VAULT_MANIFEST.catalog.map((e) => e.docType))];
const target = (docType: string) => ({
  kind: "document" as const,
  id: "doc",
  driveId: "drive",
  title: "A note",
  docType,
});

describe("the sheet's manifest", () => {
  it("is the vault's catalog, then the seven document-drive ops on the client executor", () => {
    expect(M.catalog.slice(0, VAULT_MANIFEST.catalog.length)).toEqual(VAULT_MANIFEST.catalog);
    const drive = M.catalog.slice(VAULT_MANIFEST.catalog.length);
    expect(drive.map((e) => e.key).sort()).toEqual([...DOCUMENT_DRIVE_OPS].sort());
    expect(drive.every((e) => e.docType === DRIVE_DOCUMENT_TYPE)).toBe(true);
    for (const k of DOCUMENT_DRIVE_OPS) expect(M.executors?.[k]).toBe("client");
    expect(M.typeLabels[DRIVE_DOCUMENT_TYPE]).toBe("drive");
  });

  it("offers ADD_FILE only installed vault types", () => {
    for (const t of VAULT_DOCUMENT_TYPES) expect(docTypes).toContain(t.id);
  });

  it("the shipped answer table covers every drive op (the trie scores the mixed list)", () => {
    const table = VAULT_ARTIFACTS.artifacts.lora.answerTable;
    expect(answersFor([...DOCUMENT_DRIVE_OPS], table)).toHaveLength(DOCUMENT_DRIVE_OPS.length + 1);
  });

  it.each(docTypes)("%s: a drive word adds the drive ops, and Kev takes the mixed list", (docType) => {
    const own = scopedCandidates(M.catalog, docType);
    expect(stepOneScope(M.catalog, target(docType), "tag this with ML", { ops: DOCUMENT_DRIVE_OPS })).toEqual(own);
    const mixed = stepOneScope(M.catalog, target(docType), "make a folder called Archive", {
      ops: DOCUMENT_DRIVE_OPS,
    });
    expect(mixed.map((e) => e.key)).toEqual([...own.map((e) => e.key), ...DOCUMENT_DRIVE_OPS]);
    // no Kev option name clashes, and every op has option text
    const req = kevRequest("make a folder called Archive", mixed, M.opDescriptions, { mixed: true });
    expect(req.keys).toEqual(mixed.map((e) => e.key));
  });
});
