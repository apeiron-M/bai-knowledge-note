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
  header: { id: "vault-1", name: "powerhouse-knowledge", slug: "vault" },
  state: {
    global: {
      nodes: [
        { documentType: "bai/vault-config" },
        { documentType: "bai/knowledge-note" },
      ],
    },
  },
};

const otherDrive = {
  header: { id: "other-1", name: "playground", slug: "play" },
  state: { global: { nodes: [] } },
};

function deps(canRead: (id: string) => boolean = () => true): HttpRouteDeps {
  return {
    reactorClient: createFakeReactorClient({
      find: vi.fn(async () => ({
        results: [vaultDrive, otherDrive],
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
  it("lists drives with the vault flag and node count", async () => {
    const res = await createDrivesRoute(deps())(
      new Request("http://h/drives"),
      ctx,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      drives: {
        id: string;
        name: string;
        slug: string | null;
        vault: boolean;
        nodes: number;
      }[];
    };
    expect(body.drives).toEqual([
      {
        id: "vault-1",
        name: "powerhouse-knowledge",
        slug: "vault",
        vault: true,
        nodes: 2,
      },
      {
        id: "other-1",
        name: "playground",
        slug: "play",
        vault: false,
        nodes: 0,
      },
    ]);
  });

  it("hides drives the caller cannot read", async () => {
    const res = await createDrivesRoute(deps((id) => id === "other-1"))(
      new Request("http://h/drives"),
      ctx,
    );
    const body = (await res.json()) as { drives: { id: string }[] };
    expect(body.drives.map((d) => d.id)).toEqual(["other-1"]);
  });

  it("401s without an identity", async () => {
    const res = await createDrivesRoute(deps())(
      new Request("http://h/drives"),
      { ...ctx, user: undefined } as unknown as RouteContext,
    );
    expect(res.status).toBe(401);
  });
});