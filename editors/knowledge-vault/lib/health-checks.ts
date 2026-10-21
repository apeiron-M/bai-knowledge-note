/**
 * The vault's health checks, as one function: the dashboard renders them live, and the browser vault
 * writes them into the vault's health report. Thresholds and wording are the dashboard's.
 */

export type HealthStatus = "PASS" | "WARN" | "FAIL";

export type HealthNote = {
  id: string;
  title: string;
  description: string | null | undefined;
  noteType: string | null | undefined;
  topics: readonly string[];
  /** Where the note's links point (any kind: other notes, its source, …). */
  links: readonly string[];
};

export type HealthInput = {
  notes: readonly HealthNote[];
  /** Maps, with the notes they hold as core ideas. */
  mocs: readonly { id: string; coreIdeas: readonly string[] }[];
  pendingObservations: readonly { id: string; title: string }[];
  openTensions: readonly { id: string; title: string }[];
  /** Every other document that exists (sources, maps, …): a link to one is not dangling. */
  otherDocumentIds?: readonly string[];
};

export type HealthCheckResult = { category: string; status: HealthStatus; message: string; affectedItems: string[] };

export type HealthMetrics = {
  noteCount: number;
  mocCount: number;
  connectionCount: number;
  density: number;
  orphanCount: number;
  danglingLinkCount: number;
  mocCoverage: number;
  averageLinksPerNote: number;
};

export type HealthRecommendation = { text: string; noteIds: string[] };

export type HealthResult = {
  overallStatus: HealthStatus;
  checks: HealthCheckResult[];
  metrics: HealthMetrics;
  recommendations: HealthRecommendation[];
};

const grade = (count: number, warnAtMost: number): HealthStatus => (count === 0 ? "PASS" : count <= warnAtMost ? "WARN" : "FAIL");

export function computeHealth(input: HealthInput): HealthResult {
  const notes = input.notes;
  const noteIds = new Set(notes.map((n) => n.id));
  const known = new Set([...noteIds, ...input.mocs.map((m) => m.id), ...(input.otherDocumentIds ?? [])]);

  let connectionCount = 0;
  let danglingLinkCount = 0;
  const incoming = new Set<string>();
  for (const note of notes) {
    for (const target of note.links) {
      if (noteIds.has(target)) {
        connectionCount++;
        incoming.add(target);
      } else if (!known.has(target)) {
        danglingLinkCount++;
      }
    }
  }
  const orphans = notes.filter((n) => !incoming.has(n.id));
  const averageLinksPerNote = notes.length > 0 ? connectionCount / notes.length : 0;
  const inMaps = new Set(input.mocs.flatMap((m) => m.coreIdeas));

  const checks: HealthCheckResult[] = [];
  checks.push({
    category: "ORPHAN_DETECTION",
    status: grade(orphans.length, 3),
    message: orphans.length === 0 ? "All notes have incoming links" : `${orphans.length} orphan note(s)`,
    affectedItems: orphans.map((n) => n.title),
  });
  checks.push({
    category: "LINK_HEALTH",
    status: averageLinksPerNote >= 2 ? "PASS" : averageLinksPerNote >= 1 ? "WARN" : "FAIL",
    message: `Avg ${averageLinksPerNote.toFixed(1)} links/note${averageLinksPerNote < 2 ? " (target: 2+)" : ""}`,
    affectedItems: notes.filter((n) => n.links.length < 2).map((n) => n.title),
  });
  const noDescription = notes.filter((n) => !n.description);
  checks.push({
    category: "DESCRIPTION_QUALITY",
    status: grade(noDescription.length, 2),
    message: noDescription.length === 0 ? "All notes have descriptions" : `${noDescription.length} missing descriptions`,
    affectedItems: noDescription.map((n) => n.title),
  });
  const noType = notes.filter((n) => !n.noteType);
  checks.push({
    category: "SCHEMA_COMPLIANCE",
    status: noType.length === 0 ? "PASS" : "WARN",
    message: noType.length === 0 ? "All notes have a type" : `${noType.length} note(s) missing type`,
    affectedItems: noType.map((n) => n.title),
  });
  const noTopics = notes.filter((n) => n.topics.length === 0);
  checks.push({
    category: "MOC_COHERENCE",
    status: grade(noTopics.length, 3),
    message: noTopics.length === 0 ? "All notes have topics" : `${noTopics.length} note(s) without topics`,
    affectedItems: noTopics.map((n) => n.title),
  });
  if (input.pendingObservations.length > 0) {
    checks.push({
      category: "PROCESSING_THROUGHPUT",
      status: input.pendingObservations.length > 5 ? "FAIL" : "WARN",
      message: `${input.pendingObservations.length} pending observation(s) — review and promote or archive`,
      affectedItems: input.pendingObservations.map((o) => o.title),
    });
  }
  if (input.openTensions.length > 0) {
    checks.push({
      category: "THREE_SPACE_BOUNDARIES",
      status: input.openTensions.length > 3 ? "FAIL" : "WARN",
      message: `${input.openTensions.length} open tension(s) — resolve or dissolve`,
      affectedItems: input.openTensions.map((t) => t.title),
    });
  }
  const overallStatus: HealthStatus = checks.some((c) => c.status === "FAIL") ? "FAIL" : checks.some((c) => c.status === "WARN") ? "WARN" : "PASS";

  const recommendations: HealthRecommendation[] = [];
  if (orphans.length > 0)
    recommendations.push({ text: `Connect ${orphans.length} orphan note(s) — open each and add links via the Links tab`, noteIds: orphans.map((n) => n.id) });
  if (averageLinksPerNote < 2) {
    const fewLinks = notes.filter((n) => n.links.length < 2);
    recommendations.push({ text: `${fewLinks.length} note(s) have fewer than 2 links — open and add connections`, noteIds: fewLinks.map((n) => n.id) });
  }
  if (noDescription.length > 0) recommendations.push({ text: `Add descriptions to ${noDescription.length} note(s)`, noteIds: noDescription.map((n) => n.id) });
  if (noType.length > 0) recommendations.push({ text: `Set note types on ${noType.length} note(s)`, noteIds: noType.map((n) => n.id) });
  if (noTopics.length > 0) recommendations.push({ text: `Tag ${noTopics.length} note(s) with topics`, noteIds: noTopics.map((n) => n.id) });

  return {
    overallStatus,
    checks,
    metrics: {
      noteCount: notes.length,
      mocCount: input.mocs.length,
      connectionCount,
      density: notes.length > 1 ? connectionCount / (notes.length * (notes.length - 1)) : 0,
      orphanCount: orphans.length,
      danglingLinkCount,
      mocCoverage: notes.length > 0 ? notes.filter((n) => inMaps.has(n.id)).length / notes.length : 0,
      averageLinksPerNote,
    },
    recommendations,
  };
}
