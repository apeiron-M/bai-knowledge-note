import type { KnowledgeVaultClient } from "../common/client.js";
import { errorMessage } from "../common/errors.js";
import type { NoteSummary } from "./connect.js";
import { completeJson, type LlmClient } from "./llm.js";

/**
 * Place a source's notes in the MoC hierarchy: each note becomes a CORE_IDEA
 * of a TOPIC or DOMAIN MoC. A new TOPIC MoC is created only when three or
 * more of the notes share a theme no MoC covers, and it is attached under a
 * DOMAIN or the HUB in the same run, so no MoC is left unreachable. A vault
 * with no HUB yet (a new one) gets it created with its first MoC — otherwise no
 * MoC could ever be made there.
 */

/** The parent a new MoC names when the vault has no HUB yet: the HUB, created in the same run. */
export const NEW_HUB = "new:hub";

export type MocInfo = { id: string; title: string; description: string; tier: "HUB" | "DOMAIN" | "TOPIC"; members: number; samples: string[]; parent: string | null };
type GraphNode = { documentId: string; title?: string; description?: string; noteType?: string; status?: string };
type GraphEdge = { sourceDocumentId: string; targetDocumentId: string; linkType: string; targetTitle?: string | null };

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v));
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export async function readMocs(client: KnowledgeVaultClient, drive: string): Promise<{ mocs: MocInfo[]; coreIdeas: Set<string> }> {
  const graph = await client.request<{ nodes: GraphNode[]; edges: GraphEdge[] }>({ path: "graph.json", query: { drive }, timeoutMs: 60_000 });
  const titles = new Map(graph.nodes.map((n) => [n.documentId, n.title ?? ""]));
  const mocs = graph.nodes.filter((n) => n.status === "MOC").map((n): MocInfo => {
    const tier = /HUB/.test(n.noteType ?? "") ? "HUB" : /DOMAIN/.test(n.noteType ?? "") ? "DOMAIN" : "TOPIC";
    const members = graph.edges.filter((e) => e.linkType === "CORE_IDEA" && e.sourceDocumentId === n.documentId);
    const parent = graph.edges.find((e) => e.linkType === "CHILD_MOC" && e.targetDocumentId === n.documentId)?.sourceDocumentId ?? null;
    return { id: n.documentId, title: n.title ?? n.documentId, description: n.description ?? "", tier, members: members.length, samples: members.slice(0, 3).map((e) => e.targetTitle ?? titles.get(e.targetDocumentId) ?? "").filter(Boolean), parent };
  });
  const coreIdeas = new Set(graph.edges.filter((e) => e.linkType === "CORE_IDEA").map((e) => `${e.sourceDocumentId}>${e.targetDocumentId}`));
  return { mocs, coreIdeas };
}

export const PLACE_SYSTEM = `You place atomic notes into a knowledge vault's Maps of Content (MoCs). Answer with JSON only.

MoCs form a tree: one HUB, DOMAIN MoCs under it, TOPIC MoCs (3-9 notes each) under a DOMAIN or the HUB.
For each note choose the TOPIC or DOMAIN MoC whose theme it belongs to. Judge by what the MoC's description and sample notes are about, not by shared words.
Only when three or more of these notes share a theme that no existing MoC covers, propose ONE new TOPIC MoC for them, with a parent that is an existing DOMAIN, or the HUB when no domain fits. When the list offers "new:hub" (the vault has no HUB yet), use "new:hub" as that parent: the HUB is created with the first MoC. Never place a note in the HUB itself.
A new MoC needs: title (the theme, plainly), description (what it covers, one or two sentences), orientation (how to read it: what the notes argue together and where to start).

Answer: {"placements":[{"note":"<note id>","moc":"<moc id or new:1>"}],"new_mocs":[{"key":"new:1","title":"...","description":"...","orientation":"...","parent":"<DOMAIN or HUB id>"}]}`;

export type Placement = { note: string; moc: string };
export type NewMoc = { key: string; title: string; description: string; orientation: string; parent: string };

