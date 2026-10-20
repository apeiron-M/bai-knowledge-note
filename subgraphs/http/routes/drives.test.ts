import { describe, expect, it, vi } from "vitest";
import type { RouteContext } from "@powerhousedao/shared/processors";
import { createFakeReactorClient } from "../../../tests/helpers/fake-reactor-client.js";
import type { HttpRouteDeps } from "../lib/deps.js";
import { createDrivesRoute } from "./drives.js";

const ctx = {
  user: {
    address: "0xabc",
    chainId: 1,
    networkId: "eip155",
    appKey: "did:key:z",
  },
  params: {},
  authEnabled: true,
  transport: { proto: "http", host: "h", prefix: "", baseUrl: "http://h" },
} as unknown as RouteContext;

const vaultDrive = {
  header: {
    id: "vault-1",
    name: "powerhouse-knowledge",
    slug: "vault",
    meta: { preferredEditor: "knowledge-vault" },
  },
  state: {
    global: {
      nodes: [
        { documentType: "bai/vault-config" },
        { documentType: "bai/knowledge-note" },
      ],
    },
  },
};

const secondVault = {
  header: {
    id: "vault-2",
    name: "second-vault",
    slug: "second",
    meta: { preferredEditor: "knowledge-vault" },
  },
  state: { global: { nodes: [] } },
};

const nonVaultDrive = {
  header: {
    id: "vetra-1",
    name: "Vetra",
    slug: "vetra",
    meta: { preferredEditor: "vetra-drive-app" },
  },
  state: { global: { nodes: [{ documentType: "bai/knowledge-note" }] } },
};

function deps(canRead: (id: string) => boolean = () => true): HttpRouteDeps {
  return {
    reactorClient: createFakeReactorClient({
      find: vi.fn(async () => ({
        results: [vaultDrive, secondVault, nonVaultDrive],
      })) as never,
    } as never),
    resolveCanonicalDocumentId: vi.fn(async () => "d") as never,
    authorization: {
      canRead: vi.fn(async (id: string) => canRead(id)),
      canWrite: vi.fn(async () => true),
      canMutate: vi.fn(async () => true),
      isSupremeAdmin: vi.fn(() => false),
    },
    now: () => new Date(),
    uuid: () => "u",
  };
}

describe("GET drives", () => {
  it("lists only knowledge-vault drives, with node counts", async () => {
    const res = await createDrivesRoute(deps())(
      new Request("http://h/drives"),
      ctx,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      drives: { id: string; name: string; slug: string | null; nodes: number }[];
    };
    expect(body.drives).toEqual([
      {
        id: "vault-1",
        name: "powerhouse-knowledge",
        slug: "vault",
        nodes: 2,
      },
      { id: "vault-2", name: "second-vault", slug: "second", nodes: 0 },
    ]);
  });

  it("hides a vault drive the caller cannot read", async () => {
    const res = await createDrivesRoute(deps((id) => id === "vault-2"))(
      new Request("http://h/drives"),
      ctx,
    );
    const body = (await res.json()) as { drives: { id: string }[] };
    expect(body.drives.map((d) => d.id)).toEqual(["vault-2"]);
  });

  it("401s without an identity", async () => {
    const res = await createDrivesRoute(deps())(
      new Request("http://h/drives"),
      { ...ctx, user: undefined } as unknown as RouteContext,
    );
    expect(res.status).toBe(401);
  });
});