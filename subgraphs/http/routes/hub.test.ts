import { describe, expect, it, vi } from "vitest";
import type { RouteContext } from "@powerhousedao/shared/processors";
import { createFakeReactorClient } from "../../../tests/helpers/fake-reactor-client.js";
import type { HttpRouteDeps } from "../lib/deps.js";
import { ensureHub } from "./hub.js";

const ctx = { user: { address: "0xabc", chainId: 1, networkId: "eip155", appKey: "did:key:z" }, params: {}, authEnabled: true, transport: { proto: "http", host: "h", prefix: "", baseUrl: "http://h" } } as unknown as RouteContext;

/** A vault with MoCs; `tiers` maps each MoC id to its tier, `children` each MoC to its CHILD_MOC targets. */
function vault(tiers: Record<string, string>, children: Record<string, string[]> = {}) {
  const docs: Record<string, unknown> = {
    d: { header: { id: "d", name: "My vault" }, state: { global: { name: "My vault", nodes: Object.keys(tiers).map((id) => ({ id, documentType: "bai/moc" })) } } },
  };
  for (const [id, tier] of Object.entries(tiers)) docs[id] = { header: { id, documentType: "bai/moc", revision: { document: 1 } }, state: { global: { tier } } };
  const ops = (id: string) => (children[id] ?? []).map((t, i) => ({ index: i, action: { id: `op-${id}-${i}`, type: "ADD_RELATIONSHIP", input: { sourceId: id, targetId: t, relationshipType: "CHILD_MOC" } } }));
  const deleteDocuments = vi.fn(async () => undefined);
  const executeAsync = vi.fn(async () => ({ id: "job-1" }));
  const waitForJob = vi.fn(async () => ({ status: "READ_READY", result: { header: { revision: { document: 2 } } } }));
  const deps = {
    reactorClient: createFakeReactorClient({
      get: vi.fn(async (id: string) => docs[id]) as never,
      getOperations: vi.fn(async (id: string) => ({ results: ops(id) })) as never,
      deleteDocuments: deleteDocuments as never,
      executeAsync: executeAsync as never,
      waitForJob: waitForJob as never,
    } as never),
    resolveCanonicalDocumentId: vi.fn(async (id: string) => id) as never,
    authorization: { canRead: vi.fn(async () => true), canWrite: vi.fn(async () => true), canMutate: vi.fn(async () => true), isSupremeAdmin: vi.fn(() => false) },
    now: () => new Date("2026-10-08T12:00:00.000Z"),
    uuid: () => "uuid-1",
  } as unknown as HttpRouteDeps;
  return { deps, deleteDocuments, executeAsync };
}
const created = (id = "hub-new") => vi.fn(async (_request: Request, _ctx: RouteContext) => Response.json({ notes: [{ id, operations: [{ error: null }] }] }));

describe("ensureHub", () => {
  it("creates the HUB, named after the vault, when the vault has none", async () => {
    const v = vault({ t1: "TOPIC" });
    const create = created();
    expect(await ensureHub(v.deps, "d", ctx, create, "http://h/api/x/hub")).toEqual({ id: "hub-new", created: true, merged: [] });
    const body = JSON.parse(await create.mock.calls[0][0].text()) as unknown;
    expect(body).toMatchObject({ drive: "d", documentType: "bai/moc", notes: [{ name: "hub", actions: [{ type: "CREATE_MOC", input: { title: "My vault", tier: "HUB" } }] }] });
  });

  it("returns the existing HUB and creates nothing", async () => {
    const v = vault({ h1: "HUB", t1: "TOPIC" });
    const create = created();
    expect(await ensureHub(v.deps, "d", ctx, create, "http://h/hub")).toEqual({ id: "h1", created: false, merged: [] });
    expect(create).not.toHaveBeenCalled();
    expect(v.deleteDocuments).not.toHaveBeenCalled();
  });

  it("merges duplicate HUBs: keeps the smallest id, re-attaches the others' child maps, deletes the duplicates", async () => {
    const v = vault({ hubB: "HUB", hubA: "HUB", t1: "TOPIC", t2: "TOPIC" }, { hubA: ["t1"], hubB: ["t1", "t2"] });
    expect(await ensureHub(v.deps, "d", ctx, created(), "http://h/hub")).toEqual({ id: "hubA", created: false, merged: ["hubB"] });
    // t1 was already under hubA; only t2 moves
    const added = v.executeAsync.mock.calls.map((c) => (c as unknown as [string, string, Array<{ type: string; input: Record<string, unknown> }>])).map(([doc, , actions]) => [doc, actions[0].type, actions[0].input.targetId]);
    expect(added).toEqual([["hubA", "ADD_RELATIONSHIP", "t2"]]);
    expect(v.deleteDocuments).toHaveBeenCalledWith(["hubB"]);
  });
});
