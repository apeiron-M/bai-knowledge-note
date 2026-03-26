import { useMemo } from "react";
import {
  useDocumentsInSelectedDrive,
} from "@powerhousedao/reactor-browser";
import { generateId } from "document-model/core";

const STATUS_BADGE: Record<string, string> = {
  PASS: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  WARN: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  FAIL: "bg-red-500/20 text-red-300 border-red-500/30",
};

type HealthCheck = {
  id: string;
  category: string;
  status: string;
  message: string;
  affectedItems: string[];
};

export function HealthDashboard() {
  const documents = useDocumentsInSelectedDrive();

  // Compute health directly from live documents (no need for separate health-report doc)
  const health = useMemo(() => {
    const docs = documents ?? [];
    const notes = docs.filter((d) => d.header.documentType === "bai/knowledge-note");
    const mocs = docs.filter((d) => d.header.documentType === "bai/moc");
    const sources = docs.filter((d) => d.header.documentType === "bai/source");
    const observations = docs.filter((d) => d.header.documentType === "bai/observation");
    const tensions = docs.filter((d) => d.header.documentType === "bai/tension");

    // Extract note state
    const noteStates = notes.map((d) => {
      const state = (d.state as unknown as { global: Record<string, unknown> }).global;
      return {
        id: d.header.id,
        title: (state.title as string) ?? d.header.name,
        status: (state.status as string) ?? "DRAFT",
        noteType: (state.noteType as string) ?? null,
        description: (state.description as string) ?? null,
        links: (state.links as Array<{ targetDocumentId?: string }>) ?? [],
        topics: (state.topics as Array<{ name: string }>) ?? [],
      };
    });

    const noteIds = new Set(noteStates.map((n) => n.id));
    const edgeCount = noteStates.reduce((sum, n) => sum + n.links.filter((l) => l.targetDocumentId && noteIds.has(l.targetDocumentId)).length, 0);

    // Incoming link counts
    const incomingCounts = new Map<string, number>();
    for (const note of noteStates) {
      for (const link of note.links) {
        if (link.targetDocumentId && noteIds.has(link.targetDocumentId)) {
          incomingCounts.set(link.targetDocumentId, (incomingCounts.get(link.targetDocumentId) ?? 0) + 1);
        }
      }
    }

    const orphans = noteStates.filter((n) => !incomingCounts.has(n.id));
    const density = noteStates.length > 1 ? edgeCount / (noteStates.length * (noteStates.length - 1)) : 0;
    const avgLinks = noteStates.length > 0 ? edgeCount / noteStates.length : 0;

    // Status distribution
    const statusDist: Record<string, number> = {};
    for (const n of noteStates) { statusDist[n.status] = (statusDist[n.status] ?? 0) + 1; }

    // Build checks
    const checks: HealthCheck[] = [];

    checks.push({
      id: generateId(), category: "ORPHAN_DETECTION",
      status: orphans.length === 0 ? "PASS" : orphans.length <= 3 ? "WARN" : "FAIL",
      message: orphans.length === 0 ? "All notes have incoming links" : `${orphans.length} orphan note(s)`,
      affectedItems: orphans.map((n) => n.title),
    });

    checks.push({
      id: generateId(), category: "LINK_HEALTH",
      status: avgLinks >= 2 ? "PASS" : avgLinks >= 1 ? "WARN" : "FAIL",
      message: `Avg ${avgLinks.toFixed(1)} links/note${avgLinks < 2 ? " (target: 2+)" : ""}`,
      affectedItems: noteStates.filter((n) => n.links.length < 2).map((n) => n.title),
    });

    const noDesc = noteStates.filter((n) => !n.description);
    checks.push({
      id: generateId(), category: "DESCRIPTION_QUALITY",
      status: noDesc.length === 0 ? "PASS" : noDesc.length <= 2 ? "WARN" : "FAIL",
      message: noDesc.length === 0 ? "All notes have descriptions" : `${noDesc.length} missing descriptions`,
      affectedItems: noDesc.map((n) => n.title),
    });

    const noType = noteStates.filter((n) => !n.noteType);
    checks.push({
      id: generateId(), category: "SCHEMA_COMPLIANCE",
      status: noType.length === 0 ? "PASS" : "WARN",
      message: noType.length === 0 ? "All notes have a type" : `${noType.length} note(s) missing type`,
      affectedItems: noType.map((n) => n.title),
    });

    const noTopics = noteStates.filter((n) => n.topics.length === 0);
    checks.push({
      id: generateId(), category: "MOC_COHERENCE",
      status: noTopics.length === 0 ? "PASS" : noTopics.length <= 3 ? "WARN" : "FAIL",
      message: noTopics.length === 0 ? "All notes have topics" : `${noTopics.length} note(s) without topics`,
      affectedItems: noTopics.map((n) => n.title),
    });

    const pendingObs = observations.filter((d) => {
      const s = (d.state as unknown as { global: { status?: string } }).global;
      return s.status === "PENDING";
    });
    if (pendingObs.length > 0) {
      checks.push({
        id: generateId(), category: "PROCESSING_THROUGHPUT",
        status: pendingObs.length > 5 ? "FAIL" : "WARN",
        message: `${pendingObs.length} pending observation(s) — review and promote or archive`,
        affectedItems: pendingObs.map((d) => d.header.name),
      });
    }

    const openTensions = tensions.filter((d) => {
      const s = (d.state as unknown as { global: { status?: string } }).global;
      return s.status === "OPEN";
    });
    if (openTensions.length > 0) {
      checks.push({
        id: generateId(), category: "THREE_SPACE_BOUNDARIES",
        status: openTensions.length > 3 ? "FAIL" : "WARN",
        message: `${openTensions.length} open tension(s) — resolve or dissolve`,
        affectedItems: openTensions.map((d) => d.header.name),
      });
    }

    const overallStatus = checks.some((c) => c.status === "FAIL") ? "FAIL" : checks.some((c) => c.status === "WARN") ? "WARN" : "PASS";

    const recommendations: string[] = [];
    if (orphans.length > 0) recommendations.push(`Run /connect on ${orphans.length} orphan note(s) to integrate them into the graph`);
    if (avgLinks < 2) recommendations.push("Add more links between notes — aim for 2+ connections per note");
    if (noDesc.length > 0) recommendations.push(`Add descriptions to ${noDesc.length} note(s) for progressive disclosure`);
    if (noType.length > 0) recommendations.push(`Set note types on ${noType.length} note(s) for better classification`);
    if (noTopics.length > 0) recommendations.push(`Tag ${noTopics.length} note(s) with topics for MOC navigation`);

    return {
      noteCount: noteStates.length,
      mocCount: mocs.length,
      sourceCount: sources.length,
      edgeCount,
      density,
      orphanCount: orphans.length,
      avgLinksPerNote: avgLinks,
      statusDist,
      overallStatus,
      checks,
      recommendations,
    };
  }, [documents]);

  return (
    <div className="p-4 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4 rounded-xl bg-[#181825] p-6 ring-1 ring-white/10">
        <span className={`rounded-full border px-4 py-1.5 text-sm font-bold ${STATUS_BADGE[health.overallStatus]}`}>
          {health.overallStatus}
        </span>
        <div>
          <h2 className="text-lg font-bold text-gray-100">Vault Health</h2>
          <p className="text-xs text-gray-500">Live metrics computed from current vault state</p>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Notes", value: health.noteCount, color: "text-[#cba6f7]" },
          { label: "MOCs", value: health.mocCount, color: "text-blue-400" },
          { label: "Sources", value: health.sourceCount, color: "text-cyan-400" },
          { label: "Edges", value: health.edgeCount, color: "text-emerald-400" },
          { label: "Density", value: `${(health.density * 100).toFixed(1)}%`, color: "text-gray-300" },
          { label: "Orphans", value: health.orphanCount, color: health.orphanCount > 0 ? "text-amber-400" : "text-emerald-400" },
          { label: "Avg Links", value: health.avgLinksPerNote.toFixed(1), color: health.avgLinksPerNote < 2 ? "text-amber-400" : "text-emerald-400" },
          { label: "Status Mix", value: Object.entries(health.statusDist).map(([k, v]) => `${k}:${v}`).join(" "), color: "text-gray-400" },
        ].map((m) => (
          <div key={m.label} className="rounded-xl bg-[#1e1e2e] p-4 ring-1 ring-white/5">
            <p className={`text-xl font-bold ${m.color}`}>{m.value}</p>
            <p className="text-[10px] text-gray-600">{m.label}</p>
          </div>
        ))}
      </div>

      {/* Checks */}
      <div className="rounded-xl bg-[#181825] p-6 ring-1 ring-white/10">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Health Checks ({health.checks.length})</h3>
        <div className="space-y-2">
          {health.checks.map((check) => (
            <div key={check.id} className="flex items-start gap-3 rounded-lg bg-[#1e1e2e] px-4 py-3 ring-1 ring-white/5">
              <span className={`mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${STATUS_BADGE[check.status]}`}>
                {check.status}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-gray-300">{check.category.replaceAll("_", " ")}</p>
                <p className="mt-0.5 text-xs text-gray-500">{check.message}</p>
                {check.affectedItems.length > 0 && check.status !== "PASS" && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {check.affectedItems.slice(0, 5).map((item, i) => (
                      <span key={i} className="rounded bg-[#313244] px-1.5 py-0.5 text-[10px] text-gray-600">{item}</span>
                    ))}
                    {check.affectedItems.length > 5 && (
                      <span className="text-[10px] text-gray-600">+{check.affectedItems.length - 5} more</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recommendations */}
      {health.recommendations.length > 0 && (
        <div className="rounded-xl bg-[#181825] p-6 ring-1 ring-white/10">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Recommendations</h3>
          <ul className="space-y-1.5">
            {health.recommendations.map((rec, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-gray-400">
                <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#cba6f7]" />
                {rec}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
