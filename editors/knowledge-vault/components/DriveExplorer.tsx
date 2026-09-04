import { useState, useMemo, useCallback, useEffect } from "react";
import type { EditorProps } from "document-model";
import {
  isFileNodeKind,
  setSelectedNode,
  useFileNodesInSelectedDrive,
  useSelectedDriveId,
  useSelectedNode,
} from "@powerhousedao/reactor-browser";
import { VaultSidebar } from "./VaultSidebar.js";
import { CreateDocumentDialog } from "./CreateDocumentDialog.js";
import GraphViewPixi, { type GraphFocus } from "./GraphViewPixi.js";
import { NoteList } from "./NoteList.js";
import { SourceList } from "./SourceList.js";
import { ProjectsView } from "./ProjectsView.js";
import { ScopeOfWorkView } from "./ScopeOfWorkView.js";
import { HealthDashboard } from "./HealthDashboard.js";
import { SearchView } from "./SearchView.js";
import { ChatView } from "./ChatView.js";
import { readReturnIntent } from "../lib/chat/openrouter-auth.js";
import { ActivityView } from "./ActivityView.js";
import { GettingStartedButton } from "./GettingStarted.js";
import { useKnowledgeNotes } from "../hooks/use-knowledge-notes.js";
import { useVaultDocIndex } from "../../shared/use-vault-doc-index.js";
import {
  useReactorDocsWithRefetch,
  type ReactorDocSpec,
} from "../hooks/use-reactor-docs.js";
import { useKnowledgeMocs } from "../hooks/use-knowledge-mocs.js";
import { useKnowledgeTensions } from "../hooks/use-knowledge-tensions.js";

type ViewMode =
  | "chat"
  | "notes"
  | "graph"
  | "sources"
  | "projects"
  | "scope"
  | "search"
  | "activity"
  | "pipeline"
  | "health"
  | "config";

/**
 * Document types whose editor ships its own left rail and therefore takes the
 * whole width: the vault sidebar is hidden while one is open.
 *
 * Without this the user faces two stacked navigation columns — the vault's
 * 236px sidebar plus the editor's own rail (264px for Scope of Work) — half a
 * laptop viewport spent on navigation, with two different trees competing to
 * say where you are. The vault's top bar stays put either way, so the tab row
 * remains the way back out.
 */
const EDITORS_WITH_OWN_SIDEBAR = new Set<string>(["powerhouse/scopeofwork"]);

