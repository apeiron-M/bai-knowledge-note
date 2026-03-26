import { DocumentToolbar } from "@powerhousedao/design-system/connect";
import { useSelectedPipelineQueueDocument, actions } from "knowledge-note/document-models/pipeline-queue";

const TB = "!bg-[#181825] !border-white/10 [&_button]:!bg-[#1e1e2e] [&_button]:!border-white/10 [&_button:hover]:!bg-[#313244] [&_button_svg]:!text-gray-400 [&_span]:!text-gray-400 [&_h1]:!text-gray-400";
const STATUS_COLORS: Record<string, string> = {
  PENDING: "text-gray-400", IN_PROGRESS: "text-blue-400", BLOCKED: "text-red-400", DONE: "text-emerald-400", FAILED: "text-red-500",
};
const PHASE_COLORS: Record<string, string> = {
  create: "bg-amber-400", reflect: "bg-blue-400", reweave: "bg-purple-400", verify: "bg-emerald-400", enrich: "bg-sky-400",
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
    <div className="min-h-screen bg-[#1e1e2e] text-gray-200">
      <div className="mx-auto max-w-5xl">
        <DocumentToolbar className={TB} />
        <div className="p-6 space-y-6">
          {/* Header */}
          <div className="rounded-xl bg-[#181825] p-6 ring-1 ring-white/10">
            <h1 className="text-xl font-bold text-gray-100 mb-1">Processing Pipeline</h1>
            <p className="text-sm text-gray-500">Schema v{state.schemaVersion} &middot; {tasks.length} total tasks &middot; Last processed: {state.lastProcessedAt ? new Date(state.lastProcessedAt).toLocaleString() : "Never"}</p>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-5 gap-3">
            {[
              { label: "Pending", value: pending, color: "text-gray-400" },
              { label: "In Progress", value: inProgress, color: "text-blue-400" },
              { label: "Blocked", value: blocked, color: "text-red-400" },
              { label: "Done", value: done, color: "text-emerald-400" },
              { label: "Failed", value: failed, color: "text-red-500" },
            ].map((s) => (
              <div key={s.label} className="rounded-xl bg-[#181825] p-4 ring-1 ring-white/5">
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-[10px] text-gray-600">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Phase order */}
          <div className="rounded-xl bg-[#181825] p-6 ring-1 ring-white/10">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Phase Order</h3>
            <div className="space-y-2">
              {(state.phaseOrder ?? []).map((entry, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="rounded bg-[#313244] px-2 py-0.5 text-xs font-medium text-gray-400">{entry.taskType}</span>
                  <div className="flex gap-1">
                    {(entry.phases ?? []).map((phase, j) => (
                      <span key={j} className="flex items-center gap-1">
                        {j > 0 && <span className="text-gray-600">&rarr;</span>}
                        <span className={`h-2 w-6 rounded-full ${PHASE_COLORS[phase] ?? "bg-gray-500"}`} title={phase} />
                        <span className="text-[10px] text-gray-500">{phase}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Tasks */}
          <div className="rounded-xl bg-[#181825] p-6 ring-1 ring-white/10">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Tasks ({tasks.length})</h3>
            {tasks.length === 0 ? (
              <p className="text-sm text-gray-600 py-4 text-center">No tasks. Use /seed to ingest sources and start the pipeline.</p>
            ) : (
              <div className="space-y-1">
                {tasks.map((task) => (
                  <div key={task.id} className="flex items-center gap-3 rounded-lg bg-[#1e1e2e] px-4 py-3 ring-1 ring-white/5">
                    <span className={`w-20 shrink-0 text-xs font-semibold ${STATUS_COLORS[task.status] ?? "text-gray-500"}`}>{task.status}</span>
                    <span className="flex-1 truncate text-sm text-gray-300">{task.target}</span>
                    <div className="flex items-center gap-1">
                      {(task.completedPhases ?? []).map((p) => (
                        <span key={p} className={`h-2 w-6 rounded-full ${PHASE_COLORS[p] ?? "bg-gray-500"} opacity-60`} title={`${p} (done)`} />
                      ))}
                      {task.currentPhase && (
                        <span className={`h-2 w-6 rounded-full ${PHASE_COLORS[task.currentPhase] ?? "bg-gray-500"} animate-pulse`} title={`${task.currentPhase} (current)`} />
                      )}
                    </div>
                    <span className="rounded bg-[#313244] px-1.5 py-0.5 text-[10px] text-gray-500">{task.taskType}</span>
                    {task.assignedTo && <span className="text-[10px] text-gray-600">{task.assignedTo}</span>}

                    {/* Handoffs count */}
                    {(task.handoffs ?? []).length > 0 && (
                      <span className="text-[10px] text-gray-600">{task.handoffs.length} handoff{task.handoffs.length !== 1 ? "s" : ""}</span>
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