export function checkPlan(value: unknown, notes: NoteSummary[], mocs: MocInfo[]) {
  const noteIds = new Set(notes.map((n) => n.id));
  const byId = new Map(mocs.map((m) => [m.id, m]));
  const hubToCreate = !mocs.some((m) => m.tier === "HUB");
  const problems: string[] = [];
  const newMocs: NewMoc[] = [];
  for (const m of arr(rec(value).new_mocs).map(rec)) {
    const parent = byId.get(str(m.parent));
    const underNewHub = hubToCreate && str(m.parent) === NEW_HUB;
    if (!str(m.key).startsWith("new:") || str(m.key) === NEW_HUB || !str(m.title).trim()) problems.push(`new MoC "${str(m.title)}" needs a key like new:1 and a title`);
    else if (!underNewHub && (!parent || parent.tier === "TOPIC")) problems.push(`new MoC "${str(m.title)}" needs an existing DOMAIN or the HUB as parent, not "${str(m.parent)}"`);
    else newMocs.push({ key: str(m.key), title: str(m.title).trim(), description: str(m.description).trim(), orientation: str(m.orientation).trim(), parent: str(m.parent) });
  }
  const newKeys = new Set(newMocs.map((m) => m.key));
  const placements: Placement[] = [];
  for (const p of arr(rec(value).placements).map(rec)) {
    const note = str(p.note);
    const moc = str(p.moc);
    if (!noteIds.has(note)) continue;
    if (newKeys.has(moc) || (byId.has(moc) && byId.get(moc)?.tier !== "HUB")) placements.push({ note, moc });
    else problems.push(`note ${note}: "${moc}" is not a TOPIC or DOMAIN MoC`);
  }
  for (const m of newMocs) {
    const count = placements.filter((p) => p.moc === m.key).length;
    if (count < 3) problems.push(`new MoC "${m.title}" would hold ${count} note${count === 1 ? "" : "s"}; a new TOPIC needs 3 or more, so place ${count === 1 ? "it" : "them"} in an existing MoC`);
  }
  const unplaced = notes.filter((n) => !placements.some((p) => p.note === n.id)).map((n) => n.id);
  return { placements, newMocs, problems, unplaced };
}

export async function planStage(llm: LlmClient, model: string, notes: NoteSummary[], mocs: MocInfo[], fetchImpl?: typeof fetch) {
  const listing = [
    "MoCs:",
    ...mocs.map((m) => `- ${m.id} [${m.tier}${m.parent ? `, under ${m.parent}` : ""}] ${m.title} (${m.members} notes): ${m.description}${m.samples.length ? ` e.g. ${m.samples.map((t) => `"${t}"`).join("; ")}` : ""}`),
    ...(mocs.some((m) => m.tier === "HUB") ? [] : [`- ${NEW_HUB} [HUB] the vault's entry point, created with the first MoC (no notes are placed in it)`]),
    "",
    "Notes to place:",
    ...notes.map((n) => `- ${n.id}: ${n.title} — ${n.description}`),
  ].join("\n");
  let cost = 0;
  let feedback = "";
  let plan = checkPlan({}, notes, mocs);
  for (let round = 0; round < 2; round++) {
    const reply = await completeJson(llm, { model, system: PLACE_SYSTEM, user: listing + feedback, maxTokens: 16_000, reasoningEffort: "medium" }, fetchImpl);
    cost += reply.usage.cost;
    plan = checkPlan(reply.value, notes, mocs);
    if (plan.problems.length === 0 && plan.unplaced.length === 0) break;
    feedback = `\n\nYour previous answer had problems. Fix exactly these and answer again in full:\n${[...plan.problems, ...plan.unplaced.map((id) => `note ${id} was not placed`)].map((p) => `- ${p}`).join("\n")}`;
  }
  // What still breaks the rules after the repair round is dropped, never written.
  const keep = new Set(plan.newMocs.filter((m) => plan.placements.filter((p) => p.moc === m.key).length >= 3).map((m) => m.key));
  const placements = plan.placements.filter((p) => !p.moc.startsWith("new:") || keep.has(p.moc));
  const newMocs = plan.newMocs.filter((m) => keep.has(m.key));
  const unplaced = notes.filter((n) => !placements.some((p) => p.note === n.id)).map((n) => n.id);
  const titles = new Map(mocs.map((m) => [m.id, m.title]));
  const used = [...new Set(placements.map((p) => (p.moc.startsWith("new:") ? `new "${newMocs.find((m) => m.key === p.moc)?.title}"` : `"${titles.get(p.moc)}"`)))];
  return {
    summary: `Placed ${placements.length} of ${notes.length} notes in ${used.length} MoC${used.length === 1 ? "" : "s"} (${used.join(", ")})${newMocs.length ? `, ${newMocs.length} of them new` : ""}${unplaced.length ? `; ${unplaced.length} not placed` : ""}.`,
    placements,
    new_mocs: newMocs,
    unplaced,
    problems: plan.problems,
    cost_usd: Math.round(cost * 10_000) / 10_000,
  };
}

