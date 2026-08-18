import { useState, useMemo, useCallback } from "react";
import type { EditorProps } from "document-model";
import {
  setSelectedNode,
  useFileNodesInSelectedDrive,
} from "@powerhousedao/reactor-browser";
import type { ProjectStatus } from "document-models/project";
import { VaultSidebar } from "./VaultSidebar.js";
import { CreateDocumentDialog } from "./CreateDocumentDialog.js";
import GraphViewPixi, { type GraphFocus } from "./GraphViewPixi.js";
import { NoteList } from "./NoteList.js";
import { SourceList } from "./SourceList.js";
import { ProjectsView } from "./ProjectsView.js";
import { HealthDashboard } from "./HealthDashboard.js";
import { SearchView } from "./SearchView.js";
import { ActivityView } from "./ActivityView.js";
import { GettingStartedButton } from "./GettingStarted.js";
import { useKnowledgeNotes } from "../hooks/use-knowledge-notes.js";
import { useVaultDocIndex } from "../../shared/use-vault-doc-index.js";
import {
  useReactorDocsWithRefetch,
  type ReactorDocSpec,
} from "../hooks/use-reactor-docs.js";
import { useKnowledgeMocs } from "../hooks/use-knowledge-mocs.js";
import { ThemeToggle } from "../../shared/theme-context.js";

type ViewMode =
  | "notes"
  | "graph"
  | "sources"
  | "projects"
  | "search"
  | "activity"
  | "pipeline"
  | "health"
  | "config";

