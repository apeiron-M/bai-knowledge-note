import { useState, useEffect, useRef } from "react";
import type { EditorProps } from "document-model";
import {
  showCreateDocumentModal,
  setSelectedNode,
  useFileNodesInSelectedDrive,
} from "@powerhousedao/reactor-browser";
import { VaultSidebar } from "./VaultSidebar.js";
import { GraphView } from "./GraphView.js";
import { NoteList } from "./NoteList.js";
import { SourceList } from "./SourceList.js";
import { PipelineView } from "./PipelineView.js";
import { HealthDashboard } from "./HealthDashboard.js";
import { useKnowledgeNotes } from "../hooks/use-knowledge-notes.js";
import { useKnowledgeGraph, buildSyncPayload } from "../hooks/use-knowledge-graph.js";
import {
  useKnowledgeGraphDocumentById,
} from "knowledge-note/document-models/knowledge-graph";
import { actions as graphActions } from "knowledge-note/document-models/knowledge-graph";

type ViewMode = "notes" | "graph" | "sources" | "pipeline" | "health";

export function DriveExplorer({ children }: EditorProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("notes");
  const { notes } = useKnowledgeNotes();
  const { graphDoc, graphState, hasGraphDoc } = useKnowledgeGraph(notes);
  const fileNodes = useFileNodesInSelectedDrive();
  const showDocumentEditor = !!children;

  // Auto-sync graph
  const graphDocId = graphDoc?.header.id ?? null;
  const [graphDocument, graphDispatch] = useKnowledgeGraphDocumentById(graphDocId);
  const lastSyncedNoteCount = useRef(-1);

  useEffect(() => {
    if (!graphDocument || !graphDispatch || notes.length === 0) return;
    if (lastSyncedNoteCount.current === notes.length) return;
    lastSyncedNoteCount.current = notes.length;
    const { nodes: gNodes, edges } = buildSyncPayload(notes);
    graphDispatch(graphActions.syncGraph({ nodes: gNodes, edges, syncedAt: new Date().toISOString() }));
  }, [graphDocument, graphDispatch, notes]);

  // Count doc types
  const allFiles = fileNodes ?? [];
  const sourceCount = allFiles.filter((n) => n.documentType === "bai/source").length;
  const pipelineExists = allFiles.some((n) => n.documentType === "bai/pipeline-queue");

  function handleSwitchView(mode: ViewMode) {
    if (showDocumentEditor) setSelectedNode(undefined);
    setViewMode(mode);
  }

  const TABS: { key: ViewMode; label: string; badge?: number; icon: React.ReactNode }[] = [
    {
      key: "notes", label: "Notes", badge: notes.length,
      icon: <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>,
    },
    {
      key: "graph", label: "Graph",
      icon: <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="6" cy="6" r="3" /><circle cx="18" cy="18" r="3" /><circle cx="18" cy="6" r="3" /><path d="M8.5 7.5l7 7M8.5 6h7" /></svg>,
    },
    {
      key: "sources", label: "Sources", badge: sourceCount > 0 ? sourceCount : undefined,
      icon: <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 016.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" /></svg>,
    },
    {
      key: "pipeline", label: "Pipeline",
      icon: <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>,
    },
    {
      key: "health", label: "Health",
      icon: <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 12h-6l-2 3-4-6-2 3H2" /></svg>,
    },
  ];

  return (
    <div className="flex h-full">
      <VaultSidebar notes={notes} />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center justify-between border-b border-white/10 bg-[#181825] px-4 py-2">
          <div className="flex gap-1">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => handleSwitchView(tab.key)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  viewMode === tab.key && !showDocumentEditor
                    ? "bg-[#313244] text-[#cba6f7]"
                    : "text-gray-400 hover:bg-[#313244]/50 hover:text-gray-300"
                }`}
              >
                {tab.icon}
                {tab.label}
                {tab.badge !== undefined && (
                  <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] text-gray-500">{tab.badge}</span>
                )}
              </button>
            ))}
            {showDocumentEditor && (
              <span className="flex items-center gap-1.5 rounded-md bg-[#313244] px-3 py-1.5 text-xs font-medium text-[#cba6f7]">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                Editing
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {hasGraphDoc && graphState && (
              <span className="text-[10px] text-gray-600">
                {graphState.nodes.length}n / {graphState.edges.length}e
              </span>
            )}
            <CreateMenu />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {showDocumentEditor ? (
            <div className="h-full">{children}</div>
          ) : viewMode === "graph" ? (
            <GraphView notes={notes} graphState={graphState} />
          ) : viewMode === "sources" ? (
            <SourceList />
          ) : viewMode === "pipeline" ? (
            <PipelineView />
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

function CreateMenu() {
  const [open, setOpen] = useState(false);
  const items = [
    { label: "Knowledge Note", type: "bai/knowledge-note" },
    { label: "Map of Content", type: "bai/moc" },
    { label: "Source", type: "bai/source" },
    { label: "Observation", type: "bai/observation" },
    { label: "Tension", type: "bai/tension" },
  ];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-md bg-[#cba6f7] px-3 py-1.5 text-xs font-medium text-[#1e1e2e] transition-colors hover:bg-[#cba6f7]/80"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M12 5v14M5 12h14" />
        </svg>
        New
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-48 rounded-lg border border-white/10 bg-[#181825] py-1 shadow-xl">
          {items.map((item) => (
            <button
              key={item.type}
              type="button"
              onClick={() => {
                showCreateDocumentModal(item.type);
                setOpen(false);
              }}
              className="flex w-full px-3 py-2 text-left text-xs text-gray-300 hover:bg-[#313244]"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
