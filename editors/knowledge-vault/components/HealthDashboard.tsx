import { useMemo } from "react";
import { useDocumentsInSelectedDrive } from "@powerhousedao/reactor-browser";

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

type GraphMetrics = {
  noteCount: number;
  mocCount: number;
  connectionCount: number;
  density: number;
  orphanCount: number;
  danglingLinkCount: number;
  mocCoverage: number;
  averageLinksPerNote: number;
};

export function HealthDashboard() {
  const documents = useDocumentsInSelectedDrive();

  const report = useMemo(() => {
    const doc = (documents ?? []).find((d) => d.header.documentType === "bai/health-report");
    if (!doc) return null;
    return (doc.state as unknown as { global: Record<string, unknown> }).global;
  }, [documents]);

  if (!report) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-lg text-gray-500">No health report yet</p>
          <p className="mt-1 text-sm text-gray-600">Generate one via the plugin: /powerhouse-knowledge:health</p>
        </div>
      </div>
    );
  }

  const overallStatus = (report.overallStatus as string) ?? "PASS";
  const checks = (report.checks as HealthCheck[]) ?? [];
  const metrics = report.graphMetrics as GraphMetrics | null;
  const recommendations = (report.recommendations as string[]) ?? [];
  const generatedAt = report.generatedAt ? new Date(report.generatedAt as string).toLocaleString() : "Unknown";
  const mode = (report.mode as string) ?? "full";

  return (
    <div className="p-4 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4 rounded-xl bg-[#181825] p-6 ring-1 ring-white/10">
        <span className={`rounded-full border px-4 py-1.5 text-sm font-bold ${STATUS_BADGE[overallStatus]}`}>
          {overallStatus}
        </span>
        <div>
          <h2 className="text-lg font-bold text-gray-100">Vault Health Report</h2>
          <p className="text-xs text-gray-500">Mode: {mode} &middot; Generated: {generatedAt}</p>
        </div>
      </div>

      {/* Metrics */}
      {metrics && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Notes", value: metrics.noteCount, color: "text-[#cba6f7]" },
            { label: "MOCs", value: metrics.mocCount, color: "text-blue-400" },
            { label: "Connections", value: metrics.connectionCount, color: "text-emerald-400" },
            { label: "Density", value: `${(metrics.density * 100).toFixed(1)}%`, color: "text-gray-300" },
            { label: "Orphans", value: metrics.orphanCount, color: metrics.orphanCount > 0 ? "text-amber-400" : "text-emerald-400" },
            { label: "Dangling Links", value: metrics.danglingLinkCount, color: metrics.danglingLinkCount > 0 ? "text-red-400" : "text-emerald-400" },
            { label: "MOC Coverage", value: `${(metrics.mocCoverage * 100).toFixed(0)}%`, color: "text-blue-400" },
            { label: "Avg Links/Note", value: metrics.averageLinksPerNote.toFixed(1), color: "text-gray-300" },
          ].map((m) => (
            <div key={m.label} className="rounded-xl bg-[#1e1e2e] p-4 ring-1 ring-white/5">
              <p className={`text-xl font-bold ${m.color}`}>{m.value}</p>
              <p className="text-[10px] text-gray-600">{m.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Checks */}
      {checks.length > 0 && (
        <div className="rounded-xl bg-[#181825] p-6 ring-1 ring-white/10">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Checks ({checks.length})</h3>
          <div className="space-y-2">
            {checks.map((check) => (
              <div key={check.id} className="flex items-start gap-3 rounded-lg bg-[#1e1e2e] px-4 py-3 ring-1 ring-white/5">
                <span className={`mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${STATUS_BADGE[check.status]}`}>
                  {check.status}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-gray-300">{check.category.replaceAll("_", " ")}</p>
                  <p className="mt-0.5 text-xs text-gray-500">{check.message}</p>
                  {check.affectedItems.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {check.affectedItems.slice(0, 5).map((item, i) => (
                        <span key={i} className="rounded bg-[#313244] px-1.5 py-0.5 text-[10px] font-mono text-gray-600">{item}</span>
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
      )}

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <div className="rounded-xl bg-[#181825] p-6 ring-1 ring-white/10">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Recommendations</h3>
          <ul className="space-y-1.5">
            {recommendations.map((rec, i) => (
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
