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
import {
  buildSidebarContext,
  sourceTitleMap,
  type ContextOrigin,
} from "../lib/sidebar-context.js";
import { TopicsView } from "./TopicsView.js";
import { ContradictionsView } from "./ContradictionsView.js";
import { buildContradictions } from "../lib/contradictions.js";
import {
  hubMap,
  noteTopicIndex,
  notesPerSourceDocument,
  rankedTopics,
  sourceDocuments,
} from "../lib/vault-lookups.js";
import { SearchPalette } from "./SearchPalette.js";
import type { PaletteData, PaletteRow, PaletteScope } from "../lib/palette-search.js";
import { readCurrentThreadId, writeCurrentThreadId } from "../lib/chat/chat-storage.js";
import { useRecentChats } from "../hooks/use-recent-chats.js";
import { chatRun, stopChatRun } from "../hooks/chat-runs.js";
import { formatLastModified } from "../lib/format-time.js";
import { readSourcesTab, writeOpenFolder, writeSourcesTab } from "../lib/source-tree.js";
import { SourceTimelineView } from "./timeline/SourceTimelineView.js";
import type { TimelineGraphData } from "../hooks/use-source-timeline.js";
import { saveSearchQuery } from "../hooks/use-graph-search.js";
import { usePaletteSemantic } from "../hooks/use-palette-semantic.js";
import {
  clearTensionClose,
  requestTensionClose,
  type TensionCloseKind,
} from "../../shared/tension-intent.js";
import { VaultShell } from "./VaultShell.js";
import type { VaultPlace, VaultPlaceId } from "./VaultPlaces.js";
import { DebugErrorBoundary } from "./DebugErrorBoundary.js";
import { VaultLoader } from "../../shared/vault-loader.js";
import { CreateDocumentDialog } from "./CreateDocumentDialog.js";
import GraphView, { type GraphFocus } from "./GraphView.js";
import { EMPTY_GRAPH_FILTER, type GraphFilter } from "./graph/model.js";
import type { OverTime } from "./GraphView.js";
import { NoteList, type NoteScope } from "./NoteList.js";
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
import { getHostConfig, isBrowserHost } from "../../shared/host-config.js";
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
const OPENABLE_VIEWS = new Set<string>([
  "chat",
  "notes",
  "topics",
  "graph",
  "search",
  "sources",
  "contradictions",
]);

type ViewMode =
  | "chat"
  | "notes"
  | "topics"
  | "contradictions"
  | "graph"
  | "sources"
  | "timeline"
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
 * A place with no entry is not listed (`buildPlaces`).
 */
export const PLACE_VIEW: Partial<Record<VaultPlaceId, ViewMode>> = {
  ask: "chat",
  notes: "notes",
  topics: "topics",
  sources: "sources",
  // Scopes of work first: a project lives inside one ("Create a scope of work first").
  work: "scope",
  graph: "graph",
  contradictions: "contradictions",
};

export type PlaceCounts = {
  notes: number;
  topics: number;
  sources: number;
  work: number;
  /** Open contradictions: the place is listed only while there are any. */
  contradictions: number;
  /** Files the intake holds for the reader (ready for review, or failed). */
  sourcesWaiting?: number;
  /** Files are converting. */
  sourcesBusy?: boolean;
};

/**
 * The places the sidebar lists, in the design's order. Contradictions joins
 * them only while the vault has open ones (design: "Contradictions") — and
 * while you are in it, so resolving the last one does not pull the place out
 * from under you.
 */
export function buildPlaces(counts: PlaceCounts, current?: VaultPlaceId): VaultPlace[] {
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
  return all.filter(
    (p) =>
      PLACE_VIEW[p.id] !== undefined &&
      (p.id !== "contradictions" || counts.contradictions > 0 || current === "contradictions"),
  );
}

/**
 * Every place the vault can list, for the Getting started guide: Contradictions
 * is in it (the sidebar shows it only while some are open). The guide prints
 * these labels, so a renamed place renames itself there.
 */
export const GUIDE_PLACES: VaultPlace[] = buildPlaces({
  notes: 0,
  topics: 0,
  sources: 0,
  work: 0,
  contradictions: 1,
});

/**
 * Every view mode the content area renders. Views not listed here (pipeline,
 * config) fall back to `notes`. A place can only be listed if its view is
 * here (`buildPlaces`), and the content record in the component must have an
 * entry for each of these (tsc enforces both).
 */