export function DriveExplorer({ children }: EditorProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("search");
  const [graphFocus, setGraphFocus] = useState<GraphFocus | null>(null);
  const [graphClearNonce, setGraphClearNonce] = useState(0);
  // `notesLoading` is true until the first metadata fetch settles. It has
  // to be threaded into every note-derived view: without it they render
  // their "empty vault" state during the several seconds the fetch takes,
  // which reads as "there is nothing here" rather than "not yet loaded".
  const { notes, isLoading: notesLoading } = useKnowledgeNotes();
  // Pre-warm the shared doc-title index (module-level TTL cache) so the
  // first document editor the user opens finds it hot instead of paying
  // the two index round-trips itself.
  useVaultDocIndex();
  const fileNodes = useFileNodesInSelectedDrive();
  const showDocumentEditor = !!children;

  const handleGraphFocusChange = useCallback((focus: GraphFocus | null) => {
    setGraphFocus(focus);
  }, []);

  const handleClearGraphFocus = useCallback(() => {
    setGraphFocus(null);
    setGraphClearNonce((n) => n + 1);
  }, []);

  // MoCs sourced from the knowledgeGraph subgraph projection — same
  // round-trip the notes sidebar already makes (no extra fetch). Tensions
  // remain stubbed: the graph-indexer doesn't ingest bai/tension yet, so
  // there's no projection to read; revisit when that lands.
  const { mocs } = useKnowledgeMocs();
  const tensions = useMemo<
    Array<{
      id: string;
      title: string;
      status: string | null;
      involvedRefs: string[];
    }>
  >(() => [], []);

  // Count doc types
  const allFiles = useMemo(() => fileNodes ?? [], [fileNodes]);
  const sourceCount = allFiles.filter(
    (n) => n.documentType === "bai/source",
  ).length;

  // Project badge counts non-ARCHIVED projects. FileNode only carries
  // documentType, not state, so the (few) project documents are read
  // from the server directly.
  const projectSpecs = useMemo<ReactorDocSpec[]>(
    () =>
      allFiles
        .filter((n) => n.documentType === "bai/project")
        .map((n) => ({ id: n.id, documentType: n.documentType, name: n.name })),
    [allFiles],
  );
  const { docs: projectDocs } = useReactorDocsWithRefetch(projectSpecs, {
    pollMs: 60_000,
  });
  const projectCount = projectDocs.filter((d) => {
    const status = (
      d.state as unknown as { global: { status?: ProjectStatus } }
    ).global.status;
    return status !== "ARCHIVED";
  }).length;

  // Find singleton doc IDs for direct navigation
  const pipelineDocId = allFiles.find(
    (n) => n.documentType === "bai/pipeline-queue",
  )?.id;
  const healthReportDocId = allFiles.find(
    (n) => n.documentType === "bai/health-report",
  )?.id;
  const vaultConfigDocId = allFiles.find(
    (n) => n.documentType === "bai/vault-config",
  )?.id;

  function handleSwitchView(mode: ViewMode) {
    // For singleton tabs, navigate directly to the document (opens its editor)
    if (mode === "pipeline" && pipelineDocId) {
      setSelectedNode(pipelineDocId);
      return;
    }
    if (mode === "health" && healthReportDocId) {
      setSelectedNode(healthReportDocId);
      return;
    }
    if (mode === "config" && vaultConfigDocId) {
      setSelectedNode(vaultConfigDocId);
      return;
    }
    // Leaving the graph restores the default sidebar list.
    if (mode !== "graph") {
      setGraphFocus(null);
    }
    // For list/custom views, deselect any open doc
    if (showDocumentEditor) setSelectedNode(undefined);
    setViewMode(mode);
  }

  const TABS: {
    key: ViewMode;
    label: string;
    badge?: number;
    icon: React.ReactNode;
  }[] = [
    {
      key: "search",
      label: "Search",
      icon: (
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
      ),
    },
    {
      key: "notes",
      label: "Notes",
      // No badge while loading — a "0" here would be a false count.
      badge: notes.length > 0 ? notes.length : undefined,
      icon: (
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
      ),
    },
    {
      key: "graph",
      label: "Graph",
      icon: (
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="6" cy="6" r="3" />
          <circle cx="18" cy="18" r="3" />
          <circle cx="18" cy="6" r="3" />
          <path d="M8.5 7.5l7 7M8.5 6h7" />
        </svg>
      ),
    },
    {
      key: "sources",
      label: "Sources",
      badge: sourceCount > 0 ? sourceCount : undefined,
      icon: (
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
        </svg>
      ),
    },
    {
      key: "projects",
      label: "Projects",
      badge: projectCount > 0 ? projectCount : undefined,
      icon: (
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
          <path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16" />
        </svg>
      ),
    },
    {
      key: "activity",
      label: "Activity",
      icon: (
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
      ),
    },
    {
      key: "pipeline",
      label: "Pipeline",
      icon: (
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
        </svg>
      ),
    },
    {
      key: "health",
      label: "Health",
      icon: (
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M22 12h-6l-2 3-4-6-2 3H2" />
        </svg>
      ),
    },
    {
      key: "config" as ViewMode,
      label: "Config",
      icon: (
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      ),
    },
  ];

  return (
    <div className="flex h-full relative">
      <VaultSidebar
        notes={notes}
        mocs={mocs}
        isLoading={notesLoading}
        graphFocus={graphFocus}
        onClearGraphFocus={handleClearGraphFocus}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <div
          className="flex items-center justify-between px-4 py-2"
          style={{
            borderBottom: "1px solid var(--bai-border)",
            backgroundColor: "var(--bai-surface)",
          }}
        >
          <div className="flex gap-1">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => handleSwitchView(tab.key)}
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
                style={{
                  backgroundColor:
                    viewMode === tab.key && !showDocumentEditor
                      ? "var(--bai-hover)"
                      : "transparent",
                  color:
                    viewMode === tab.key && !showDocumentEditor
                      ? "var(--bai-accent)"
                      : "var(--bai-text-tertiary)",
                }}
              >
                {tab.icon}
                {tab.label}
                {tab.badge !== undefined && (
                  <span
                    className="rounded-full px-1.5 py-0.5 text-[10px]"
                    style={{
                      backgroundColor: "var(--bai-hover)",
                      color: "var(--bai-text-muted)",
                    }}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
            {showDocumentEditor && (
              <span
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium"
                style={{
                  backgroundColor: "var(--bai-hover)",
                  color: "var(--bai-accent)",
                }}
              >
                <svg
                  className="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                Editing
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span
              className="text-[10px]"
              style={{ color: "var(--bai-text-faint)" }}
            >
              {notesLoading && notes.length === 0 ? "…" : `${notes.length}n`}
            </span>
            <ThemeToggle />
            <GettingStartedButton />
            <CreateMenu />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {showDocumentEditor ? (
            <div className="h-full">{children}</div>
          ) : viewMode === "graph" ? (
            <GraphViewPixi
              notes={notes}
              mocs={mocs}
              tensions={tensions}
              onGraphFocusChange={handleGraphFocusChange}
              clearFocusNonce={graphClearNonce}
            />
          ) : viewMode === "search" ? (
            <SearchView isLoading={notesLoading} />
          ) : viewMode === "activity" ? (
            <ActivityView />
          ) : viewMode === "sources" ? (
            <SourceList />
          ) : viewMode === "projects" ? (
            <ProjectsView />
          ) : viewMode === "health" ? (
            <HealthDashboard />
          ) : (
            <NoteList notes={notes} isLoading={notesLoading} />
          )}
        </div>
      </div>
    </div>
  );
}

const CREATE_ITEMS = [
  {
    label: "Add Source",
    type: "bai/source",
    primary: true,
    hint: "Paste content for AI processing",
  },
  {
    label: "Knowledge Note",
    type: "bai/knowledge-note",
    primary: false,
    hint: "Direct atomic claim",
  },
  {
    label: "Map of Content",
    type: "bai/moc",
    primary: false,
    hint: "Organize notes by topic",
  },
  {
    label: "Project",
    type: "bai/project",
    primary: false,
    hint: "Track goals, team, and deliverables",
  },
];

function CreateMenu() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialogItem, setDialogItem] = useState<{
    label: string;
    type: string;
  } | null>(null);

  return (
    <>
      <div className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen(!menuOpen)}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
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
          New
        </button>
        {menuOpen && (
          <div
            className="absolute right-0 z-20 mt-1 w-56 rounded-lg py-1 shadow-xl"
            style={{
              border: "1px solid var(--bai-border)",
              backgroundColor: "var(--bai-surface)",
            }}
          >
            {CREATE_ITEMS.map((item) => (
              <button
                key={item.type}
                type="button"
                onClick={() => {
                  setDialogItem(item);
                  setMenuOpen(false);
                }}
                className="flex w-full flex-col px-3 py-2 text-left"
                style={{
                  borderBottom: item.primary
                    ? "1px solid var(--bai-border)"
                    : undefined,
                }}
              >
                <span
                  className="text-xs"
                  style={{
                    color: item.primary
                      ? "var(--bai-accent)"
                      : "var(--bai-text-secondary)",
                    fontWeight: item.primary ? 600 : 400,
                  }}
                >
                  {item.label}
                </span>
                {item.hint && (
                  <span
                    className="text-[10px]"
                    style={{ color: "var(--bai-text-faint)" }}
                  >
                    {item.hint}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
      <CreateDocumentDialog
        open={!!dialogItem}
        documentType={dialogItem?.type ?? ""}
        documentTypeLabel={dialogItem?.label ?? ""}
        onClose={() => setDialogItem(null)}
      />
    </>
  );
}
