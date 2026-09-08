import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import type {
  ScopeOfWorkAction,
  ScopeOfWorkDocument,
} from "document-models/scope-of-work";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  EditorContext,
  makeDispatch,
  type ConfirmOptions,
  type EditorContextValue,
} from "../lib/context.js";
import { SOW_CSS } from "../lib/styles.js";
import type { View } from "../lib/model.js";
import { DeliverableInspector } from "../inspector/DeliverableInspector.js";
import { DeliverablesView } from "../views/DeliverablesView.js";
import { MilestoneView } from "../views/MilestoneView.js";
import { OverviewView } from "../views/OverviewView.js";
import { ProjectView } from "../views/ProjectView.js";
import { RoadmapView } from "../views/RoadmapView.js";
import { TeamView } from "../views/TeamView.js";
import { WbsView } from "../views/WbsView.js";
import { readSowIntent } from "../../shared/sow-intent.js";
import { locate } from "../lib/model.js";
import {
  readInspectorLayout,
  writeInspectorLayout,
  readRailOpen,
  writeRailOpen,
  type InspectorLayout,
} from "../lib/prefs.js";
import { OutlineRail } from "./OutlineRail.js";
import { ConfirmDialog, Toast } from "./ui.js";

const FONTS_ID = "sow-editor-fonts";
const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=JetBrains+Mono:wght@400;500&display=swap";