export function DriveExplorer({ children }: EditorProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("chat");
  const driveId = useSelectedDriveId();
  // Returning from OpenRouter remounts the app, and `viewMode` is component
  // state — without this the user lands on Search with their question gone.
  // `readReturnIntent` clears the key, so this cannot loop; a mismatched
  // drive is ignored rather than yanking the user into another drive's chat.
  const [chatReturnDraft, setChatReturnDraft] = useState("");
  useEffect(() => {
    if (!driveId) return;
    const intent = readReturnIntent();
    if (intent && intent.driveId === driveId) {
      setChatReturnDraft(intent.draft);
      setViewMode("chat");
    }
  }, [driveId]);
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
  // Tree-only count, like sources: no document reads just to draw a badge.
  const sowCount = (fileNodes ?? []).filter(
    (n) => n.documentType === "powerhouse/scopeofwork",
  ).length;
  const showDocumentEditor = !!children;
  // `useSelectedNode` can hand back a folder, which carries no documentType.
  const selectedNode = useSelectedNode();
  const selectedDocumentType =
    selectedNode && isFileNodeKind(selectedNode)
      ? selectedNode.documentType
      : undefined;
  const editorOwnsSidebar =
    showDocumentEditor &&
    selectedDocumentType !== undefined &&
    EDITORS_WITH_OWN_SIDEBAR.has(selectedDocumentType);

  const handleGraphFocusChange = useCallback((focus: GraphFocus | null) => {
    setGraphFocus(focus);
  }, []);

  const handleClearGraphFocus = useCallback(() => {
    setGraphFocus(null);
    setGraphClearNonce((n) => n + 1);
  }, []);

  // MoCs and tensions both come from the knowledgeGraph subgraph projection
  // — the same round-trip the notes sidebar already makes (no extra fetch).
  // The graph-indexer indexes bai/tension with one INVOLVES edge per
  // involved note; the graph view draws them only when the reader turns the
  // layer on.
  const { mocs } = useKnowledgeMocs();
  const { tensions } = useKnowledgeTensions();

  // Count doc types
  const allFiles = useMemo(() => fileNodes ?? [], [fileNodes]);
  const sourceCount = allFiles.filter(
    (n) => n.documentType === "bai/source",
  ).length;

  // Project badge: every live envelope across the drive's scope-of-work
  // documents. FileNode only carries documentType, not state, so the (few)
  // scope documents are read from the server directly.
  const projectSpecs = useMemo<ReactorDocSpec[]>(
    () =>
      allFiles
        .filter((n) => n.documentType === "powerhouse/scopeofwork")
        .map((n) => ({ id: n.id, documentType: n.documentType, name: n.name })),
    [allFiles],
  );
  const { docs: projectDocs } = useReactorDocsWithRefetch(projectSpecs, {
    pollMs: 60_000,
  });
  const projectCount = projectDocs.reduce((n, d) => {
    const envelopes =
      (d.state as unknown as { global: { projects?: { scope?: { status?: string } | null }[] } })
        .global.projects ?? [];
    return n + envelopes.filter((p) => p.scope?.status !== "CANCELED").length;
  }, 0);

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
      key: "chat",
      label: "Chat",
      icon: (
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
          <path d="M9 12h.01M12 12h.01M15 12h.01" />
        </svg>
      ),
    },
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
      key: "scope",
      label: "Scope",
      badge: sowCount > 0 ? sowCount : undefined,
      icon: (
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M3 6h18M3 12h12M3 18h6" />
          <circle cx="19" cy="17" r="3" />
        </svg>
      ),
    },
  ];

  return (
    <div className="flex h-full relative">
      {!editorOwnsSidebar && (
        <VaultSidebar
          notes={notes}
          mocs={mocs}
          isLoading={notesLoading}
          graphFocus={graphFocus}
          onClearGraphFocus={handleClearGraphFocus}
        />
      )}

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <div
          className="flex items-center justify-between px-4 py-2"
          style={{
            borderBottom: "1px solid var(--bai-border)",
            backgroundColor: "var(--bai-surface)",
          }}
        >
          <div className="flex items-center gap-1">
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
            <GettingStartedButton />
            <CreateMenu />
            <SettingsMenu
              activeView={viewMode}
              isActive={!showDocumentEditor}
              onSelect={handleSwitchView}
            />
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
          ) : viewMode === "chat" ? (
            <ChatView initialDraft={chatReturnDraft} notes={notes} />
          ) : viewMode === "search" ? (
            <SearchView isLoading={notesLoading} />
          ) : viewMode === "activity" ? (
            <ActivityView />
          ) : viewMode === "sources" ? (
            <SourceList />
          ) : viewMode === "scope" ? (
            <ScopeOfWorkView />
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

/**
 * Views that report on the vault rather than hold its content: what has
 * happened, what is queued, how healthy it is, and how it is configured. They
 * sit behind a single gear so the tab row stays about the knowledge itself.
 *
 * `hint` says what each one answers, since a label alone does not distinguish
 * "Activity" from "Pipeline".
 */
/**
 * Gear menu for the vault's reporting views.
 *
 * Mirrors `CreateMenu`: same dropdown shape, same click-catcher so an outside
 * click closes it. Takes the active view so the gear can show when one of its
 * items is the current one — otherwise collapsing four tabs into an icon would
 * lose the "you are here" the tab row used to give.
 */
function SettingsMenu({
  activeView,
  isActive,
  onSelect,
}: {
  activeView: ViewMode;
  /** False while a document editor covers the view, matching the tab row. */
  isActive: boolean;
  onSelect: (mode: ViewMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const showingSettingsView =
    isActive && SETTINGS_ITEMS.some((i) => i.key === activeView);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors"
        style={{
          backgroundColor: showingSettingsView
            ? "var(--bai-hover)"
            : "transparent",
          color: showingSettingsView
            ? "var(--bai-accent)"
            : "var(--bai-text-tertiary)",
        }}
        title="Vault reports and settings"
        aria-label="Vault reports and settings"
      >
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
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 z-20 mt-1 w-56 rounded-lg py-1 shadow-xl"
            style={{
              border: "1px solid var(--bai-border)",
              backgroundColor: "var(--bai-surface)",
            }}
          >
            {SETTINGS_ITEMS.map((item) => {
              const current = isActive && activeView === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    onSelect(item.key);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-white/5"
                  style={{
                    color: current
                      ? "var(--bai-accent)"
                      : "var(--bai-text-secondary)",
                  }}
                >
                  <span className="shrink-0">{item.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs">{item.label}</span>
                    <span
                      className="block text-[10px]"
                      style={{ color: "var(--bai-text-faint)" }}
                    >
                      {item.hint}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

const SETTINGS_ITEMS: {
  key: ViewMode;
  label: string;
  hint: string;
  icon: React.ReactNode;
}[] = [
  {
    key: "activity",
    hint: "Recent writes across the vault",
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
    hint: "Queued and in-flight processing tasks",
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
    hint: "Diagnostics from the last check",
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
    key: "config",
    hint: "How this vault is set up",
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
          <>
            {/*
              Click-catcher behind the menu: a click anywhere else lands here
              and closes it, so the dropdown does not sit open while the user
              works elsewhere. Same approach as the status menus in
              a document editor — no document-level listener to leak, and it
              stays below the menu's own z-index so the items remain
              clickable.
            */}
            <div
              className="fixed inset-0 z-10"
              onClick={() => setMenuOpen(false)}
            />
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
          </>
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
