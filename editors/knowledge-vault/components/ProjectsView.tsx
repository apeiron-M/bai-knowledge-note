import { useState, useMemo, useCallback, useEffect, useRef, memo } from "react";
import {
  setSelectedNode,
  useSelectedDriveId,
} from "@powerhousedao/reactor-browser";
import { useKnowledgeNotes } from "../hooks/use-knowledge-notes.js";
import {
  useReactorDocsWithRefetch,
  type ReactorDocSpec,
} from "../hooks/use-reactor-docs.js";
import { createDocumentRemote } from "../lib/remote-reactor.js";
import { triggerVaultPull } from "../hooks/use-remote-first.js";
import type {
  ProjectStatus,
  TeamMember,
  Deliverable,
} from "document-models/project";
import type { Goal } from "document-models/work-breakdown-structure";
import {
  PROJECT_STATUS_META,
  GOAL_STATUS_META,
  goalRollup,
} from "../../shared/project-status.js";
import { useFolderMap } from "../hooks/use-drive-init.js";

// Groups are rendered in this fixed order regardless of how many projects
// land in each bucket; ACTIVE and PLANNING start expanded (the buckets a
// user is actually working from), the rest start collapsed.
const GROUP_ORDER: ProjectStatus[] = [
  "ACTIVE",
  "PLANNING",
  "ON_HOLD",
  "COMPLETED",
  "ARCHIVED",
];

type ProjectRow = {
  id: string;
  name: string;
  status: ProjectStatus;
  owner: string | null;
  team: TeamMember[];
  deliverables: Deliverable[];
  targetDate: string | null;
  lastModified: string;
  wbsRef: string | null;
  rollup: ReturnType<typeof goalRollup>;
};

function memberLabel(member: Pick<TeamMember, "name" | "kind">): string {
  const emoji =
    member.kind === "HUMAN" ? "🧑" : member.kind === "AGENT" ? "🤖" : null;
  return emoji ? `${emoji} ${member.name}` : member.name;
}

function formatLastModified(iso: string): string {
  const date = new Date(iso);
  const diffMin = Math.floor((Date.now() - date.getTime()) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function NewProjectButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors hover:opacity-80"
      style={{
        backgroundColor: "var(--bai-accent)",
        color: "var(--bai-accent-text)",
      }}
    >
      <svg
        className="h-3.5 w-3.5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
      >
        <path d="M12 5v14M5 12h14" />
      </svg>
      New Project
    </button>
  );
}

function TeamChips({ team }: { team: TeamMember[] }) {
  if (team.length === 0) return null;
  const shown = team.slice(0, 4);
  const extra = team.length - shown.length;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((member) => (
        <span
          key={member.id}
          className="rounded px-1.5 py-0.5 text-[10px]"
          style={{
            backgroundColor: "var(--bai-hover)",
            color: "var(--bai-text-muted)",
          }}
        >
          {memberLabel(member)}
        </span>
      ))}
      {extra > 0 && (
        <span
          className="text-[10px]"
          style={{ color: "var(--bai-text-faint)" }}
        >
          +{extra}
        </span>
      )}
    </div>
  );
}

