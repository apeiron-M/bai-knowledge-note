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
import { buildSidebarContext, sourceTitleMap } from "../lib/sidebar-context.js";
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
import { GettingStartedModal } from "./GettingStarted.js";
import type { VaultMenuItem } from "./VaultMenu.js";
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
  // Scopes of work first: a project lives inside one ("Create a scope of work first").
  work: "scope",
  graph: "graph",
};

export type PlaceCounts = {
  notes: number;
  topics: number;
  sources: number;
  work: number;
  contradictions: number;
  /** Files the intake holds for the reader (ready for review, or failed). */
  sourcesWaiting?: number;
  /** Files are converting. */
  sourcesBusy?: boolean;
};

/** The places the sidebar lists, in the design's order. */
export function buildPlaces(counts: PlaceCounts): VaultPlace[] {
  // No count while it is 0 (or still loading): a bare "0" would be a false count.
  const shown = (n: number) => (n > 0 ? n : undefined);
  const all: VaultPlace[] = [
    { id: "ask", label: "Ask" },
    { id: "notes", label: "Notes", count: shown(counts.notes) },
    { id: "topics", label: "Topics", count: shown(counts.topics) },
    // Files waiting for the reader outrank the plain count: a book can
    // convert while the reader is in Ask, and the warning colour calls them back.
    counts.sourcesWaiting
      ? {
          id: "sources",
          label: "Sources",
          count: counts.sourcesWaiting,
          tone: "warn",
          countTitle: `${counts.sourcesWaiting} file${counts.sourcesWaiting === 1 ? "" : "s"} waiting for your review`,
          busy: counts.sourcesBusy,
        }
      : { id: "sources", label: "Sources", count: shown(counts.sources), busy: counts.sourcesBusy },
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

/** The vault's own documents, whose editors Vault settings opens: while one is open, it is the current entry. */
const SETTINGS_DOCUMENTS = new Set<string>(["bai/pipeline-queue", "bai/health-report", "bai/vault-config"]);

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
  const [graphFocus, setGraphFocus] = useState<GraphFocus | null>(null);
  const [graphClearNonce, setGraphClearNonce] = useState(0);
  const [sourcesHome, setSourcesHome] = useState(0);
  // `notesLoading` is true until the first metadata fetch settles. It has
  // to be threaded into every note-derived view: without it they render
  // their "empty vault" state during the several seconds the fetch takes,
  // which reads as "there is nothing here" rather than "not yet loaded".
  const { notes, noteMap, isLoading: notesLoading } = useKnowledgeNotes();
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
  const [guideOpen, setGuideOpen] = useState(false);
  /** The kind of document "Add to the vault" is creating, while its dialog is open. */
  const [creating, setCreating] = useState<(typeof CREATE_ITEMS)[number] | null>(null);
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
  const { mocs, mocMap } = useKnowledgeMocs();
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
    sourcesWaiting: intake.needsUser,
    sourcesBusy: intake.working,
  });

  const viewPlace: VaultPlaceId | undefined =
    viewMode === "notes" ? notesPlace : VIEW_PLACE[viewMode];
  const documentPlace = showDocumentEditor
    ? DOCUMENT_PLACE[selectedDocumentType ?? ""]
    : undefined;
  // The place you are in: the open document's, else the view's.
  const currentPlace = documentPlace ?? viewPlace;
  // The views that report on the vault (search, activity, access, health)
  // belong to no place: no place reads as current while one shows. The
  // settings among them light up Vault settings at the sidebar's foot.
  const settingsActive = showDocumentEditor
    ? SETTINGS_DOCUMENTS.has(selectedDocumentType ?? "")
    : viewMode === "access" || viewMode === "activity" || viewMode === "health";

  function handleSelectPlace(id: VaultPlaceId) {
    if (id === "notes" || id === "topics") setNotesPlace(id);
    const view = PLACE_VIEW[id];
    if (view) handleSwitchView(view);
  }

  // The open source's folder, by title. The tree knows file names only; the
  // title is in each source, read through the per-document cache the Sources
  // view shares — arriving from it, the list paints at once. Only that folder,
  // and only while a source is open.
  const sourceSiblingSpecs = useMemo<ReactorDocSpec[]>(() => {
    if (!showDocumentEditor || selectedDocumentType !== "bai/source" || !selectedNode) return [];
    const folderId = selectedNode.parentFolder ?? null;
    return fileNodes
      .filter((n) => n.documentType === "bai/source" && (n.parentFolder ?? null) === folderId)
      .map((n) => ({ id: n.id, documentType: n.documentType, name: n.name }));
  }, [showDocumentEditor, selectedDocumentType, selectedNode, fileNodes]);
  const { docs: siblingSources } = useReactorDocsWithRefetch(sourceSiblingSpecs);
  const sourceTitles = useMemo(() => sourceTitleMap(siblingSources), [siblingSources]);

  const openDocument = useCallback((id: string) => setSelectedNode(id), []);
  const closeDocument = useCallback(() => setSelectedNode(undefined), []);
  const sidebarContext = useMemo(
    () =>
      buildSidebarContext({
        nodes: allNodes ?? [],
        noteMap,
        mocs,
        mocMap,
        sourceTitles,
        selected: selectedNode,
        graphFocus,
        open: openDocument,
        close: closeDocument,
        clearGraph: handleClearGraphFocus,
      }),
    [
      allNodes,
      noteMap,
      mocs,
      mocMap,
      sourceTitles,
      selectedNode,
      graphFocus,
      openDocument,
      closeDocument,
      handleClearGraphFocus,
    ],
  );

  // Ctrl K (⌘ K) searches the vault from anywhere in it.
  const openSearch = useRef<() => void>(() => undefined);
  openSearch.current = () => handleSwitchView("search");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "k" || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      e.preventDefault();
      openSearch.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // "Who has access" administers authorization, so it is offered only to
  // those who can use it. The server refuses a non-admin regardless — hiding
  // the entry means they are not invited into a dead end. `null`
  // (undetermined) hides it too, rather than flashing an entry about to go.
  const isVaultAdmin = useIsVaultAdmin(driveId);
  const vaultMenuItems = VAULT_MENU.filter(
    (item) => item.key !== "access" || isVaultAdmin === true,
  );
  // The glyph beside the vault's name: its largest topics.
  const glyphSeeds = useMemo(
    () =>
      [...mocs]
        .filter((m) => m.tier !== "HUB")
        .sort((a, b) => b.noteCount - a.noteCount)
        .slice(0, 6)
        .map((m) => m.id),
    [mocs],
  );

  const workTabs = (
    <WorkTabs
      active={viewMode === "scope" ? "scope" : "projects"}
      projects={projectCount}
      scopes={sowCount}
      onSelect={handleSwitchView}
    />
  );
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
    scope: (
      <>
        {workTabs}
        <ScopeOfWorkView />
      </>
    ),
    projects: (
      <>
        {workTabs}
        <ProjectsView />
      </>
    ),
    access: <AccessView />,
    health: <HealthDashboard />,
  };

  return (
    <VaultShell
      sidebarHidden={editorOwnsSidebar}
      sidebarWidth={sidebarWidth}
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
          place={currentPlace}
          settingsActive={settingsActive}
          places={places}
          onSelectPlace={handleSelectPlace}
          vaultName={vaultName}
          glyphSeeds={glyphSeeds}
          menuItems={vaultMenuItems}
          onMenuSelect={(key) => handleSwitchView(key as ViewMode)}
          onSearch={() => handleSwitchView("search")}
          searchActive={viewMode === "search" && !showDocumentEditor}
          onAddSources={() => {
            intake.open();
            handleSwitchView("sources");
          }}
          createItems={CREATE_ITEMS.map(({ key, label, icon }) => ({ key, label, icon }))}
          onCreate={(key) => setCreating(CREATE_ITEMS.find((i) => i.key === key) ?? null)}
          onGettingStarted={() => setGuideOpen(true)}
        />
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
      {guideOpen && <GettingStartedModal onClose={() => setGuideOpen(false)} />}
      <CreateDocumentDialog
        open={creating !== null}
        documentType={creating?.type ?? ""}
        documentTypeLabel={creating?.dialogLabel ?? ""}
        onClose={() => setCreating(null)}
      />
    </VaultShell>
  );
}

