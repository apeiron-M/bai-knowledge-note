import { useState, useEffect, useRef, useMemo } from "react";
import type { EditorProps } from "document-model";
import {
  setSelectedNode,
  useFileNodesInSelectedDrive,
} from "@powerhousedao/reactor-browser";
import {
  useDocumentByIdSafe,
  useDocumentsSafe,
} from "../hooks/use-documents-safe.js";
import { VaultSidebar } from "./VaultSidebar.js";
import { CreateDocumentDialog } from "./CreateDocumentDialog.js";
import { GraphView } from "./GraphView.js";
import { NoteList } from "./NoteList.js";
import { SourceList } from "./SourceList.js";
import { HealthDashboard } from "./HealthDashboard.js";
import { SearchView } from "./SearchView.js";
import { ActivityView } from "./ActivityView.js";
import { GettingStartedButton } from "./GettingStarted.js";
import { useKnowledgeNotes } from "../hooks/use-knowledge-notes.js";
import {
  useKnowledgeGraph,
  buildSyncPayload,
} from "../hooks/use-knowledge-graph.js";
import { useAutoHealth } from "../hooks/use-auto-health.js";
import type {
  KnowledgeGraphAction,
  KnowledgeGraphDocument,
} from "../../../document-models/knowledge-graph/index.js";
import { actions as graphActions } from "../../../document-models/knowledge-graph/index.js";
import { ThemeToggle } from "../../shared/theme-context.js";

type ViewMode =
  | "notes"
  | "graph"
  | "sources"
  | "search"
  | "activity"
  | "pipeline"
  | "health"
  | "config";

export function DriveExplorer({ children }: EditorProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("search");
  const { notes } = useKnowledgeNotes();
  const { graphDoc, graphState, hasGraphDoc } = useKnowledgeGraph(notes);
  const fileNodes = useFileNodesInSelectedDrive();
  const allDocuments = useDocumentsSafe();
  const showDocumentEditor = !!children;

  // Read MOC documents for the graph view
  const mocs = useMemo(() => {
    return (allDocuments ?? [])
      .filter((d) => d.header.documentType === "bai/moc")
      .map((d) => {
        const state = (
          d.state as unknown as { global: Record<string, unknown> }
        ).global;
        return {
          id: d.header.id,
          title: (state.title as string) ?? d.header.name,
          tier: (state.tier as string) ?? null,
          coreIdeas: (
            (state.coreIdeas as Array<{
              noteRef: string;
              contextPhrase: string;
            }>) ?? []
          ).map((ci) => ({
            noteRef: ci.noteRef,
            contextPhrase: ci.contextPhrase,
          })),
          childRefs: (state.childRefs as string[]) ?? [],
        };
      });
  }, [allDocuments]);

  // Read tension documents for the graph view
  const tensions = useMemo(() => {
    return (allDocuments ?? [])
      .filter((d) => d.header.documentType === "bai/tension")
      .map((d) => {
        const state = (
          d.state as unknown as { global: Record<string, unknown> }
        ).global;
        return {
          id: d.header.id,
          title: (state.title as string) ?? d.header.name,
          status: (state.status as string) ?? null,
          involvedRefs: (state.involvedRefs as string[]) ?? [],
        };
      });
  }, [allDocuments]);

  // Auto-generate health metrics
  useAutoHealth(notes, graphState);

  // Auto-sync graph — triggers on any note data change (not just count)
  const graphDocId = graphDoc?.header.id ?? null;
  const [graphDocument, graphDispatch] = useDocumentByIdSafe<
    KnowledgeGraphDocument,
    KnowledgeGraphAction
  >(graphDocId);
  const lastSyncFingerprint = useRef("");

  // Build a fingerprint from note data that changes when links/titles/statuses change
  const notesFingerprint = useMemo(() => {
    return notes
      .map(
        (n) =>
          `${n.id}:${n.title}:${n.status}:${n.links.length}:${n.links.map((l) => l.targetDocumentId).join(",")}`,
      )
      .join("|");
  }, [notes]);

  useEffect(() => {
    if (!graphDocument || !graphDispatch || notes.length === 0) return;
    if (lastSyncFingerprint.current === notesFingerprint) return;
    lastSyncFingerprint.current = notesFingerprint;
    const { nodes: gNodes, edges } = buildSyncPayload(notes);
    graphDispatch(
      graphActions.syncGraph({
        nodes: gNodes,
        edges,
        syncedAt: new Date().toISOString(),
      }),
    );
  }, [graphDocument, graphDispatch, notes, notesFingerprint]);

  // Count doc types
  const allFiles = fileNodes ?? [];
  const sourceCount = allFiles.filter(
    (n) => n.documentType === "bai/source",
  ).length;
  const pipelineExists = allFiles.some(
    (n) => n.documentType === "bai/pipeline-queue",
  );

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
  const graphDocId2 = allFiles.find(
    (n) => n.documentType === "bai/knowledge-graph",
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
      badge: notes.length,
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
    <div className="flex h-full">
      <VaultSidebar notes={notes} />

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
            {hasGraphDoc && graphState && (
              <span
                className="text-[10px]"
                style={{ color: "var(--bai-text-faint)" }}
              >
                {graphState.nodes.length}n / {graphState.edges.length}e
              </span>
            )}
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
            <GraphView
              notes={notes}
              graphState={graphState}
              mocs={mocs}
              tensions={tensions}
            />
          ) : viewMode === "search" ? (
            <SearchView />
          ) : viewMode === "activity" ? (
            <ActivityView />
          ) : viewMode === "sources" ? (
            <SourceList />
          ) : viewMode === "health" ? (
            <HealthDashboard />
          ) : (
            <NoteList notes={notes} />
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
