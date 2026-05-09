import { DocumentToolbar } from "@powerhousedao/design-system/connect";
import { useSelectedHealthReportDocument } from "../../document-models/health-report/v1/hooks.js";
import { setSelectedNode } from "@powerhousedao/reactor-browser";
import { TOOLBAR_CLASS } from "../shared/theme-context.js";
import { useDocumentsSafe } from "../knowledge-vault/hooks/use-documents-safe.js";

const STATUS_BADGE: Record<string, string> = {
  PASS: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  WARN: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  FAIL: "bg-red-500/20 text-red-300 border-red-500/30",
};

export default function Editor() {
  const [document] = useSelectedHealthReportDocument();
  const state = document.state.global;
  // Safe variant — see moc-editor for rationale.
  const documents = useDocumentsSafe(["bai/knowledge-note", "bai/moc"]);

  const isEmpty = !state.generatedAt;

  if (isEmpty) {
    return (
      <div
        className="min-h-screen"
        style={{ backgroundColor: "var(--bai-bg)", color: "var(--bai-text)" }}
      >
        <div className="mx-auto max-w-3xl">
          <DocumentToolbar className={TOOLBAR_CLASS} />
          <div
            className="flex h-64 items-center justify-center rounded-xl m-6"
            style={{
              backgroundColor: "var(--bai-surface)",
              border: "1px solid var(--bai-border)",
            }}
          >
            <div className="text-center">
              <p className="text-sm" style={{ color: "var(--bai-text-muted)" }}>
                No health report generated yet
              </p>
              <p
                className="mt-1 text-xs"
                style={{ color: "var(--bai-text-faint)" }}
              >
                Run /health in Claude Code to generate a vault health report
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const metrics = state.graphMetrics;
  const checks = state.checks ?? [];
  const recommendations = state.recommendations ?? [];

  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: "var(--bai-bg)", color: "var(--bai-text)" }}
    >
      <div className="mx-auto max-w-4xl">
        <DocumentToolbar className={TOOLBAR_CLASS} />
        <div className="p-6 space-y-6">
          {/* Header */}
          <div
            className="flex items-center gap-4 rounded-xl p-6"
            style={{
              backgroundColor: "var(--bai-surface)",
              border: "1px solid var(--bai-border)",
            }}
          >
            <span
              className={`rounded-full border px-4 py-1.5 text-sm font-bold ${STATUS_BADGE[state.overallStatus ?? "PASS"]}`}
            >
              {state.overallStatus}
            </span>
            <div className="flex-1">
              <h1
                className="text-xl font-bold"
                style={{ color: "var(--bai-text)" }}
              >
                Vault Health
              </h1>
              <p className="text-xs" style={{ color: "var(--bai-text-muted)" }}>
                Generated {new Date(state.generatedAt!).toLocaleString()}
                {state.generatedBy && ` by ${state.generatedBy}`}
                {state.mode && ` \u2022 ${state.mode} mode`}
              </p>
            </div>
          </div>

          {/* Metrics */}
          {metrics && (
            <div className="grid grid-cols-4 gap-3">
              {[
                {
                  label: "Notes",
                  value: metrics.noteCount,
                  color: "var(--bai-accent)",
                },
                {
                  label: "MOCs",
                  value: metrics.mocCount,
                  color: undefined,
                  cls: "text-blue-400",
                },
                {
                  label: "Edges",
                  value: metrics.connectionCount,
                  color: undefined,
                  cls: "text-emerald-400",
                },
                {
                  label: "Density",
                  value: `${(metrics.density * 100).toFixed(1)}%`,
                  color: "var(--bai-text-secondary)",
                },
                {
                  label: "Orphans",
                  value: metrics.orphanCount,
                  color: undefined,
                  cls:
                    metrics.orphanCount > 0
                      ? "text-amber-400"
                      : "text-emerald-400",
                },
                {
                  label: "Dangling",
                  value: metrics.danglingLinkCount,
                  color: undefined,
                  cls:
                    metrics.danglingLinkCount > 0
                      ? "text-red-400"
                      : "text-emerald-400",
                },
                {
                  label: "Avg Links",
                  value: metrics.averageLinksPerNote.toFixed(1),
                  color: undefined,
                  cls:
                    metrics.averageLinksPerNote < 2
                      ? "text-amber-400"
                      : "text-emerald-400",
                },
                {
                  label: "MOC Coverage",
                  value: `${(metrics.mocCoverage * 100).toFixed(0)}%`,
                  color: "var(--bai-text-tertiary)",
                },
              ].map((m) => (
                <div
                  key={m.label}
                  className="rounded-xl p-4"
                  style={{
                    backgroundColor: "var(--bai-surface)",
                    boxShadow: "0 0 0 1px var(--bai-ring)",
                  }}
                >
                  <p
                    className={`text-xl font-bold ${m.cls ?? ""}`}
                    style={m.color ? { color: m.color } : undefined}
                  >
                    {m.value}
                  </p>
                  <p
                    className="text-[10px]"
                    style={{ color: "var(--bai-text-faint)" }}
                  >
                    {m.label}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Checks */}
          <div
            className="rounded-xl p-6"
            style={{
              backgroundColor: "var(--bai-surface)",
              border: "1px solid var(--bai-border)",
            }}
          >
            <h3
              className="mb-3 text-xs font-semibold uppercase tracking-wider"
              style={{ color: "var(--bai-text-muted)" }}
            >
              Health Checks ({checks.length})
            </h3>
            {checks.length === 0 ? (
              <p
                className="text-sm py-4 text-center"
                style={{ color: "var(--bai-text-faint)" }}
              >
                No checks recorded
              </p>
            ) : (
              <div className="space-y-3">
                {checks.map((check) => (
                  <div
                    key={check.id}
                    className="rounded-lg px-4 py-3"
                    style={{
                      backgroundColor: "var(--bai-bg)",
                      border: "1px solid var(--bai-border)",
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={`mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${STATUS_BADGE[check.status]}`}
                      >
                        {check.status}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p
                          className="text-xs font-medium"
                          style={{ color: "var(--bai-text-secondary)" }}
                        >
                          {check.category.replaceAll("_", " ")}
                        </p>
                        <p
                          className="mt-0.5 text-xs"
                          style={{ color: "var(--bai-text-muted)" }}
                        >
                          {check.message}
                        </p>
                        {/* Affected items */}
                        {check.affectedItems.length > 0 &&
                          check.status !== "PASS" && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {check.affectedItems
                                .slice(0, 5)
                                .map((item, i) => {
                                  const noteDoc = (documents ?? []).find(
                                    (d) =>
                                      (d.header.documentType ===
                                        "bai/knowledge-note" ||
                                        d.header.documentType ===
                                          "bai/source") &&
                                      ((
                                        d.state as unknown as {
                                          global: { title?: string };
                                        }
                                      ).global.title === item ||
                                        d.header.name === item),
                                  );
                                  return noteDoc ? (
                                    <button
                                      key={i}
                                      type="button"
                                      onClick={() =>
                                        setSelectedNode(noteDoc.header.id)
                                      }
                                      className="rounded px-1.5 py-0.5 text-[10px] cursor-pointer"
                                      style={{
                                        backgroundColor: "var(--bai-hover)",
                                        color: "var(--bai-accent)",
                                      }}
                                    >
                                      {item.length > 50
                                        ? item.slice(0, 50) + "\u2026"
                                        : item}
                                    </button>
                                  ) : (
                                    <span
                                      key={i}
                                      className="rounded px-1.5 py-0.5 text-[10px]"
                                      style={{
                                        backgroundColor: "var(--bai-hover)",
                                        color: "var(--bai-text-faint)",
                                      }}
                                    >
                                      {item.length > 50
                                        ? item.slice(0, 50) + "\u2026"
                                        : item}
                                    </span>
                                  );
                                })}
                              {check.affectedItems.length > 5 && (
                                <span
                                  className="text-[10px]"
                                  style={{ color: "var(--bai-text-faint)" }}
                                >
                                  +{check.affectedItems.length - 5} more
                                </span>
                              )}
                            </div>
                          )}
                      </div>
                    </div>
                    {/* Actionable guidance for non-PASS checks */}
                    {check.status !== "PASS" && (
                      <CheckGuidance
                        category={check.category}
                        affectedItems={check.affectedItems}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recommendations */}
          {recommendations.length > 0 && (
            <div
              className="rounded-xl p-6"
              style={{
                backgroundColor: "var(--bai-surface)",
                border: "1px solid var(--bai-border)",
              }}
            >
              <h3
                className="mb-3 text-xs font-semibold uppercase tracking-wider"
                style={{ color: "var(--bai-text-muted)" }}
              >
                Recommendations ({recommendations.length})
              </h3>
              <ul className="space-y-2">
                {recommendations.map((rec, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-xs"
                    style={{ color: "var(--bai-text-secondary)" }}
                  >
                    <span
                      className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: "var(--bai-accent)" }}
                    />
                    {rec}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const GUIDANCE: Record<
  string,
  { manual: string; agent: string; icon: string }
> = {
  ORPHAN_DETECTION: {
    manual:
      "Open each orphan note and add links to related notes via the Links section. Every note should have at least one incoming link from another note.",
    agent: "/connect <note-id>",
    icon: "M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101",
  },
  LINK_HEALTH: {
    manual:
      "Open under-linked notes and add connections. Use the Links section in the note editor to search for related notes and create typed links (RELATES_TO, BUILDS_ON, etc.).",
    agent: "/connect",
    icon: "M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101",
  },
  DESCRIPTION_QUALITY: {
    manual:
      "Open each note missing a description and add a ~150 character summary that adds information beyond the title. Good descriptions enable scanning without reading the full content.",
    agent: "/verify --fix",
    icon: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5",
  },
  SCHEMA_COMPLIANCE: {
    manual:
      "Open each note and set a note type (concept, pattern, architecture, decision, observation, procedure, or reference). The type helps with filtering and organization.",
    agent: "/verify --fix",
    icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2",
  },
  MOC_COHERENCE: {
    manual:
      "Create Maps of Content (MOC) via New > Map of Content for topics that have 3+ notes. MOCs organize notes by topic and provide navigation structure.",
    agent: "/graph (identifies topic clusters for MOC creation)",
    icon: "M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7",
  },
  PROCESSING_THROUGHPUT: {
    manual:
      "These sources have been queued but not fully processed. The pipeline tasks need to advance through the remaining phases (reweave, verify).",
    agent: "/pipeline (processes all pending tasks through remaining phases)",
    icon: "M22 12h-4l-3 9L9 3l-3 9H2",
  },
  THREE_SPACE_BOUNDARIES: {
    manual:
      "Open each tension and either resolve it (one side is correct), dissolve it (both sides are compatible), or archive it (no longer relevant).",
    agent: "/verify (reviews tensions in context of current knowledge)",
    icon: "M12 9v2m0 4h.01M5.07 19H19a2 2 0 001.75-2.75L13.75 4a2 2 0 00-3.5 0L3.32 16.25A2 2 0 005.07 19z",
  },
  STALE_NOTES: {
    manual:
      "Open each stale note and review whether it needs updating, more connections, or archiving. Notes untouched for 30+ days with few links may be forgotten knowledge.",
    agent: "/connect <note-id> (finds new connections for stale notes)",
    icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
  },
};

function CheckGuidance({
  category,
  affectedItems,
}: {
  category: string;
  affectedItems: string[];
}) {
  const guidance = GUIDANCE[category];
  if (!guidance) return null;

  return (
    <div
      className="mt-3 rounded-lg px-4 py-3"
      style={{
        backgroundColor: "var(--bai-surface)",
        border: "1px solid var(--bai-border)",
      }}
    >
      <div className="flex items-start gap-3">
        <svg
          className="mt-0.5 h-4 w-4 shrink-0"
          style={{ color: "var(--bai-accent)" }}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d={guidance.icon} />
        </svg>
        <div className="flex-1 space-y-2">
          <div>
            <p
              className="text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--bai-text-muted)" }}
            >
              How to fix
            </p>
            <p
              className="mt-0.5 text-xs leading-relaxed"
              style={{ color: "var(--bai-text-secondary)" }}
            >
              {guidance.manual}
            </p>
          </div>
          <div
            className="flex items-center gap-2 rounded-md px-3 py-2"
            style={{
              backgroundColor: "var(--bai-bg)",
              border: "1px solid var(--bai-border)",
            }}
          >
            <span
              className="text-[10px] font-semibold"
              style={{ color: "var(--bai-text-muted)" }}
            >
              AI Agent:
            </span>
            <code
              className="text-[11px] font-mono"
              style={{ color: "var(--bai-accent)" }}
            >
              {guidance.agent}
            </code>
            <span
              className="text-[10px]"
              style={{ color: "var(--bai-text-faint)" }}
            >
              in Claude Code
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
