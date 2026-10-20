import type { RouteContext } from "@powerhousedao/shared/processors";
import type { HttpRouteDeps } from "../lib/deps.js";
import { HttpError, jsonError, OK_CACHE } from "../lib/respond.js";
import { executeWrite } from "../lib/write.js";
import { createNotesRoute } from "./create.js";

/**
 * `POST hub?drive=` — the vault's one HUB, created if missing.
 *
 * The pipeline's placement step used to decide "no HUB yet" while planning, then create one minutes
 * later; two overlapping runs each created their own. This route is the only place a HUB is made:
 * it holds a per-vault lock and reads the vault's live state (not the asynchronous graph index), so a
 * second caller waits and finds the first one's HUB. A vault that already has several (made before
 * this route existed) is consolidated: the HUB with the smallest id is kept — every caller agrees on
 * it — the others' child maps are attached to it, and the duplicates are deleted.
 */
const locks = new Map<string, Promise<unknown>>();

type DriveNode = { id: string; documentType?: string | null };
type LoggedOp = { action?: { type?: string; input?: Record<string, unknown> } };
export type HubResult = { id: string; created: boolean; merged: string[] };

async function hubsOf(deps: HttpRouteDeps, drive: string): Promise<{ hubs: string[]; driveName: string }> {
  const doc = await deps.reactorClient.get(drive);
  const nodes = (doc.state as { global?: { nodes?: DriveNode[]; name?: string } } | undefined)?.global?.nodes ?? [];
  const driveName = ((doc.state as { global?: { name?: string } } | undefined)?.global?.name ?? (doc.header as { name?: string } | undefined)?.name ?? "").trim();
  const hubs: string[] = [];
  for (const node of nodes.filter((n) => n.documentType === "bai/moc")) {
    const moc = await deps.reactorClient.get(node.id);
    if ((moc.state as { global?: { tier?: string } } | undefined)?.global?.tier === "HUB") hubs.push(node.id);
  }
  return { hubs: hubs.sort(), driveName };
}

/** The CHILD_MOC targets a MoC holds now, folded from its relationship operations. */
async function childMocs(deps: HttpRouteDeps, mocId: string): Promise<string[]> {
  const children = new Set<string>();
  let cursor = "";
  for (let page = 0; page < 50; page++) {
    const result = (await deps.reactorClient.getOperations(mocId, undefined, undefined, { cursor, limit: 200 })) as unknown as { results: LoggedOp[]; nextCursor?: string };
    for (const op of result.results) {
      const input = op.action?.input ?? {};
      if (input.relationshipType !== "CHILD_MOC" || typeof input.targetId !== "string") continue;
      if (op.action?.type === "ADD_RELATIONSHIP") children.add(input.targetId);
      if (op.action?.type === "REMOVE_RELATIONSHIP") children.delete(input.targetId);
    }
    if (!result.nextCursor) break;
    cursor = result.nextCursor;
  }
  return [...children];
}

export async function ensureHub(
  deps: HttpRouteDeps,
  drive: string,
  ctx: RouteContext,
  create: (request: Request, ctx: RouteContext) => Promise<Response>,
  baseUrl: string,
): Promise<HubResult> {
  const { hubs, driveName } = await hubsOf(deps, drive);
  if (hubs.length === 0) {
    const request = new Request(new URL("notes", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        drive,
        documentType: "bai/moc",
        notes: [
          {
            name: "hub",
            actions: [
              {
                type: "CREATE_MOC",
                input: {
                  title: driveName || "Hub",
                  description: "The vault's entry point: every domain and topic map hangs from here.",
                  orientation: "Start here. Each map below collects the notes on one theme; open the one closest to your question.",
                  tier: "HUB",
                  createdAt: deps.now().toISOString(),
                },
              },
            ],
          },
        ],
      }),
    });
    const response = await create(request, ctx);
    const body = (await response.json()) as { notes?: { id: string; operations?: { error?: string | null }[] }[]; error?: string };
    const doc = body.notes?.[0];
    const failed = doc?.operations?.find((o) => o.error);
    if (!response.ok || !doc || failed) throw new HttpError(502, "HUB_NOT_CREATED", `The vault's HUB could not be created: ${failed?.error ?? body.error ?? response.status}`);
    return { id: doc.id, created: true, merged: [] };
  }
  const [keep, ...duplicates] = hubs as [string, ...string[]];
  if (duplicates.length === 0) return { id: keep, created: false, merged: [] };
  const kept = new Set(await childMocs(deps, keep));
  for (const dup of duplicates) {
    for (const child of await childMocs(deps, dup)) {
      if (kept.has(child) || child === keep) continue;
      const document = await deps.reactorClient.get(keep);
      await executeWrite(deps, {
        documentId: keep,
        document,
        actions: [{ type: "ADD_RELATIONSHIP", input: { sourceId: keep, targetId: child, relationshipType: "CHILD_MOC" } }],
        ctx,
        wait: true,
        defaultScope: "document",
      });
      kept.add(child);
    }
  }
  await deps.reactorClient.deleteDocuments(duplicates);
  return { id: keep, created: false, merged: duplicates };
}

export function createHubRoute(deps: HttpRouteDeps) {
  const create = createNotesRoute(deps);
  return async function handleHub(request: Request, ctx: RouteContext): Promise<Response> {
    try {
      const drive = new URL(request.url).searchParams.get("drive");
      if (!drive) throw new HttpError(400, "BAD_REQUEST", "drive is required");
      const previous = locks.get(drive) ?? Promise.resolve();
      const run = previous.catch(() => undefined).then(() => ensureHub(deps, drive, ctx, create, request.url));
      locks.set(drive, run);
      try {
        return Response.json(await run, { headers: OK_CACHE });
      } finally {
        if (locks.get(drive) === run) locks.delete(drive);
      }
    } catch (error) {
      return jsonError(error);
    }
  };
}
