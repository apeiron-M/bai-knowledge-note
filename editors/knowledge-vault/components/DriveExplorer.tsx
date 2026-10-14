import { AccessView } from "./access/AccessView.js";
import { useIsVaultAdmin } from "./access/use-is-admin.js";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { EditorProps } from "document-model";
import {
  isFileNodeKind,
  setSelectedNode,
  useFileNodesInSelectedDrive,
  useNodesInSelectedDrive,
  useSelectedDriveId,
  useSelectedNode,
} from "@powerhousedao/reactor-browser";
import { VaultSidebar } from "./VaultSidebar.js";
import { buildSidebarContext } from "../lib/sidebar-context.js";
import { VaultShell } from "./VaultShell.js";
import type { VaultPlace, VaultPlaceId } from "./VaultPlaces.js";
import { DebugErrorBoundary } from "./DebugErrorBoundary.js";
import { VaultLoader } from "../../shared/vault-loader.js";
import { CreateDocumentDialog } from "./CreateDocumentDialog.js";
import GraphView, { type GraphFocus } from "./GraphView.js";
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
import { compactTabs } from "./menu-bar.js";
import { useKnowledgeNotes } from "../hooks/use-knowledge-notes.js";
import { getHostConfig } from "../../shared/host-config.js";
import { useConvertHealth } from "../hooks/use-convert-health.js";
import { useIntakeBatch } from "../hooks/use-intake-batch.js";
import { FileDropOverlay, useVaultFileDrop } from "./intake/FileDropOverlay.js";
import { useAttachmentPort } from "../lib/attachments.js";
import { useVaultDocIndex } from "../../shared/use-vault-doc-index.js";
import { sameDriveNode, useStableList } from "../../shared/use-stable-list.js";
import { useVaultName } from "../hooks/use-vault-name.js";
import {
  useReactorDocsWithRefetch,
  type ReactorDocSpec,
} from "../hooks/use-reactor-docs.js";
import { useKnowledgeMocs } from "../hooks/use-knowledge-mocs.js";
import { useKnowledgeTensions } from "../hooks/use-knowledge-tensions.js";

/** Views a host may open a vault on (`takeOpenView`). */
const OPENABLE_VIEWS = new Set<string>(["chat", "notes", "graph", "search", "sources"]);

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
  | "access"
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

/**
 * The view each place opens. The places list never sees a view mode.
 *
 * A place with no entry is not listed (`buildPlaces`). `contradictions` is
 * withheld on purpose: the vault has no tensions view yet, so a row would land
 * on the notes list. The task that adds that view lights the place up with
 * one line here (`contradictions: "<its view>"`).
 */
export const PLACE_VIEW: Partial<Record<VaultPlaceId, ViewMode>> = {
  ask: "chat",
  notes: "notes",
  topics: "notes",
  sources: "sources",
  work: "projects",
  graph: "graph",
};

export type PlaceCounts = {
  notes: number;
  topics: number;
  sources: number;
  work: number;
  contradictions: number;
};

/** The places the sidebar lists, in the design's order. */
export function buildPlaces(counts: PlaceCounts): VaultPlace[] {
  // No count while it is 0 (or still loading): a bare "0" would be a false count.
  const shown = (n: number) => (n > 0 ? n : undefined);
  const all: VaultPlace[] = [
    { id: "ask", label: "Ask" },
    { id: "notes", label: "Notes", count: shown(counts.notes) },
    { id: "topics", label: "Topics", count: shown(counts.topics) },
    { id: "sources", label: "Sources", count: shown(counts.sources) },
    { id: "work", label: "Work", count: shown(counts.work) },
    { id: "graph", label: "Graph" },
    {
      id: "contradictions",
      label: "Contradictions",
      count: shown(counts.contradictions),
      tone: "warn",
    },
  ];
  return all.filter((p) => PLACE_VIEW[p.id] !== undefined);
}

