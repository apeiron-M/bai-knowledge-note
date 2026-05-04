import { DocumentToolbar } from "@powerhousedao/design-system/connect";
import { setSelectedNode } from "@powerhousedao/reactor-browser";
import {
  useSelectedPipelineQueueDocument,
  actions,
} from "../../document-models/pipeline-queue/index.js";
import { TOOLBAR_CLASS } from "../shared/theme-context.js";

const STATUS_COLORS: Record<string, string> = {
  PENDING: "text-gray-400",
  IN_PROGRESS: "text-blue-400",
  BLOCKED: "text-red-400",
  DONE: "text-emerald-400",
  FAILED: "text-red-500",
};
const PHASE_COLORS: Record<string, string> = {
  create: "bg-amber-400",
  reflect: "bg-blue-400",
  reweave: "bg-purple-400",
  verify: "bg-emerald-400",
  enrich: "bg-sky-400",
};

export default function Editor() {
  const [document, dispatch] = useSelectedPipelineQueueDocument();
  const state = document.state.global;
  const tasks = state.tasks ?? [];
  const pending = tasks.filter((t) => t.status === "PENDING").length;
  const inProgress = tasks.filter((t) => t.status === "IN_PROGRESS").length;
  const blocked = tasks.filter((t) => t.status === "BLOCKED").length;
  const done = tasks.filter((t) => t.status === "DONE").length;
  const failed = tasks.filter((t) => t.status === "FAILED").length;

  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: "var(--bai-bg)", color: "var(--bai-text)" }}
    >
      <div className="mx-auto max-w-5xl">
        <DocumentToolbar className={TOOLBAR_CLASS} />
        <div className="p-6 space-y-6">
          {/* Header */}
          <div
            className="rounded-xl p-6"
            style={{
              backgroundColor: "var(--bai-surface)",
              border: "1px solid var(--bai-border)",
            }}
          >
            <h1
              className="text-xl font-bold mb-1"
              style={{ color: "var(--bai-text)" }}
            >
              Processing Pipeline
            </h1>
            <p className="text-sm" style={{ color: "var(--bai-text-muted)" }}>
              Schema v{state.schemaVersion} &middot; {tasks.length} total tasks
              &middot; Last processed:{" "}
              {state.lastProcessedAt
                ? new Date(state.lastProcessedAt).toLocaleString()
                : "Never"}
            </p>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-5 gap-3">
            {[
              { label: "Pending", value: pending, color: "text-gray-400" },
              {
                label: "In Progress",
                value: inProgress,
                color: "text-blue-400",
              },
              { label: "Blocked", value: blocked, color: "text-red-400" },
              { label: "Done", value: done, color: "text-emerald-400" },
              { label: "Failed", value: failed, color: "text-red-500" },
            ].map((s) => (
              <div
                key={s.label}
                className="rounded-xl p-4"
                style={{
                  backgroundColor: "var(--bai-surface)",
                  boxShadow: "0 0 0 1px var(--bai-ring)",
                }}
              >
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                <p
                  className="text-[10px]"
                  style={{ color: "var(--bai-text-faint)" }}
                >
                  {s.label}
                </p>
              </div>
            ))}
          </div>

          {/* Phase order */}
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
              Phase Order
            </h3>
            <div className="space-y-2">
              {(state.phaseOrder ?? []).map((entry, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span
                    className="rounded px-2 py-0.5 text-xs font-medium"
                    style={{
                      backgroundColor: "var(--bai-hover)",
                      color: "var(--bai-text-tertiary)",
                    }}
                  >
                    {entry.taskType}
                  </span>
                  <div className="flex gap-1">
                    {(entry.phases ?? []).map((phase, j) => (
                      <span key={j} className="flex items-center gap-1">
                        {j > 0 && (
                          <span style={{ color: "var(--bai-text-faint)" }}>
                            &rarr;
                          </span>
                        )}
                        <span
                          className={`h-2 w-6 rounded-full ${PHASE_COLORS[phase] ?? "bg-gray-500"}`}
                          title={phase}
                        />
                        <span
                          className="text-[10px]"
                          style={{ color: "var(--bai-text-muted)" }}
                        >
                          {phase}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Tasks */}
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
              Tasks ({tasks.length})
            </h3>
            {tasks.length === 0 ? (
              <p
                className="text-sm py-4 text-center"
                style={{ color: "var(--bai-text-faint)" }}
              >
                No tasks. Use /seed to ingest sources and start the pipeline.
              </p>
            ) : (
              <div className="space-y-1">
                {tasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center gap-3 rounded-lg px-4 py-3"
                    style={{
                      backgroundColor: "var(--bai-bg)",
                      boxShadow: "0 0 0 1px var(--bai-ring)",
                    }}
                  >
                    <span
                      className={`w-20 shrink-0 text-xs font-semibold ${STATUS_COLORS[task.status] ?? "text-gray-500"}`}
                    >
                      {task.status}
                    </span>
                    {task.documentRef ? (
                      <button
                        type="button"
                        onClick={() => setSelectedNode(task.documentRef!)}
                        className="flex-1 truncate text-left text-sm transition-colors"
                        style={{ color: "var(--bai-text-secondary)" }}
                        title={`Open source: ${task.target}`}
                      >
                        {task.target}
                        <svg
                          className="ml-1 inline h-3 w-3"
                          style={{ color: "var(--bai-text-faint)" }}
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                          <path d="M15 3h6v6" />
                          <path d="M10 14L21 3" />
                        </svg>
                      </button>
                    ) : (
                      <span
                        className="flex-1 truncate text-sm"
                        style={{ color: "var(--bai-text-secondary)" }}
                      >
                        {task.target}
                      </span>
                    )}
                    <div className="flex items-center gap-1">
                      {(task.completedPhases ?? []).map((p) => (
                        <span
                          key={p}
                          className={`h-2 w-6 rounded-full ${PHASE_COLORS[p] ?? "bg-gray-500"} opacity-60`}
                          title={`${p} (done)`}
                        />
                      ))}
                      {task.currentPhase && (
                        <span
                          className={`h-2 w-6 rounded-full ${PHASE_COLORS[task.currentPhase] ?? "bg-gray-500"} animate-pulse`}
                          title={`${task.currentPhase} (current)`}
                        />
                      )}
                    </div>
                    <span
                      className="rounded px-1.5 py-0.5 text-[10px]"
                      style={{
                        backgroundColor: "var(--bai-hover)",
                        color: "var(--bai-text-muted)",
                      }}
                    >
                      {task.taskType}
                    </span>
                    {task.assignedTo && (
                      <span
                        className="text-[10px]"
                        style={{ color: "var(--bai-text-faint)" }}
                      >
                        {task.assignedTo}
                      </span>
                    )}

                    {/* Handoffs count */}
                    {(task.handoffs ?? []).length > 0 && (
                      <span
                        className="text-[10px]"
                        style={{ color: "var(--bai-text-faint)" }}
                      >
                        {task.handoffs.length} handoff
                        {task.handoffs.length !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