const ProjectCard = memo(function ProjectCard({
  project,
}: {
  project: ProjectRow;
}) {
  const meta = PROJECT_STATUS_META[project.status];
  const deliveredCount = project.deliverables.filter(
    (d) => d.status === "DELIVERED",
  ).length;
  const totalDeliverables = project.deliverables.length;
  const hasWbs = project.wbsRef !== null;

  return (
    <button
      type="button"
      onClick={() => setSelectedNode(project.id)}
      className="w-full rounded-xl border border-[var(--bai-border)] bg-[var(--bai-surface)] px-4 py-3 text-left transition-colors hover:border-[var(--bai-accent)] hover:bg-[var(--bai-hover)]"
    >
      <div className="flex items-center gap-2">
        <p
          className="min-w-0 flex-1 truncate text-sm font-medium"
          style={{ color: "var(--bai-text-secondary)" }}
        >
          {project.name}
        </p>
        <span
          className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium"
          style={{
            color: meta.fg,
            backgroundColor: meta.bg,
            borderColor: meta.border,
          }}
        >
          {meta.label}
        </span>
        {project.rollup.blocked > 0 && (
          <span
            className="shrink-0 text-[10px] font-semibold"
            style={{ color: GOAL_STATUS_META.BLOCKED.fg }}
          >
            ⚠ {project.rollup.blocked} blocked
          </span>
        )}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        {project.owner && (
          <span
            className="text-[10px]"
            style={{ color: "var(--bai-text-faint)" }}
          >
            by {project.owner}
          </span>
        )}
        <TeamChips team={project.team} />
        {totalDeliverables > 0 && (
          <span
            className="text-[10px]"
            style={{ color: "var(--bai-text-faint)" }}
          >
            {deliveredCount}/{totalDeliverables} delivered
          </span>
        )}
        {project.targetDate && (
          <span
            className="text-[10px]"
            style={{ color: "var(--bai-text-faint)" }}
          >
            Due {project.targetDate.slice(0, 10)}
          </span>
        )}
        <span
          className="ml-auto text-[10px]"
          style={{ color: "var(--bai-text-faint)" }}
        >
          {formatLastModified(project.lastModified)}
        </span>
      </div>

      {hasWbs && (
        <div className="mt-2">
          <div
            className="flex items-center justify-between text-[10px]"
            style={{ color: "var(--bai-text-faint)" }}
          >
            <span>
              {project.rollup.finished}/{project.rollup.total} goals
            </span>
            <span>{project.rollup.pct}%</span>
          </div>
          <div
            className="mt-1 h-1.5 w-full overflow-hidden rounded-full"
            style={{ backgroundColor: "var(--bai-hover)" }}
          >
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${project.rollup.pct}%`,
                backgroundColor: "var(--bai-accent)",
              }}
            />
          </div>
        </div>
      )}
    </button>
  );
});

function NewProjectDialog({
  open,
  driveId,
  projectsFolderId,
  onClose,
}: {
  open: boolean;
  driveId: string | undefined;
  projectsFolderId: string | undefined;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !driveId || loading) return;
    setLoading(true);
    try {
      const newId = await createDocumentRemote({
        documentType: "bai/project",
        name: name.trim(),
        driveId,
        parentFolderId: projectsFolderId,
        targetFolderPath: "projects",
      });
      triggerVaultPull();
      onClose();
      setSelectedNode(newId);
    } catch (err) {
      console.error("[ProjectsView] Failed to create project:", err);
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <form
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
        className="relative z-10 w-[420px] rounded-2xl p-6 shadow-2xl"
        style={{
          backgroundColor: "var(--bai-surface)",
          border: "1px solid var(--bai-border)",
        }}
      >
        <h2 className="text-lg font-bold" style={{ color: "var(--bai-text)" }}>
          New Project
        </h2>
        <p className="mt-1 text-xs" style={{ color: "var(--bai-text-muted)" }}>
          bai/project
          <span className="ml-2" style={{ color: "var(--bai-text-faint)" }}>
            &rarr; /projects/
          </span>
        </p>

        <div className="mt-5">
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name your project..."
            className="w-full rounded-xl px-4 py-3 text-sm outline-none"
            style={{
              backgroundColor: "var(--bai-bg)",
              border: "1px solid var(--bai-border)",
              color: "var(--bai-text-secondary)",
            }}
          />
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-5 py-2.5 text-sm font-medium transition-colors hover:bg-white/5"
            style={{ color: "var(--bai-text-tertiary)" }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim() || loading}
            className="rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors hover:opacity-80 disabled:opacity-40"
            style={{
              backgroundColor: "var(--bai-accent)",
              color: "var(--bai-accent-text)",
            }}
          >
            {loading ? "Creating..." : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function ProjectsView() {
  const [createOpen, setCreateOpen] = useState(false);
  // ACTIVE/PLANNING start open (the buckets a user actively works from);
  // the rest collapse to a one-line header with the count.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    ACTIVE: true,
    PLANNING: true,
    ON_HOLD: false,
    COMPLETED: false,
    ARCHIVED: false,
  });
  const toggleGroup = useCallback(
    (status: string) =>
      setOpenGroups((prev) => ({ ...prev, [status]: !prev[status] })),
    [],
  );

  const driveId = useSelectedDriveId();
  const folderMap = useFolderMap();
  const projectsFolderId = folderMap.get("projects");
  // Targeted server reads of just the project/wbs documents; agents
  // update goal trees server-side, so keep them reasonably fresh.
  const { serverFileNodes, isLoading: treeLoading } = useKnowledgeNotes();
  const projectSpecs = useMemo<ReactorDocSpec[]>(
    () =>
      serverFileNodes
        .filter((n) => ["bai/project", "bai/wbs"].includes(n.documentType))
        .map((n) => ({ id: n.id, documentType: n.documentType, name: n.name })),
    [serverFileNodes],
  );
  const { docs: documents, isLoading: docsLoading } = useReactorDocsWithRefetch(
    projectSpecs,
    {
      pollMs: 30_000,
      // Switching tabs unmounts this view. `retainKey` lets the hook
      // paint the project/wbs documents it already holds while the drive
      // tree reloads, so coming back shows the cards immediately.
      retainKey: "projects-view",
    },
  );
  // Spinner only when there is nothing at all to show: under
  // stale-while-revalidate `docsLoading` stays true while an already
  // cached (possibly partial) card list is on screen.
  const isLoading = (treeLoading && projectSpecs.length === 0) || docsLoading;

  const wbsById = useMemo(() => {
    const m = new Map<string, Goal[]>();
    for (const d of documents ?? []) {
      if (d.header.documentType !== "bai/wbs") continue;
      const g = (d.state as unknown as { global: Record<string, unknown> })
        .global;
      m.set(d.header.id, (g.goals as Goal[] | undefined) ?? []);
    }
    return m;
  }, [documents]);

  const projects = useMemo<ProjectRow[]>(() => {
    return (documents ?? [])
      .filter((d) => d.header.documentType === "bai/project")
      .map((d) => {
        const g = (d.state as unknown as { global: Record<string, unknown> })
          .global;
        const wbsRef = (g.wbsRef as string | undefined) ?? null;
        const wbsGoals = wbsRef ? (wbsById.get(wbsRef) ?? []) : [];
        return {
          id: d.header.id,
          name: (g.name as string | undefined) ?? d.header.name,
          status: (g.status as ProjectStatus | undefined) ?? "PLANNING",
          owner: (g.owner as string | undefined) ?? null,
          team: (g.team as TeamMember[] | undefined) ?? [],
          deliverables: (g.deliverables as Deliverable[] | undefined) ?? [],
          targetDate: (g.targetDate as string | undefined) ?? null,
          lastModified: d.header.lastModifiedAtUtcIso,
          wbsRef,
          rollup: goalRollup(wbsGoals),
        };
      });
  }, [documents, wbsById]);

  const grouped = useMemo(() => {
    const groups: Record<string, ProjectRow[]> = {
      ACTIVE: [],
      PLANNING: [],
      ON_HOLD: [],
      COMPLETED: [],
      ARCHIVED: [],
    };
    for (const p of projects) {
      const bucket = groups[p.status] ?? groups.PLANNING;
      bucket.push(p);
    }
    return groups;
  }, [projects]);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2
          className="text-sm font-semibold"
          style={{ color: "var(--bai-text-tertiary)" }}
        >
          Projects ({projects.length})
        </h2>
        <NewProjectButton onClick={() => setCreateOpen(true)} />
      </div>

      {isLoading && projects.length === 0 ? (
        <div
          className="flex h-64 items-center justify-center rounded-xl"
          style={{
            backgroundColor: "var(--bai-surface)",
            border: "1px solid var(--bai-border)",
          }}
        >
          <div className="flex items-center gap-2">
            <svg
              className="h-4 w-4 animate-spin"
              style={{ color: "var(--bai-text-muted)" }}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="M21 12a9 9 0 11-6.219-8.56" />
            </svg>
            <p className="text-sm" style={{ color: "var(--bai-text-muted)" }}>
              Loading projects…
            </p>
          </div>
        </div>
      ) : projects.length === 0 ? (
        <div
          className="flex h-64 flex-col items-center justify-center gap-3 rounded-xl"
          style={{
            backgroundColor: "var(--bai-surface)",
            border: "1px solid var(--bai-border)",
          }}
        >
          <div className="text-center">
            <p className="text-sm" style={{ color: "var(--bai-text-muted)" }}>
              No projects yet
            </p>
            <p
              className="mt-1 text-xs"
              style={{ color: "var(--bai-text-faint)" }}
            >
              Create a project to track goals, team, and deliverables
            </p>
          </div>
          <NewProjectButton onClick={() => setCreateOpen(true)} />
        </div>
      ) : (
        <>
          {GROUP_ORDER.map((status) => {
            const items = grouped[status] ?? [];
            if (items.length === 0) return null;
            const isOpen = openGroups[status] ?? false;
            const meta = PROJECT_STATUS_META[status];
            return (
              <div key={status}>
                <button
                  type="button"
                  onClick={() => toggleGroup(status)}
                  aria-expanded={isOpen}
                  className="mb-2 flex w-full items-center gap-2 rounded-md px-1 py-1 text-xs font-semibold uppercase tracking-wider transition-colors hover:bg-white/5"
                  style={{ color: "var(--bai-text-muted)" }}
                >
                  <svg
                    className={`h-3 w-3 shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: meta.fg }}
                  />
                  {meta.label} ({items.length})
                </button>
                {isOpen && (
                  <div className="space-y-1">
                    {items.map((project) => (
                      <ProjectCard key={project.id} project={project} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      <NewProjectDialog
        open={createOpen}
        driveId={driveId}
        projectsFolderId={projectsFolderId}
        onClose={() => setCreateOpen(false)}
      />
    </div>
  );
}
