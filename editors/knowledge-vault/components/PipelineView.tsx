import { useMemo } from "react";
import { useDocumentsInSelectedDrive } from "@powerhousedao/reactor-browser";

const PHASE_COLORS: Record<string, string> = {
  create: "bg-amber-400",
  reflect: "bg-blue-400",
  reweave: "bg-purple-400",
  verify: "bg-emerald-400",
  enrich: "bg-sky-400",
};

const STATUS_COLORS: Record<string, string> = {
  PENDING: "text-gray-400",
  IN_PROGRESS: "text-blue-400",
  BLOCKED: "text-red-400",
  DONE: "text-emerald-400",
  FAILED: "text-red-500",
};

type PipelineTask = {
  id: string;
  taskType: string;
  status: string;
  target: string;
  currentPhase: string | null;
  completedPhases: string[];
  assignedTo: string | null;
};

export function PipelineView() {
  const documents = useDocumentsInSelectedDrive();

  const queueDoc = useMemo(() => {
    return (documents ?? []).find((d) => d.header.documentType === "bai/pipeline-queue");
  }, [documents]);

  const state = useMemo(() => {
    if (!queueDoc) return null;
    return (queueDoc.state as unknown as { global: Record<string, unknown> }).global;
  }, [queueDoc]);

  const tasks = useMemo(() => {
    if (!state?.tasks) return [];
    return (state.tasks as PipelineTask[]);
  }, [state]);

  const stats = useMemo(() => {
    const pending = tasks.filter((t) => t.status === "PENDING").length;
    const inProgress = tasks.filter((t) => t.status === "IN_PROGRESS").length;
    const blocked = tasks.filter((t) => t.status === "BLOCKED").length;
    const done = tasks.filter((t) => t.status === "DONE").length;
    const failed = tasks.filter((t) => t.status === "FAILED").length;
    return { pending, inProgress, blocked, done, failed, total: tasks.length };
  }, [tasks]);

  if (!queueDoc) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-lg text-gray-500">Pipeline queue initializing...</p>
          <p className="mt-1 text-sm text-gray-600">The pipeline-queue document will be created automatically</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6">
      {/* Stats bar */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: "Pending", value: stats.pending, color: "text-gray-400" },
          { label: "In Progress", value: stats.inProgress, color: "text-blue-400" },
          { label: "Blocked", value: stats.blocked, color: "text-red-400" },
          { label: "Done", value: stats.done, color: "text-emerald-400" },
          { label: "Failed", value: stats.failed, color: "text-red-500" },
        ].map((s) => (
          <div key={s.label} className="rounded-lg bg-[#1e1e2e] p-3 ring-1 ring-white/5">
            <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-[10px] text-gray-600">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Task list */}
      {tasks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/10 p-6 text-center">
          <p className="text-sm text-gray-500">No tasks in the pipeline</p>
          <p className="mt-1 text-xs text-gray-600">Use /seed to ingest source material and start processing</p>
        </div>
      ) : (
        <div className="space-y-1">
          {tasks.map((task) => (
            <div key={task.id} className="flex items-center gap-3 rounded-lg border border-white/5 bg-[#1e1e2e] px-4 py-3">
              {/* Status indicator */}
              <span className={`text-xs font-semibold ${STATUS_COLORS[task.status] ?? "text-gray-500"}`}>
                {task.status}
              </span>

              {/* Target */}
              <span className="flex-1 truncate text-sm text-gray-300">{task.target}</span>

              {/* Phase progress */}
              <div className="flex items-center gap-1">
                {task.completedPhases.map((phase) => (
                  <span key={phase} className={`h-2 w-6 rounded-full ${PHASE_COLORS[phase] ?? "bg-gray-500"} opacity-60`}
                    title={`${phase} (done)`} />
                ))}
                {task.currentPhase && (
                  <span className={`h-2 w-6 rounded-full ${PHASE_COLORS[task.currentPhase] ?? "bg-gray-500"} animate-pulse`}
                    title={`${task.currentPhase} (current)`} />
                )}
              </div>

              {/* Type badge */}
              <span className="rounded bg-[#313244] px-1.5 py-0.5 text-[10px] text-gray-500">{task.taskType}</span>

              {/* Assigned */}
              {task.assignedTo && (
                <span className="text-[10px] text-gray-600">{task.assignedTo}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