export const RENDERED_VIEWS = [
  "notes",
  "topics",
  "contradictions",
  "graph",
  "chat",
  "search",
  "activity",
  "sources",
  "timeline",
  "scope",
  "projects",
  "access",
  "health",
] as const satisfies readonly ViewMode[];

type RenderedView = (typeof RENDERED_VIEWS)[number];

function isRenderedView(mode: ViewMode): mode is RenderedView {
  return RENDERED_VIEWS.some((view) => view === mode);
}

/** The place a view belongs to. */
const VIEW_PLACE: Partial<Record<ViewMode, VaultPlaceId>> = {
  chat: "ask",
  notes: "notes",
  topics: "topics",
  contradictions: "contradictions",
  sources: "sources",
  // Sources holds two views over the same documents: the folders, and when each thing arrived.
  timeline: "sources",
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
  const [graphFocus, setGraphFocus] = useState<GraphFocus | null>(null);
  const [graphClearNonce, setGraphClearNonce] = useState(0);
  // The graph's legend filter: kept while the vault is open, never saved.
  const [graphFilter, setGraphFilter] =
    useState<GraphFilter>(EMPTY_GRAPH_FILTER);
  // Graph › Over time, and the addition the timeline's Show in graph lit. Held here so it survives an open document.
  const [graphTime, setGraphTime] = useState<OverTime>({ on: false, pick: null });
  const [sourcesHome, setSourcesHome] = useState(0);
  // `notesLoading` is true until the first metadata fetch settles. It has
  // to be threaded into every note-derived view: without it they render
  // their "empty vault" state during the several seconds the fetch takes,
  // which reads as "there is nothing here" rather than "not yet loaded".
  const {
    notes,
    noteMap,
    isLoading: notesLoading,
    serverAllNodes,
    graphNodes,
    graphEdges,
    error: graphError,
    refetch: refetchGraph,
  } = useKnowledgeNotes();
  // The source timeline's fallback reads this graph rather than loading its own.
  /** The Notes list narrowed to one addition's notes (See its notes, in Sources › Timeline). */
  const [notesScope, setNotesScope] = useState<NoteScope | null>(null);
  const timelineGraph = useMemo<TimelineGraphData>(
    () => ({ allNodes: serverAllNodes, nodes: graphNodes, edges: graphEdges, isLoading: notesLoading, error: graphError, refetch: refetchGraph }),
    [serverAllNodes, graphNodes, graphEdges, notesLoading, graphError, refetchGraph],
  );
  // The intake batch lives here, above the view switch, so a tab switch never
  // unmounts a conversion in flight and the Sources tab badge can read it.
  // A browser vault has no attachment store: sources keep their text, not the original file.
  const attachmentPort = useAttachmentPort();
  const attachments = isBrowserHost() ? undefined : attachmentPort;
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

  // Contradictions as the reader sees them: each tension's notes as claims,
  // with the reason recorded on the link between them — all from data the
  // vault already holds (the projection and the drive tree).
  const treeNodes = useStableList(allNodes, sameTreeNode);
  const topicOf = useMemo(() => noteTopicIndex(mocs), [mocs]);
  const sourceDocs = useMemo(() => sourceDocuments(treeNodes), [treeNodes]);
  const contradictions = useMemo(
    () => buildContradictions(tensions, { noteMap, topicOf, sourceOf: sourceDocs.bySource }),
    [tensions, noteMap, topicOf, sourceDocs],
  );
  const openContradictions = contradictions.filter((c) => c.status === "OPEN").length;
  const tensionById = useMemo(() => new Map(tensions.map((t) => [t.id, t] as const)), [tensions]);

  // Where the open note was opened from — a topic map (one of its core ideas)
  // or a contradiction (one of its claims). The sidebar keeps that place's
  // list, and closing the note goes back there (design: "a claim opens its
  // note and Esc returns to the contradiction").
  const [origin, setOrigin] = useState<ContextOrigin | null>(null);
  /** Set just before the vault itself deselects (a place, a view): no going back. */
  const leavingOnPurpose = useRef(false);
  /** A note about to open from the Contradictions list, with where it came from. */
  const pendingOrigin = useRef<{ noteId: string; origin: ContextOrigin } | null>(null);
  const previousDoc = useRef<{ id: string; type: string | undefined; driveId: string | undefined } | null>(null);
  // The latest data, read when the selection moves (not a reason to re-run).
  const lookups = useRef({ mocMap, tensionById, origin, driveId });
  lookups.current = { mocMap, tensionById, origin, driveId };

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
  // Only before the person does anything: the tree and the notes can finish
  // loading after they have clicked a place or typed a question, and landing
  // then would pull them away mid-question.
  useEffect(() => {
    const touched = () => {
      landedOnIntake.current = true;
    };
    window.addEventListener("pointerdown", touched, { capture: true, once: true });
    window.addEventListener("keydown", touched, { capture: true, once: true });
    return () => {
      window.removeEventListener("pointerdown", touched, { capture: true });
      window.removeEventListener("keydown", touched, { capture: true });
    };
  }, []);
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
    // Any navigation shows the whole Notes list again; See its notes narrows it after this.
    setNotesScope(null);
    // Leaving the graph restores the default sidebar list, and puts out the lit addition.
    if (mode !== "graph") {
      setGraphFocus(null);
      setGraphTime((t) => (t.pick ? { ...t, pick: null } : t));
    }
    // The Sources tab clicked while its list is showing: back to all sources.
    if (mode === "sources" && viewMode === "sources" && !showDocumentEditor)
      setSourcesHome((n) => n + 1);
    // The place reopens on the Sources view last looked at.
    if (mode === "sources") writeSourcesTab("folders");
    if (mode === "timeline") writeSourcesTab("timeline");
    // For list/custom views, deselect any open doc
    if (showDocumentEditor) {
      leavingOnPurpose.current = true;
      setSelectedNode(undefined);
    }
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

  const viewPlace: VaultPlaceId | undefined = VIEW_PLACE[viewMode];
  const documentPlace = showDocumentEditor
    ? // A note opened from a map or a contradiction is still in that place.
      ((selectedDocumentType === "bai/knowledge-note" ? origin?.place : undefined) ??
      DOCUMENT_PLACE[selectedDocumentType ?? ""])
    : undefined;
  // The place you are in: the open document's, else the view's.
  const currentPlace = documentPlace ?? viewPlace;

  const places = buildPlaces(
    {
      notes: notes.length,
      // The overview is the page every topic hangs from, not a topic.
      topics: mocs.length - (hubMap(mocs) ? 1 : 0),
      sources: sourceCount,
      work: projectCount,
      contradictions: openContradictions,
      sourcesWaiting: intake.needsUser,
      sourcesBusy: intake.working,
    },
    currentPlace,
  );
  // The views that report on the vault (search, activity, access, health)
  // belong to no place: no place reads as current while one shows. The
  // settings among them light up Vault settings at the sidebar's foot.
  const settingsActive = showDocumentEditor
    ? SETTINGS_DOCUMENTS.has(selectedDocumentType ?? "")
    : viewMode === "access" || viewMode === "activity" || viewMode === "health";

  function handleSelectPlace(id: VaultPlaceId) {
    const view = PLACE_VIEW[id];
    if (view === "sources" && readSourcesTab() === "timeline") handleSwitchView("timeline");
    else if (view) handleSwitchView(view);
  }

  // Follow the selection: remember where a note was opened from, and when its
  // own close (×) leaves nothing selected, go back there.
  const selectedId = selectedNode?.id;
  useEffect(() => {
    const previous = previousDoc.current;
    previousDoc.current = selectedId
      ? { id: selectedId, type: selectedDocumentType, driveId: lookups.current.driveId ?? undefined }
      : null;
    const onPurpose = leavingOnPurpose.current;
    leavingOnPurpose.current = false;
    const { mocMap: maps, tensionById: byId, origin: from, driveId: inDrive } = lookups.current;
    const pending = pendingOrigin.current;
    pendingOrigin.current = null;

    // The note's own close (the toolbar's ×) selects the folder it sits in:
    // that, and only that, goes back to where it was opened from. Nothing
    // selected — Connect deselecting, Back, another vault, a new document not
    // in the tree yet — is not a close, and leaves you where you are.
    if (selectedId && selectedDocumentType === undefined) {
      setOrigin(null);
      if (
        from &&
        !onPurpose &&
        inDrive &&
        previous?.type === "bai/knowledge-note" &&
        previous.driveId === inDrive
      ) {
        setSelectedNode(from.id);
      }
      return;
    }
    if (!selectedId) {
      setOrigin(null);
      return;
    }
    if (selectedDocumentType !== "bai/knowledge-note") {
      setOrigin(null);
      return;
    }
    const holds = (o: ContextOrigin) =>
      o.place === "topics"
        ? (maps.get(o.id)?.coreIdeas.some((idea) => idea.noteRef === selectedId) ?? false)
        : (byId.get(o.id)?.involvedRefs.includes(selectedId) ?? false);
    const fromPrevious: ContextOrigin | null =
      previous?.type === "bai/moc"
        ? { place: "topics", id: previous.id }
        : previous?.type === "bai/tension"
          ? { place: "contradictions", id: previous.id }
          : null;
    if (pending && pending.noteId === selectedId) setOrigin(pending.origin);
    else if (fromPrevious && holds(fromPrevious)) setOrigin(fromPrevious);
    // Moving on to another note keeps the place only while it holds that note too.
    else if (from && holds(from)) setOrigin(from);
    else setOrigin(null);
  }, [selectedId, selectedDocumentType]);

  // Esc in a note opened from a map or a contradiction goes back to it —
  // unless the reader is typing, or something on top (a dialog, a menu) takes Esc.
  useEffect(() => {
    if (!origin || selectedDocumentType !== "bai/knowledge-note") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return;
      setSelectedNode(origin.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [origin, selectedDocumentType]);

  /** Back to a place's own page from inside it ("All topics", "All contradictions"). */
  const showPlace = useRef<(place: "topics" | "contradictions") => void>(() => undefined);
  showPlace.current = (place) => handleSwitchView(place);
  const showPlaceStable = useCallback(
    (place: "topics" | "contradictions") => showPlace.current(place),
    [],
  );

  /** Open a contradiction — on its closing form when the card asked for one. */
  const openContradiction = useCallback((id: string, closing?: TensionCloseKind) => {
    if (closing) requestTensionClose(id, closing);
    else clearTensionClose();
    setSelectedNode(id);
  }, []);
  /** A claim on a card opens its note; closing the note comes back to the contradiction. */
  const openClaim = useCallback((noteId: string, contradictionId: string) => {
    pendingOrigin.current = { noteId, origin: { place: "contradictions", id: contradictionId } };
    setSelectedNode(noteId);
  }, []);

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

  const openDocument = useCallback((id: string) => {
    // A row in the sidebar opens a document as it is, never on a closing form.
    clearTensionClose();
    setSelectedNode(id);
  }, []);
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
        contradictions,
        origin,
        open: openDocument,
        close: closeDocument,
        clearGraph: handleClearGraphFocus,
        showPlace: showPlaceStable,
      }),
    [
      allNodes,
      noteMap,
      mocs,
      mocMap,
      sourceTitles,
      selectedNode,
      graphFocus,
      contradictions,
      origin,
      openDocument,
      closeDocument,
      handleClearGraphFocus,
      showPlaceStable,
    ],
  );

  // Ctrl K (⌘ K): the palette, from anywhere in the vault; again, it closes.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteScope, setPaletteScope] = useState<PaletteScope>("all");
  const [paletteQuery, setPaletteQuery] = useState("");
  const openPalette = (scope: PaletteScope) => {
    if (scope !== paletteScope) setPaletteQuery("");
    setPaletteScope(scope);
    setPaletteOpen(true);
  };
  const openSearch = useRef<() => void>(() => undefined);
  openSearch.current = () => (paletteOpen ? setPaletteOpen(false) : openPalette("all"));
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
  // What the palette searches: all already here, so every keystroke answers at
  // once. Chats are read from the browser's store each time it opens.
  const [chatMount, setChatMount] = useState(0);
  const [chatAsk, setChatAsk] = useState<{ text: string; nonce: number } | null>(null);
  // Asked once: coming back to the chat later must not ask it again.
  const clearChatAsk = useCallback(() => setChatAsk(null), []);
  const [sourcesMount, setSourcesMount] = useState(0);
  const [searchMount, setSearchMount] = useState(0);
  const notesPerSource = useMemo(
    () => notesPerSourceDocument(notes, sourceDocs.bySource),
    [notes, sourceDocs],
  );
  const recentChats = useRecentChats(driveId);
  // The conversation on screen, for the sidebar to mark.
  const activeChatId =
    viewMode === "chat" && !showDocumentEditor && driveId ? readCurrentThreadId(driveId) : null;
  // The server's closest notes for what is typed, a moment after the palette's own word matches.
  const paletteSemantic = usePaletteSemantic(paletteQuery, paletteOpen && paletteScope === "all");
  const paletteData = useMemo<PaletteData>(
    () => ({
      notes,
      topicOf,
      sourceOf: sourceDocs.bySource,
      topics: rankedTopics(mocs),
      hub: hubMap(mocs),
      sources: sourceDocs.documents,
      notesPerSource,
      chats: recentChats,
      ago: formatLastModified,
    }),
    [notes, topicOf, sourceDocs, mocs, notesPerSource, recentChats],
  );

  /** The chat on a conversation (`null`: a new one), shown fresh. */
  const showChat = (threadId: string | null) => {
    if (driveId) {
      // Another conversation's answer stops, as the chat's own New chat and
      // history do: the vault streams one answer at a time.
      if (chatRun(driveId)?.thread.id !== threadId) stopChatRun(driveId);
      writeCurrentThreadId(driveId, threadId);
    }
    setChatMount((n) => n + 1);
    handleSwitchView("chat");
  };

  function handlePaletteSelect(row: PaletteRow) {
    setPaletteOpen(false);
    switch (row.kind) {
      case "ask":
        setChatAsk({ text: row.query, nonce: Date.now() });
        showChat(null);
        return;
      case "note":
      case "topic":
        openDocument(row.id);
        return;
      case "source":
        if (row.document.kind === "folder") {
          // The Sources list opens on the folder it remembers.
          writeOpenFolder(row.document.id);
          setSourcesMount((n) => n + 1);
          handleSwitchView("sources");
        } else {
          openDocument(row.document.id);
        }
        return;
      case "chat":
        setChatAsk(null);
        showChat(row.id);
        return;
      case "more":
        saveSearchQuery(row.query);
        setSearchMount((n) => n + 1);
        handleSwitchView("search");
        return;
      case "goto":
        switch (row.goto) {
          case "add-sources":
            intake.open();
            handleSwitchView("sources");
            return;
          case "new-chat":
            setChatAsk(null);
            showChat(null);
            return;
          case "new-project":
            handleSwitchView("projects");
            return;
          case "new-scope":
            handleSwitchView("scope");
            return;
          case "vault-settings":
            handleSwitchView("config");
            return;
          case "processing-queue":
            handleSwitchView("pipeline");
            return;
        }
    }
  }

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

  const sourcesTabs = <SourcesTabs active={viewMode === "timeline" ? "timeline" : "sources"} onSelect={handleSwitchView} />;
  /** Open a source folder in the Folders view, the way the palette does. */
  const openSourcesFolder = (folderId: string) => {
    writeOpenFolder(folderId);
    setSourcesMount((n) => n + 1);
    handleSwitchView("sources");
  };

  const workTabs = (
    <WorkTabs
      active={viewMode === "scope" ? "scope" : "projects"}
      projects={projectCount}
      scopes={sowCount}
      onSelect={handleSwitchView}
    />
  );
  const renderedViews: Record<RenderedView, ReactNode> = {
    notes: (
      <NoteList
        key={notesScope ? `scope:${notesScope.label}` : "all"}
        notes={notes}
        isLoading={notesLoading}
        scope={notesScope}
        onClearScope={() => setNotesScope(null)}
      />
    ),
    topics: (
      <TopicsView
        mocs={mocs}
        isLoading={notesLoading}
        onOpen={openDocument}
        onNewTopic={() => setCreating(CREATE_ITEMS.find((i) => i.key === "topic") ?? null)}
      />
    ),
    contradictions: (
      <ContradictionsView
        contradictions={contradictions}
        isLoading={notesLoading}
        onOpen={openContradiction}
        onOpenNote={openClaim}
      />
    ),
    graph: (
      <GraphView
        notes={notes}
        mocs={mocs}
        tensions={tensions}
        onGraphFocusChange={handleGraphFocusChange}
        clearFocusNonce={graphClearNonce}
        layoutKey={driveId ?? undefined}
        filter={graphFilter}
        onFilterChange={setGraphFilter}
        overTime={graphTime}
        onOverTimeChange={setGraphTime}
        driveId={driveId ?? undefined}
        timelineGraph={timelineGraph}
      />
    ),
    chat: (
      <ChatView
        key={chatMount}
        initialDraft={chatReturnDraft}
        ask={chatAsk ?? undefined}
        onAsked={clearChatAsk}
        notes={notes}
      />
    ),
    search: <SearchView key={searchMount} isLoading={notesLoading} />,
    activity: <ActivityView />,
    sources: (
      <>
        {sourcesTabs}
        <SourceList
          key={sourcesMount}
          intake={intake}
          convert={convert}
          homeSignal={sourcesHome}
        />
      </>
    ),
    timeline: (
      <>
        {sourcesTabs}
        <SourceTimelineView
          driveId={driveId ?? undefined}
          graph={timelineGraph}
          onAddSources={() => {
            // The intake lives in the Folders view.
            intake.open();
            handleSwitchView("sources");
          }}
          onPasteText={() => setCreating(CREATE_ITEMS.find((i) => i.key === "paste") ?? null)}
          onSeeNotes={(title, ids) => {
            handleSwitchView("notes");
            setNotesScope({ label: title, ids: new Set(ids) });
          }}
          onShowInGraph={(additionId) => {
            handleSwitchView("graph");
            setGraphTime({ on: true, pick: additionId });
          }}
          onOpenSources={openSourcesFolder}
          onOpenDocument={openDocument}
        />
      </>
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
      overlay={
        paletteOpen && (
          <SearchPalette
            vaultName={vaultName}
            data={paletteData}
            scope={paletteScope}
            query={paletteQuery}
            semantic={paletteSemantic}
            onQueryChange={setPaletteQuery}
            onSelect={handlePaletteSelect}
            onClose={() => setPaletteOpen(false)}
          />
        )
      }
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
          onSearch={() => openPalette("all")}
          searchActive={paletteOpen}
          recentChats={recentChats}
          activeChatId={activeChatId}
          onOpenChat={(id) => {
            setChatAsk(null);
            showChat(id);
          }}
          onAllChats={() => openPalette("chats")}
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
      {guideOpen && (
        <GettingStartedModal
          places={GUIDE_PLACES}
          menu={VAULT_MENU}
          createItems={CREATE_ITEMS}
          onClose={() => setGuideOpen(false)}
        />
      )}
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
  { key: "pipeline", label: "Processing queue", icon: "queue", tour: "settings-queue" },
  { key: "activity", label: "Activity", hint: "recent changes", icon: "clock" },
  { key: "health", label: "Health check", icon: "pulse", tour: "settings-health" },
  { key: "files", label: "Files and folders", icon: "folder" },
];

/**
 * Beside "Add sources": the other things a person adds by hand. Files go
 * through Add sources itself (the intake); these open the create dialog.
 */
export const CREATE_ITEMS = [
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
    <div className="vault-work-tabs px-4 pt-3">
      <nav className="vault-seg" aria-label="Work">
        {tabs.map((tab) => {
          const current = tab.key === active;
          return (
            <button
              key={tab.key}
              type="button"
              aria-current={current ? "page" : undefined}
              onClick={() => onSelect(tab.key)}
            >
              {tab.label}
              {tab.count > 0 && <span className="c">{tab.count}</span>}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

/**
 * Sources holds two views over the same documents (WorkTabs is the pattern):
 * the folders as they are, and the timeline of when each thing arrived.
 */
function SourcesTabs({
  active,
  onSelect,
}: {
  active: "sources" | "timeline";
  onSelect: (mode: ViewMode) => void;
}) {
  const tabs: { key: "sources" | "timeline"; label: string }[] = [
    { key: "sources", label: "Folders" },
    { key: "timeline", label: "Timeline" },
  ];
  return (
    <div className="vault-sources-tabs px-4 pt-3">
      <nav className="vault-seg" aria-label="Sources">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            aria-current={tab.key === active ? "page" : undefined}
            data-tour={`sources-${tab.key}`}
            onClick={() => onSelect(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

/** A drive node unchanged for the vault's lookups: same name, type and folder. */
function sameTreeNode(
  a: { id: string; name?: string | null; documentType?: string | null; parentFolder?: string | null; kind?: string },
  b: { id: string; name?: string | null; documentType?: string | null; parentFolder?: string | null; kind?: string },
): boolean {
  return sameDriveNode(a, b) && (a.parentFolder ?? null) === (b.parentFolder ?? null) && a.kind === b.kind;
}