/**
 * "This vault": the menu under the vault's name and behind Vault settings at
 * the sidebar's foot (design: the vault menu). Each key is a view mode the
 * vault opens, except `files`, which the sidebar answers itself with the
 * drive tree. The pipeline, health and config entries open their singleton
 * documents' editors, as the gear menu did.
 */
export const VAULT_MENU: VaultMenuItem[] = [
  { key: "config", label: "Vault settings", hint: "name, processing", icon: "gear" },
  { key: "access", label: "Who has access", icon: "users" },
  { key: "pipeline", label: "Processing queue", icon: "queue" },
  { key: "activity", label: "Activity", hint: "recent changes", icon: "clock" },
  { key: "health", label: "Health check", icon: "pulse" },
  { key: "files", label: "Files and folders", icon: "folder" },
];

/**
 * Beside "Add sources": the other things a person adds by hand. Files go
 * through Add sources itself (the intake); these open the create dialog.
 */
const CREATE_ITEMS = [
  {
    key: "note",
    label: "Write a note",
    icon: "pencil",
    type: "bai/knowledge-note",
    dialogLabel: "Knowledge Note",
  },
  {
    key: "topic",
    label: "New topic",
    icon: "newTopic",
    type: "bai/moc",
    dialogLabel: "Map of Content",
  },
  {
    key: "paste",
    label: "Paste text as a source",
    icon: "sources",
    type: "bai/source",
    dialogLabel: "Add Source",
  },
] as const satisfies ReadonlyArray<
  VaultMenuItem & { type: string; dialogLabel: string }
>;

/**
 * Work holds two lists over the same documents (design finding 14): the
 * scopes of work — what is priced and scheduled — and the projects they fund.
 * One place in the sidebar, two tabs here.
 */
function WorkTabs({
  active,
  projects,
  scopes,
  onSelect,
}: {
  active: "projects" | "scope";
  projects: number;
  scopes: number;
  onSelect: (mode: ViewMode) => void;
}) {
  const tabs: { key: "projects" | "scope"; label: string; count: number }[] = [
    { key: "scope", label: "Scopes of work", count: scopes },
    { key: "projects", label: "Projects", count: projects },
  ];
  return (
    <nav
      className="vault-work-tabs flex items-center gap-1 px-4 pt-3"
      aria-label="Work"
    >
      {tabs.map((tab) => {
        const current = tab.key === active;
        return (
          <button
            key={tab.key}
            type="button"
            aria-current={current ? "page" : undefined}
            onClick={() => onSelect(tab.key)}
            className="flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] transition-colors"
            style={{
              backgroundColor: current ? "var(--bai-hover)" : "transparent",
              color: current ? "var(--bai-text)" : "var(--bai-text-tertiary)",
              fontWeight: current ? 600 : 500,
            }}
          >
            {tab.label}
            {tab.count > 0 && (
              <span style={{ color: "var(--bai-text-tertiary)", fontWeight: 400 }}>
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
