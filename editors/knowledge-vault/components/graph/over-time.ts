/**
 * Graph › Over time: what existed at a moment. A time mask that narrows the
 * legend's (`computeVisibility`) without widening it, the nodes that just
 * arrived (drawn as rings), one addition's members (Show in graph), and the
 * dock's words. Times come from the source timeline (`addedAt`).
 */
import { isNoteGroup, type SourceTimeline } from "../../../../processors/graph-indexer/source-timeline.js";
import { clock, countOf, unitOf } from "../../lib/timeline/additions.js";
import type { FoldedAxis, TimeWords } from "../../lib/timeline/axis.js";
import type { Visibility } from "./model.js";

/** As much of an IndexedGraph as the mask reads. */
export type GraphShape = {
  nodes: readonly { id: string }[];
  links: readonly unknown[];
  src: Uint32Array;
  dst: Uint32Array;
};

/** When each note and topic entered the vault (ms), by document id. */
export function arrivalsOf(timeline: SourceTimeline): Map<string, number> {
  const out = new Map<string, number>();
  for (const x of [...timeline.notes, ...timeline.topics]) {
    const t = Date.parse(x.addedAt ?? "");
    if (Number.isFinite(t)) out.set(x.documentId, t);
  }
  return out;
}

/**
 * Each node's arrival, in the graph's order. What the timeline does not know
 * — a note newer than the timeline, one with no date — arrives at
 * `unknownAt`: the dock's now, so it shows at the end and not in the past.
 * Left NaN, it would show at every moment.
 */
export function arrivalArray(g: Pick<GraphShape, "nodes">, arrivals: ReadonlyMap<string, number>, unknownAt = Number.NaN): Float64Array {
  const out = new Float64Array(g.nodes.length);
  g.nodes.forEach((n, i) => {
    out[i] = arrivals.get(n.id) ?? unknownAt;
  });
  return out;
}

/**
 * What existed at `moment`: the legend's mask narrowed in place (it is
 * recomputed from the filter before every call), or `spare` / new arrays when
 * the legend hides nothing. A link shows only when both its ends do.
 */
export function maskByTime(g: GraphShape, legend: Visibility | null, arrivedAt: Float64Array, moment: number, spare: Visibility | null): Visibility {
  const n = g.nodes.length;
  const m = g.links.length;
  let v = legend;
  if (!v) {
    v = spare && spare.node.length === n && spare.edge.length === m ? spare : { node: new Uint8Array(n), edge: new Uint8Array(m) };
    v.node.fill(1);
    v.edge.fill(1);
  }
  // NaN > moment is false: what the timeline does not know stays.
  for (let i = 0; i < n; i++) if (arrivedAt[i] > moment) v.node[i] = 0;
  for (let k = 0; k < m; k++) if (v.node[g.src[k]] === 0 || v.node[g.dst[k]] === 0) v.edge[k] = 0;
  return v;
}

/** The shown nodes that arrived within `windowMs` before the moment: the rings. */
export function arrivedWithin(arrivedAt: Float64Array, moment: number, windowMs: number, visible: Visibility | null): number[] {
  const out: number[] = [];
  for (let i = 0; i < arrivedAt.length; i++) {
    const t = arrivedAt[i];
    if (t <= moment && t > moment - windowMs && (!visible || visible.node[i] === 1)) out.push(i);
  }
  return out;
}

/** The notes and topics one addition became. */
export function additionMembers(timeline: SourceTimeline, additionId: string): Set<string> {
  const out = new Set<string>();
  for (const x of [...timeline.notes, ...timeline.topics]) if (x.additionId === additionId) out.add(x.documentId);
  return out;
}

export interface Caption {
  lead: string;
  rest: string;
}

/** "What Machine-Learning-Systems-Vol1 became." with its notes, topics and links to earlier additions. */
export function pickCaption(timeline: SourceTimeline, additionId: string): Caption | null {
  const a = timeline.additions.find((x) => x.id === additionId);
  if (!a) return null;
  if (a.notes === 0) {
    return a.waiting > 0
      ? { lead: `Nothing from ${a.title} is in the graph yet.`, rest: "Its sources are waiting to be read." }
      : { lead: `Nothing from ${a.title} is in the graph.`, rest: "None of its sources became a note." };
  }
  const topics = a.topicIds.length ? ` in ${countOf(a.topicIds.length, "new topic")}` : "";
  const earlier = a.linksToEarlier ? `, with ${countOf(a.linksToEarlier, "link")} to notes from earlier additions` : "";
  return { lead: `What ${a.title} became.`, rest: `${countOf(a.notes, "note")}${topics}${earlier}.` };
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** The dock's narration at a moment: the latest arrival, a quiet stretch, or the empty start. */
export function momentCaption(timeline: SourceTimeline, ax: FoldedAxis, t: number, _now: number, o: TimeWords = {}): Caption {
  const gap = ax.gaps.find((g) => t > g.t0 && t < g.t1);
  if (gap) {
    const ms = gap.t1 - gap.t0;
    return { lead: ms >= 2 * DAY ? `${Math.round(ms / DAY)} quiet days.` : `${Math.round(ms / HOUR)} quiet hours.`, rest: "Nothing was added; the vault kept what it had." };
  }
  const arrived = timeline.additions.filter((a) => !isNoteGroup(a) && Date.parse(a.addedAt) <= t);
  const cur = arrived.at(-1);
  if (!cur) return { lead: "Before anything was added.", rest: "Press play to watch the vault fill." };
  const soFar = timeline.notes.filter((n) => n.additionId === cur.id && Date.parse(n.addedAt ?? "") <= t).length;
  return {
    lead: `${clock(Date.parse(cur.addedAt), o)}, ${cur.title} arrives`,
    rest: `as ${countOf(cur.sources, unitOf(cur))}. ${countOf(soFar, "note")} from it by this moment.`,
  };
}

/** How many notes and topics existed at a moment. */
export function countsAt(timeline: SourceTimeline, t: number): { notes: number; topics: number } {
  const by = (xs: readonly { addedAt: string | null }[]) => xs.filter((x) => Date.parse(x.addedAt ?? "") <= t).length;
  return { notes: by(timeline.notes), topics: by(timeline.topics) };
}