export function Shell({
  document,
  dispatch: rawDispatch,
}: {
  document: ScopeOfWorkDocument;
  dispatch: DocumentDispatch<ScopeOfWorkAction>;
}) {
  const state = document.state.global;
  // The vault can ask for a specific project/section — or, from a chat
  // citation, for any item by id — when it opens this document (see
  // shared/sow-intent.ts). Read in an initialiser so the first paint is
  // already the requested view — a useEffect would flash the overview first.
  // The read is one-shot and id-checked, so it happens in exactly one
  // initialiser and both the view and the selection derive from it.
  const [initial] = useState<{ view: View; selected: string | null }>(() => {
    const overview = { view: { kind: "overview" } as View, selected: null };
    const intent = readSowIntent(document.header.id);
    if (!intent) return overview;
    if (intent.kind === "locate") return locate(state, intent.id) ?? overview;
    if (intent.kind === "goal") return overview; // goals live in the WBS editor
    return { view: intent, selected: null };
  });
  const [view, setView] = useState<View>(initial.view);
  const [selected, setSelected] = useState<string | null>(initial.selected);
  const [inspectorLayout, setInspectorLayout] =
    useState<InspectorLayout>(readInspectorLayout);
  const [railOpen, setRailOpen] = useState(readRailOpen);
  const [error, setError] = useState<string | null>(null);
  const [seenOps, setSeenOps] = useState(
    () => globalOperations(document).length,
  );

  const selectionClick = useRef(false);
  // a click that changes the selection or the mode must not be mistaken for a click outside
  const consumeClick = useCallback(() => {
    selectionClick.current = true;
    setTimeout(() => {
      selectionClick.current = false;
    }, 0);
  }, []);
  const close = useCallback(() => {
    setSelected(null);
  }, []);
  const select = useCallback(
    (id: string | null) => {
      consumeClick();
      if (id === null) close();
      else setSelected(id);
    },
    [consumeClick, close],
  );

  // fill the viewport from wherever the host places us down to the bottom edge — no fixed chrome guess
  const rootRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const fit = () => {
      const top = Math.max(0, Math.round(el.getBoundingClientRect().top));
      el.style.height = `calc(100vh - ${top}px)`;
    };
    fit();
    globalThis.addEventListener("resize", fit);
    const observer = new ResizeObserver(fit);
    observer.observe(globalThis.document.body);
    return () => {
      globalThis.removeEventListener("resize", fit);
      observer.disconnect();
    };
  }, []);

  // display faces: injected once, shared by every open editor instance
  useEffect(() => {
    if (globalThis.document.getElementById(FONTS_ID)) return;
    const link = globalThis.document.createElement("link");
    link.id = FONTS_ID;
    link.rel = "stylesheet";
    link.href = FONTS_HREF;
    globalThis.document.head.appendChild(link);
  }, []);

  // reducer rejections are recorded on the operation, not thrown: surface the newest one.
  // Connect may hand the editor a document without an operations log, so read it defensively.
  const ops = globalOperations(document);
  useEffect(() => {
    if (ops.length <= seenOps) {
      if (ops.length !== seenOps) setSeenOps(ops.length);
      return;
    }
    const failed = ops
      .slice(seenOps)
      .find((op) => op.error !== undefined && op.error !== "");
    if (failed?.error) setError(failed.error);
    setSeenOps(ops.length);
  }, [ops, seenOps]);

  // the inspected deliverable may have been removed
  useEffect(() => {
    if (selected && !state.deliverables.some((d) => d.id === selected))
      setSelected(null);
  }, [selected, state.deliverables]);

  // the inspector behaves like a drawer: a click anywhere outside it closes it.
  // We listen on `click`, not `pointerdown`, so the layout does not shift between press
  // and release; selecting controls (rows, cards, "+ Add") mark their click as consumed
  // so they switch the inspected deliverable instead of closing.
  const inspectorRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!selected) return;
    const onClick = (e: MouseEvent) => {
      if (selectionClick.current) return;
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (!globalThis.document.contains(target)) return; // re-rendered away mid-click: not an outside click
      if (inspectorRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest(".sow-modal")) return;
      if (target instanceof Element && target.closest(".sow-confirm")) return;
      if (target instanceof Element && target.closest(".sow .toast")) return;
      close();
    };
    globalThis.document.addEventListener("click", onClick);
    return () => globalThis.document.removeEventListener("click", onClick);
  }, [selected, close]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, [close]);

  const dispatch = useMemo(
    () => makeDispatch(rawDispatch, setError),
    [rawDispatch],
  );
  const go = useCallback((v: View) => setView(v), []);
  const today = useMemo(() => new Date(), []);
  const toggleInspectorLayout = useCallback(() => {
    consumeClick();
    setInspectorLayout((v) => (v === "modal" ? "sidebar" : "modal"));
  }, [consumeClick]);
  useEffect(() => {
    writeInspectorLayout(inspectorLayout);
  }, [inspectorLayout]);
  const toggleRail = useCallback(() => {
    consumeClick();
    setRailOpen((v) => !v);
  }, [consumeClick]);
  useEffect(() => {
    writeRailOpen(railOpen);
  }, [railOpen]);
  const pendingConfirm = useRef<{
    resolve: (ok: boolean) => void;
  } | null>(null);
  const [confirmOpts, setConfirmOpts] = useState<ConfirmOptions | null>(null);
  const settleConfirm = useCallback((ok: boolean) => {
    pendingConfirm.current?.resolve(ok);
    pendingConfirm.current = null;
    setConfirmOpts(null);
  }, []);
  const confirm = useCallback((opts: ConfirmOptions) => {
    pendingConfirm.current?.resolve(false);
    return new Promise<boolean>((resolve) => {
      pendingConfirm.current = { resolve };
      setConfirmOpts(opts);
    });
  }, []);
  const ctx: EditorContextValue = useMemo(
    () => ({
      documentId: document.header.id,
      state,
      dispatch,
      view,
      go,
      selected,
      select,
      today,
      inspectorLayout,
      toggleInspectorLayout,
      confirm,
    }),
    [
      document.header.id,
      state,
      dispatch,
      view,
      go,
      selected,
      select,
      today,
      inspectorLayout,
      toggleInspectorLayout,
      confirm,
    ],
  );

  const showSidebar = selected !== null && inspectorLayout === "sidebar";
  const showModal = selected !== null && inspectorLayout === "modal";

  const canvas = (() => {
    switch (view.kind) {
      case "roadmap":
        return <RoadmapView id={view.id} />;
      case "milestone":
        return <MilestoneView id={view.id} />;
      case "project":
        return <ProjectView id={view.id} />;
      case "deliverables":
        return (
          <DeliverablesView
            key={JSON.stringify(view.filters ?? {})}
            initial={view.filters}
          />
        );
      case "wbs":
        return <WbsView projectId={view.projectId} />;
      case "team":
        return <TeamView />;
      default:
        return <OverviewView />;
    }
  })();

  return (
    <EditorContext.Provider value={ctx}>
      <style>{SOW_CSS}</style>
      <div
        ref={rootRef}
        className={`sow ${showSidebar ? "" : "no-inspector"}${railOpen ? "" : " no-rail"}`}
      >
        <OutlineRail railOpen={railOpen} onToggle={toggleRail} />
        <main
          className="canvas"
          key={`${view.kind}:${"id" in view ? view.id : ""}`}
        >
          {canvas}
        </main>
        <aside ref={inspectorRef} className="inspector" aria-label="Inspector">
          {showSidebar && selected && <DeliverableInspector id={selected} />}
        </aside>
        {showModal && selected && (
          <div
            className="sow-scrim"
            role="presentation"
            onClick={() => select(null)}
          >
            <div
              className="sow-modal"
              role="dialog"
              aria-modal="true"
              aria-label="Deliverable"
              onClick={(e) => e.stopPropagation()}
            >
              <DeliverableInspector id={selected} />
            </div>
          </div>
        )}
        {confirmOpts && (
          <ConfirmDialog
            title={confirmOpts.title}
            body={confirmOpts.body}
            confirmLabel={confirmOpts.confirmLabel}
            onCancel={() => settleConfirm(false)}
            onConfirm={() => settleConfirm(true)}
          />
        )}
        {error && (
          <Toast message={error} error onClose={() => setError(null)} />
        )}
      </div>
    </EditorContext.Provider>
  );
}

type LoggedOperation = { error?: string };
/** The document's global operation log, or [] when the host did not include one. */
function globalOperations(doc: ScopeOfWorkDocument): LoggedOperation[] {
  const raw: unknown = (doc as { operations?: { global?: unknown } }).operations
    ?.global;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((op: unknown): LoggedOperation[] => {
    if (typeof op !== "object" || op === null) return [];
    const e: unknown = (op as { error?: unknown }).error;
    return [{ error: typeof e === "string" ? e : undefined }];
  });
}
