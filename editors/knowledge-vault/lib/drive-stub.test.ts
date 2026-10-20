import { describe, expect, it } from "vitest";
import {
  hasDrive,
  isVaultDriveInfo,
  presentationOf,
  stubFromDriveInfo,
  stubFromPresentation,
  VAULT_APP_ID,
  type DriveLike,
} from "./drive-stub.js";

const nodes = [{ id: "n1", name: "secret-note-slug", kind: "file" }];
const hydrated: DriveLike = {
  header: {
    id: "drive-1",
    slug: "vault",
    name: "Powerhouse Vault",
    documentType: "powerhouse/document-drive",
    meta: { preferredEditor: VAULT_APP_ID, custom: 1 },
  },
  state: { global: { name: "Powerhouse Vault", icon: "x", nodes }, local: { sharingType: "PUBLIC" } },
  initialState: { global: { name: "Powerhouse Vault", icon: "x", nodes } },
  operations: { global: [], local: [] },
  clipboard: [],
};

describe("presentationOf", () => {
  it("keeps everything but the node tree", () => {
    const p = presentationOf(hydrated);
    expect(p.state.global?.nodes).toEqual([]);
    expect(p.state.global?.name).toBe("Powerhouse Vault");
    expect(p.state.local).toEqual({ sharingType: "PUBLIC" });
    expect(p.header).toEqual(hydrated.header);
    expect(p.operations).toEqual({ global: [], local: [] });
  });

  it("strips initialState too — the read path aliases it to state", () => {
    expect(presentationOf(hydrated).initialState?.global?.nodes).toEqual([]);
  });

  it("does not mutate the drive it was given", () => {
    presentationOf(hydrated);
    expect(hydrated.state.global?.nodes).toHaveLength(1);
  });

  it("leaves no node name anywhere in the serialised memory", () => {
    expect(JSON.stringify(presentationOf(hydrated))).not.toContain("secret-note-slug");
  });
});

describe("stubFromPresentation", () => {
  it("routes a click to the vault app even if the memory lacked the pointer", () => {
    const noEditor: DriveLike = {
      ...hydrated,
      header: { ...hydrated.header, meta: { custom: 1 } },
    };
    expect(stubFromPresentation(noEditor).header.meta).toEqual({
      preferredEditor: VAULT_APP_ID,
      custom: 1,
    });
  });

  it("re-strips nodes defensively", () => {
    expect(stubFromPresentation(hydrated).state.global?.nodes).toEqual([]);
  });
});

describe("stubFromDriveInfo", () => {
  const info = {
    id: "drive-1",
    slug: "vault",
    name: "Powerhouse Vault",
    icon: null,
    meta: { preferredEditor: VAULT_APP_ID },
  };

  it("mirrors the shape the GraphQL read path produces", () => {
    const stub = stubFromDriveInfo(info, "2026-09-10T00:00:00.000Z");
    expect(stub.header).toEqual({
      id: "drive-1",
      sig: { publicKey: {}, nonce: "" },
      documentType: "powerhouse/document-drive",
      createdAtUtcIso: "2026-09-10T00:00:00.000Z",
      lastModifiedAtUtcIso: "2026-09-10T00:00:00.000Z",
      slug: "vault",
      name: "Powerhouse Vault",
      branch: "main",
      revision: { global: 0, local: 0 },
      meta: { preferredEditor: VAULT_APP_ID },
    });
    expect(stub.state.global).toEqual({ name: "Powerhouse Vault", icon: null, nodes: [] });
    expect(stub.initialState).toBe(stub.state);
    expect(stub.operations).toEqual({ global: [], local: [] });
    expect(stub.clipboard).toEqual([]);
  });

  it("tolerates a sparse answer", () => {
    const stub = stubFromDriveInfo({ id: "d" }, "t");
    expect(stub.header.slug).toBe("");
    expect(stub.header.name).toBe("");
    expect(stub.header.meta).toEqual({ preferredEditor: VAULT_APP_ID });
  });
});

describe("isVaultDriveInfo", () => {
  it("is true only for a drive that asks for the vault app", () => {
    expect(isVaultDriveInfo({ id: "d", meta: { preferredEditor: VAULT_APP_ID } })).toBe(true);
    expect(isVaultDriveInfo({ id: "d", meta: { preferredEditor: "other" } })).toBe(false);
    expect(isVaultDriveInfo({ id: "d", meta: null })).toBe(false);
    expect(isVaultDriveInfo({ id: "d" })).toBe(false);
  });
});

describe("hasDrive", () => {
  it("matches on header id", () => {
    expect(hasDrive([{ header: { id: "a" } }], "a")).toBe(true);
    expect(hasDrive([{ header: { id: "a" } }], "b")).toBe(false);
    expect(hasDrive([], "a")).toBe(false);
  });
});