export async function writePlacementsStage(
  client: KnowledgeVaultClient,
  args: { drive: string; placements: Placement[]; newMocs: NewMoc[]; coreIdeas: Set<string>; now?: () => Date },
) {
  const at = (args.now ?? (() => new Date()))().toISOString();
  const created = new Map<string, string>();
  const problems: string[] = [];
  const slug = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "moc";
  let hubId: string | undefined;
  if (args.newMocs.some((m) => m.parent === NEW_HUB)) {
    // The vault's first MoC: its HUB comes first, so the new MoC has a parent and stays reachable.
    const body = await client.request<{ notes: { id: string; operations: { type: string; error?: string | null }[] }[] }>({
      method: "POST",
      path: "notes",
      timeoutMs: 120_000,
      json: {
        drive: args.drive,
        documentType: "bai/moc",
        notes: [
          {
            name: "hub",
            actions: [
              {
                type: "CREATE_MOC",
                input: {
                  title: "Hub",
                  description: "The vault's entry point: every domain and topic map hangs from here.",
                  orientation: "Start here. Each map below collects the notes on one theme; open the one closest to your question.",
                  tier: "HUB",
                  createdAt: at,
                },
              },
            ],
          },
        ],
      },
    });
    const doc = body.notes[0];
    const failed = doc?.operations.find((o) => o.error);
    if (!doc || failed) problems.push(`the vault's HUB: ${failed?.error ?? "not created"}`);
    else hubId = doc.id;
  }
  const parentOf = (m: NewMoc) => (m.parent === NEW_HUB ? hubId : m.parent);
  const writable = args.newMocs.filter((m) => parentOf(m));
  if (writable.length) {
    const body = await client.request<{ notes: { id: string; operations: { type: string; error?: string | null }[] }[] }>({
      method: "POST",
      path: "notes",
      timeoutMs: 120_000,
      json: {
        drive: args.drive,
        documentType: "bai/moc",
        notes: writable.map((m) => ({
          name: slug(m.title),
          actions: [{ type: "CREATE_MOC", input: { title: m.title, description: m.description, orientation: m.orientation, tier: "TOPIC", parentRef: parentOf(m), createdAt: at } }],
        })),
      },
    });
    body.notes.forEach((doc, i) => {
      const m = writable[i];
      const failed = doc.operations.find((o) => o.error);
      if (failed) problems.push(`MoC "${m.title}": ${failed.error}`);
      created.set(m.key, doc.id);
    });
    for (const m of writable) {
      const id = created.get(m.key);
      if (!id) continue;
      await client
        .request({ method: "POST", path: "relationships", json: { source: parentOf(m), target: id, type: "CHILD_MOC" } })
        .catch((error: unknown) => problems.push(`attach "${m.title}" under its parent: ${errorMessage(error)}`));
    }
  }
  let linked = 0;
  let already = 0;
  for (const p of args.placements) {
    const moc = p.moc.startsWith("new:") ? created.get(p.moc) : p.moc;
    if (!moc) continue;
    if (args.coreIdeas.has(`${moc}>${p.note}`)) {
      already++;
      continue;
    }
    try {
      await client.request({ method: "POST", path: "relationships", json: { source: moc, target: p.note, type: "CORE_IDEA" } });
      linked++;
    } catch (error) {
      problems.push(`CORE_IDEA ${moc} → ${p.note}: ${errorMessage(error)}`);
    }
  }
  return {
    summary: `Added ${linked} note${linked === 1 ? "" : "s"} to their MoCs${already ? ` (${already} already there)` : ""}${created.size ? `; created ${hubId ? "the vault's HUB and " : ""}${created.size} TOPIC MoC${created.size === 1 ? "" : "s"}, each attached to its parent` : ""}${problems.length ? `; ${problems.length} problem${problems.length === 1 ? "" : "s"}` : ""}.`,
    created_mocs: [...(hubId ? [hubId] : []), ...created.values()],
    linked,
    problems,
  };
}