/**
 * Every view mode the content area renders. Views not listed here (pipeline,
 * config) fall back to `notes`. A place can only be listed if its view is
 * here (`buildPlaces`), and the content record in the component must have an
 * entry for each of these (tsc enforces both).
 */
export const RENDERED_VIEWS = [
  "notes",
  "graph",
  "chat",
  "search",
  "activity",
  "sources",
  "scope",
  "projects",
  "access",
  "health",
] as const satisfies readonly ViewMode[];

type RenderedView = (typeof RENDERED_VIEWS)[number];

function isRenderedView(mode: ViewMode): mode is RenderedView {
  return RENDERED_VIEWS.some((view) => view === mode);
}

/** The place a view belongs to; `notes` is split in two by `notesPlace`. */
const VIEW_PLACE: Partial<Record<ViewMode, VaultPlaceId>> = {
  chat: "ask",
  sources: "sources",
  projects: "work",
  scope: "work",
  graph: "graph",
};

/** The place an open document sits in, so the sidebar follows it. */
const DOCUMENT_PLACE: Record<string, VaultPlaceId> = {
  "bai/knowledge-note": "notes",
  "bai/moc": "topics",
  "bai/observation": "contradictions",
  "bai/tension": "contradictions",
  "bai/source": "sources",
  "powerhouse/scopeofwork": "work",
};

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
  const [notesPlace, setNotesPlace] = useState<"notes" | "topics">("notes");
  const lastPlace = useRef<VaultPlaceId>("ask");
  const [graphFocus, setGraphFocus] = useState<GraphFocus | null>(null);
  const [graphClearNonce, setGraphClearNonce] = useState(0);
  const [sourcesHome, setSourcesHome] = useState(0);
  // `notesLoading` is true until the first metadata fetch settles. It has
  // to be threaded into every note-derived view: without it they render
  // their "empty vault" state during the several seconds the fetch takes,
  // which reads as "there is nothing here" rather than "not yet loaded".
  const { notes, isLoading: notesLoading } = useKnowledgeNotes();
  // The intake batch lives here, above the view switch, so a tab switch never
  // unmounts a conversion in flight and the Sources tab badge can read it.
  const attachments = useAttachmentPort();
  const convert = useConvertHealth();
  const intake = useIntakeBatch({
    attachments,
    formats: convert.formats,
    maxUploadBytes: convert.maxUploadBytes,
    // How many files convert at once, per lane: the converter says.
    slots: convert.slots,
    modelExtensions: convert.modelExtensions,
  });
  // Pre-warm the shared doc-title index (module-level TTL cache) so the
  // first document editor the user opens finds it hot instead of paying
  // the two index round-trips itself.
  useVaultDocIndex();
  // Stable identity while the tree is unchanged; the upstream hook
  // re-`filter()`s every render, which invalidated `allFiles` →
  // `projectSpecs` → the whole scope-of-work document fetch below.
  const fileNodes = useStableList(useFileNodesInSelectedDrive(), sameDriveNode);
  // Every node, folders included: a source folder's list is titled by its name.
  const allNodes = useNodesInSelectedDrive();
  // Tree-only count, like sources: no document reads just to draw a badge.
  const sowCount = fileNodes.filter(
    (n) => n.documentType === "powerhouse/scopeofwork",
  ).length;
  const showDocumentEditor = !!children;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const vaultName = useVaultName();
  // Published by the sidebar, which owns its width; the shell only reads it.
  const [sidebarWidth, setSidebarWidth] = useState<number | undefined>();
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

  // A hosted editor draws its own sidebar; `VaultShell` gives it the left
  // column and the top row (see `sidebarHidden` there).
  // The shell's host bar. The shell measures it for the hosted editor's top
  // row (`--vault-topbar-h`); here its width decides the tab labels.
  const topBarRef = useRef<HTMLDivElement>(null);
  // The bar's width decides whether the tabs keep their labels (menu-bar.ts): in a narrow window the actions
  // (help, New, settings) must stay on screen, so the tabs give way — icons first, then a sideways scroll.
  const [barWidth, setBarWidth] = useState(0);
  useEffect(() => {
    const el = topBarRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => setBarWidth(entries[0]?.contentRect.width ?? 0));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const compact = compactTabs(barWidth);
  const tabRowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const active = tabRowRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (active && typeof active.scrollIntoView === "function") active.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [viewMode, compact]);

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
  const allFiles = useMemo(() => fileNodes, [fileNodes]);
  const sourceCount = allFiles.filter(
    (n) => n.documentType === "bai/source",
  ).length;

  // An empty vault opens on Sources, whose empty state is the intake landing.
  // "Empty" is a claim about the server: the tree must have been read (the
  // vault's singletons are files, so a read tree is never length 0), the note
  // fetch settled, and both notes and sources genuinely absent. Decided once,
  // so a user who navigates away is not dragged back.
  const landedOnIntake = useRef(false);
  useEffect(() => {
    if (landedOnIntake.current) return;
    if (
      fileNodes.length > 0 &&
      !notesLoading &&
      notes.length === 0 &&
      sourceCount === 0
    ) {
      landedOnIntake.current = true;
      setViewMode("sources");
    }
  }, [fileNodes.length, notesLoading, notes.length, sourceCount]);

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
      (
        d.state as unknown as {
          global: { projects?: { scope?: { status?: string } | null }[] };
        }
      ).global.projects ?? [];
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
    // The Sources tab clicked while its list is showing: back to all sources.
    if (mode === "sources" && viewMode === "sources" && !showDocumentEditor)
      setSourcesHome((n) => n + 1);
    // For list/custom views, deselect any open doc
    if (showDocumentEditor) setSelectedNode(undefined);
    setViewMode(mode);
  }

  // Files dragged in anywhere join the batch, and the view moves to Sources,
  // where the batch is — the overlay says so before the drop.
  const fileDrop = useVaultFileDrop({
    ready: convert.configured,
    onDrop: (files) => {
      intake.onFiles(files);
      // Already on the Sources list: stay in the folder you are in.
      if (viewMode !== "sources" || showDocumentEditor)
        handleSwitchView("sources");
    },
  });

  // Files the host collected before this vault opened (the desktop app's setup
  // guide) join the batch once — exactly as a drop.
  const handedOver = useRef<string | null>(null);
  // The latest render's intake and view switch; the effect runs once per drive.
  const takeHandedFiles = useRef<(id: string) => void>(() => undefined);
  takeHandedFiles.current = (id) => {
    const files = getHostConfig()?.takeIntakeFiles?.(id) ?? [];
    if (files.length === 0) return;
    intake.onFiles(files);
    handleSwitchView("sources");
  };
  // Taken once conversion is ready — or once it has stopped waiting for it, so the
  // intake shows each file with its reason instead of the files going nowhere.
  const canTake = convert.configured || (convert.settled && !convert.checking);
  useEffect(() => {
    if (!driveId || !canTake || handedOver.current === driveId) return;
    handedOver.current = driveId;
    takeHandedFiles.current(driveId);
  }, [driveId, canTake]);

  // The view the host asked this vault to open on (the setup guide's overview), once per drive.
  const openedView = useRef<string | null>(null);
  useEffect(() => {
    if (!driveId || openedView.current === driveId) return;
    openedView.current = driveId;
    const view = getHostConfig()?.takeOpenView?.(driveId);
    if (view && OPENABLE_VIEWS.has(view)) setViewMode(view as ViewMode);
  }, [driveId]);

  const places = buildPlaces({
    notes: notes.length,
    topics: mocs.length,
    sources: sourceCount,
    work: projectCount,
    contradictions: tensions.length,
  });

  const viewPlace: VaultPlaceId | undefined =
    viewMode === "notes" ? notesPlace : VIEW_PLACE[viewMode];
  const documentPlace = showDocumentEditor
    ? DOCUMENT_PLACE[selectedDocumentType ?? ""]
    : undefined;
  // The views that report on the vault (activity, health, …) belong to no
  // place: the list keeps showing the one you were last in.
  const currentPlace = documentPlace ?? viewPlace;
  if (currentPlace) lastPlace.current = currentPlace;
  const place = currentPlace ?? lastPlace.current;

  function handleSelectPlace(id: VaultPlaceId) {
    if (id === "notes" || id === "topics") setNotesPlace(id);
    const view = PLACE_VIEW[id];
    if (view) handleSwitchView(view);
  }

  const openDocument = useCallback((id: string) => setSelectedNode(id), []);
  const closeDocument = useCallback(() => setSelectedNode(undefined), []);
  const sidebarContext = useMemo(
    () =>
      buildSidebarContext({
        nodes: allNodes ?? [],
        notes,
        mocs,
        selected: selectedNode,
        graphFocus,
        open: openDocument,
        close: closeDocument,
        clearGraph: handleClearGraphFocus,
      }),
    [
      allNodes,
      notes,
      mocs,
      selectedNode,
      graphFocus,
      openDocument,
      closeDocument,
      handleClearGraphFocus,
    ],
  );

  const TABS: {
    key: ViewMode;
    label: string;
    badge?: number;
    /** `warn`: the badge is a call to act ("needs you"), not a count. */
    badgeTone?: "warn";
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
      // Files waiting for the user (ready for review, or failed) outrank the
      // plain count: a book can convert while the user is in Chat and the
      // badge calls them back.
      badge:
        intake.needsUser > 0
          ? intake.needsUser
          : sourceCount > 0
            ? sourceCount
            : undefined,
      badgeTone: intake.needsUser > 0 ? "warn" : undefined,
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

  const renderedViews: Record<RenderedView, ReactNode> = {
    notes: <NoteList notes={notes} isLoading={notesLoading} />,
    graph: (
      <GraphView
        notes={notes}
        mocs={mocs}
        tensions={tensions}
        onGraphFocusChange={handleGraphFocusChange}
        clearFocusNonce={graphClearNonce}
        layoutKey={driveId ?? undefined}
      />
    ),
    chat: <ChatView initialDraft={chatReturnDraft} notes={notes} />,
    search: <SearchView isLoading={notesLoading} />,
    activity: <ActivityView />,
    sources: (
      <SourceList intake={intake} convert={convert} homeSignal={sourcesHome} />
    ),
    scope: <ScopeOfWorkView />,
    projects: <ProjectsView />,
    access: <AccessView />,
    health: <HealthDashboard />,
  };

  return (
    <VaultShell
      title={vaultName}
      onTitleClick={() => setSelectedNode(undefined)}
      sidebarHidden={editorOwnsSidebar}
      sidebarWidth={sidebarWidth}
      settingsOpen={settingsOpen}
      barRef={topBarRef}
      fileDrop={{
        rootProps: fileDrop.rootProps,
        overlay: fileDrop.active && (
          <FileDropOverlay
            ready={convert.configured}
            settled={convert.settled}
            formats={convert.formats}
            maxUploadBytes={convert.maxUploadBytes}
            inBatch={
              intake.files.filter((f) => f.publishedIds === undefined).length
            }
            onLeave={fileDrop.onLeave}
          />
        ),
      }}
      sidebar={
        <VaultSidebar
          notes={notes}
          isLoading={notesLoading}
          context={sidebarContext}
          onWidthChange={setSidebarWidth}
          place={place}
          places={places}
          onSelectPlace={handleSelectPlace}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      }
      tabs={
        <div ref={tabRowRef} className="kv-tab-row flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => handleSwitchView(tab.key)}
              aria-label={tab.label}
              title={compact ? tab.label : undefined}
              aria-current={viewMode === tab.key && !showDocumentEditor ? "page" : undefined}
              className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md ${compact ? "px-2" : "px-3"} py-1.5 text-xs font-medium transition-colors`}
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
              {!compact && tab.label}
              {tab.badge !== undefined && (
                <span
                  className="rounded-full px-1.5 py-0.5 text-[10px]"
                  title={
                    tab.badgeTone === "warn"
                      ? `${tab.badge} file${tab.badge === 1 ? "" : "s"} waiting for your review`
                      : undefined
                  }
                  style={
                    tab.badgeTone === "warn"
                      ? {
                          backgroundColor: "var(--bai-warn)",
                          color: "var(--bai-accent-text)",
                          fontWeight: 600,
                        }
                      : {
                          backgroundColor: "var(--bai-hover)",
                          color: "var(--bai-text-muted)",
                        }
                  }
                >
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
          {showDocumentEditor && (
            <span
              className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md ${compact ? "px-2" : "px-3"} py-1.5 text-xs font-medium`}
              title={compact ? "Editing" : undefined}
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
              {!compact && "Editing"}
            </span>
          )}
        </div>
      }
      barControls={
        <>
          <GettingStartedButton />
          <CreateMenu />
          <SettingsMenu
            activeView={viewMode}
            isActive={!showDocumentEditor}
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            onSelect={handleSwitchView}
          />
        </>
      }
    >
      {showDocumentEditor ? (
        <div className="h-full">
          {/*
            The editor pane waits and fails on its own. `children` is
            Connect's DocumentEditorContainer, whose useSelectedDocument()
            suspends while an uncached document is fetched and throws
            "There is no selected document" in a sync race. Without these
            two, the nearest catchers were Connect's Suspense around the
            whole app and the DebugErrorBoundary around this component —
            so opening a document replaced the entire vault with a loader
            and then mounted it again from scratch, taking the sidebar's
            tab, search, open tree folders and width with it.

            Keyed by document so a failure in one does not stick to the
            next one opened from the (still usable) sidebar.
          */}
          <DebugErrorBoundary
            key={selectedNode?.id}
            retryLabel="Opening document…"
          >
            <Suspense
              fallback={
                <div className="flex h-full">
                  <VaultLoader label="Opening document…" />
                </div>
              }
            >
              {children}
            </Suspense>
          </DebugErrorBoundary>
        </div>
      ) : isRenderedView(viewMode) ? (
        renderedViews[viewMode]
      ) : (
        renderedViews.notes
      )}
    </VaultShell>
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
  open,
  onOpenChange,
  onSelect,
}: {
  activeView: ViewMode;
  /** False while a document editor covers the view, matching the tab row. */
  isActive: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (mode: ViewMode) => void;
}) {
  // Access administers authorization, so it is offered only to those who can
  // use it. The server refuses a non-admin regardless — hiding the entry means
  // they are not invited into a dead end. `null` (undetermined) hides it too,
  // to avoid flashing an item that is about to disappear.
  const driveId = useSelectedDriveId();
  const isVaultAdmin = useIsVaultAdmin(driveId);
  const items = SETTINGS_ITEMS.filter(
    (i) => i.key !== "access" || isVaultAdmin === true,
  );
  const showingSettingsView =
    isActive && items.some((i) => i.key === activeView);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
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
        aria-expanded={open}
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
          <div className="fixed inset-0 z-10" onClick={() => onOpenChange(false)} />
          <div
            className="absolute right-0 z-20 mt-1 w-56 rounded-lg py-1 shadow-xl"
            style={{
              border: "1px solid var(--bai-border)",
              backgroundColor: "var(--bai-surface)",
            }}
          >
            {items.map((item) => {
              const current = isActive && activeView === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    onSelect(item.key);
                    onOpenChange(false);
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
    key: "access",
    hint: "Who can read and write this vault",
    label: "Access",
    icon: (
      <svg
        className="h-4 w-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
  },
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
