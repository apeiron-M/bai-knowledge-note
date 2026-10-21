/**
 * The Knowledge Vault, running entirely in the visitor's browser. Mount it on a
 * page of its own: it owns the page's `window.ph` slots and its `fetch` for the
 * vault's origin.
 */
import { RevisionHistory } from "@powerhousedao/design-system/connect";
import {
  setRevisionHistoryVisible,
  useAppModuleById,
  useDocumentById,
  useDocumentOperations,
  useEditorModuleById,
  useEditorModulesForDocumentType,
  useRevisionHistoryVisible,
  useSelectedDocument,
  useSelectedDocumentId,
  useSelectedDriveSafe,
} from "@powerhousedao/reactor-browser";
import type { PHDocument } from "document-model";
import { Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { bootBrowserVault, deleteBrowserVault, type BootedVault } from "./boot.js";
import type { VaultSeed } from "./seed.js";

export type BrowserVaultProps = {
  /** Loads the starting vault. Called on a first visit, and on return visits to tell whether it changed. */
  loadSeed?: () => Promise<VaultSeed>;
  /** One vault per namespace and browser profile. */
  namespace?: string;
  /** Where the banner's "Download the desktop app" points. */
  downloadUrl?: string;
  /** The page path the vault lives under; its own URLs go below it. */
  basePath?: string;
};

const DEFAULT_NAMESPACE = "knowledge-vault-web";

/** The guide vault that ships with the package. */
export const loadGuideVaultSeed = async (): Promise<VaultSeed> =>
  (await import("./seed/guide-vault.json")).default as unknown as VaultSeed;

type Phase =
  | { kind: "starting"; stage: string; done?: number; total?: number }
  | { kind: "elsewhere" }
  | { kind: "moved" }
  | { kind: "ready"; vault: BootedVault }
  | { kind: "failed"; message: string };

const STAGE_LABEL: Record<string, string> = {
  engine: "Starting the vault in this browser…",
  seed: "Adding the guide to your vault…",
  index: "Opening your vault…",
  ready: "Opening your vault…",
};

const frame: CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: "system-ui, sans-serif",
  color: "#1f2937",
  padding: 24,
  textAlign: "center",
};

/** How long a tab waits for the vault before saying it is open elsewhere. A reloaded page's
 * previous self, or a mount React has just undone, lets go within this. */
const LOCK_WAIT_MS = 3000;

type VaultLock = { kind: "held"; release: () => void } | { kind: "busy" } | { kind: "cancelled" };

/**
 * Holds the vault's Web Lock until `release`. Waits up to {@link LOCK_WAIT_MS} for it (`busy`
 * after that), or takes it from another tab with `steal`. `signal` withdraws a request still
 * waiting (`cancelled`); `onLost` runs if another tab steals a lock this one holds.
 *
 * Not `ifAvailable`: it refuses at once, so a page reloaded before its previous self had let go
 * — or React's second development mount, racing its first — was told the vault was open in
 * another tab, and the first mount booted anyway and kept the lock for good.
 */
function holdVaultLock(
  locks: LockManager,
  name: string,
  options: { steal: boolean; signal: AbortSignal; onLost: () => void },
): Promise<VaultLock> {
  return new Promise<VaultLock>((resolve) => {
    let granted = false;
    let timedOut = false;
    const waiting = new AbortController();
    const timer = options.steal
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          waiting.abort();
        }, LOCK_WAIT_MS);
    const withdraw = () => waiting.abort();
    options.signal.addEventListener("abort", withdraw, { once: true });
    const settle = () => {
      clearTimeout(timer);
      options.signal.removeEventListener("abort", withdraw);
    };
    // `steal` cannot be combined with a signal; a steal is granted at once anyway.
    const request = options.steal
      ? locks.request(name, { steal: true }, held)
      : locks.request(name, { signal: waiting.signal }, held);
    function held(): Promise<void> {
      granted = true;
      settle();
      return new Promise<void>((release) => resolve({ kind: "held", release: () => release() }));
    }
    request.catch(() => {
      settle();
      if (granted) options.onLost();
      else resolve(timedOut ? { kind: "busy" } : { kind: "cancelled" });
    });
  });
}

function Screen({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div style={frame} role="status">
      <div style={{ maxWidth: 440 }}>
        <p style={{ fontSize: 18, fontWeight: 600, margin: "0 0 8px" }}>{title}</p>
        {children}
      </div>
    </div>
  );
}

/**
 * The scope history opens on: global, as in Connect, when it has operations. The guide's documents
 * were written with their content in place, so until the visitor edits one, all its operations
 * are in the document scope, and opening on an empty global list would show nothing.
 */
function defaultScope(scopes: readonly string[], revision: Readonly<Record<string, number>>): string {
  if ((revision.global ?? 0) > 0) return "global";
  return scopes.find((scope) => (revision[scope] ?? 0) > 0) ?? (scopes.includes("global") ? "global" : (scopes[0] ?? "global"));
}

/**
 * A document's operations, shown when its toolbar's History button is pressed — what Connect's
 * document container does. Without a container to watch for it, the button opened nothing.
 */
function DocumentHistory({ document }: { document: PHDocument }) {
  const scopes = useMemo(() => {
    const keys = Object.keys(document.header.revision);
    return keys.length > 0 ? keys : ["global"];
  }, [document.header.revision]);
  const [scope, setScope] = useState(() => defaultScope(scopes, document.header.revision));
  const selectedScope = scopes.includes(scope) ? scope : defaultScope(scopes, document.header.revision);
  const { operations, isLoading, hasNextPage, fetchNextPage, error } = useDocumentOperations(
    document.header.id,
    selectedScope,
    { limit: 500 },
  );
  return (
    <div className="relative h-full">
      <RevisionHistory
        documentTitle={document.header.name}
        documentId={document.header.id}
        operations={operations}
        isLoading={isLoading}
        hasNextPage={hasNextPage}
        onLoadNextPage={fetchNextPage}
        error={error}
        scopes={scopes}
        scope={selectedScope}
        onScopeChange={setScope}
        onClose={() => setRevisionHistoryVisible(false)}
        documentState={document.state}
      />
    </div>
  );
}

/** The selected document's editor, as Connect's document container renders it. */
function DocumentEditor() {
  const [selected] = useSelectedDocument();
  const [live] = useDocumentById(selected.header.id);
  const document = live ?? selected;
  const historyOpen = useRevisionHistoryVisible();
  // History is a view of one document: leaving it (another document, or none) closes it.
  const documentId = document.header.id;
  useEffect(() => () => setRevisionHistoryVisible(false), [documentId]);
  const preferred = useEditorModuleById(
    (document.header.meta as { preferredEditor?: string } | undefined)?.preferredEditor,
  );
  const byType = useEditorModulesForDocumentType(document.header.documentType);
  const editor = preferred ?? byType?.[0];
  if (historyOpen) return <DocumentHistory key={documentId} document={document} />;
  if (!editor) return <p role="alert">No editor is installed for {document.header.documentType}.</p>;
  const Editor = editor.Component;
  return (
    <Suspense fallback={<Screen title="Opening…" />}>
      <Editor key={document.header.id} document={document} />
    </Suspense>
  );
}

/** The drive app (the vault), with the open document's editor inside it. */
function VaultApp() {
  const [drive] = useSelectedDriveSafe();
  const selectedId = useSelectedDocumentId();
  const app = useAppModuleById(
    (drive?.header.meta as { preferredEditor?: string } | undefined)?.preferredEditor,
  );
  if (!drive) return <Screen title="Opening your vault…" />;
  if (!app) return <Screen title="The vault app is missing from this build." />;
  const App = app.Component;
  return (
    <Suspense fallback={<Screen title="Opening your vault…" />}>
      <App>{selectedId ? <DocumentEditor /> : null}</App>
    </Suspense>
  );
}

type GuideState = "writing" | "written" | "failed";

/** Whether the guide is still being written behind the open app (first visit only). */
function useGuideState(seeding: Promise<void> | null): GuideState {
  const [state, setState] = useState<GuideState>(seeding ? "writing" : "written");
  useEffect(() => {
    if (!seeding) return undefined;
    let live = true;
    seeding.then(
      () => live && setState("written"),
      // A stop (a reset) is not a failure: the banner keeps its message until the page reloads.
      (error: unknown) => live && !(error instanceof DOMException && error.name === "AbortError") && setState("failed"),
    );
    return () => {
      live = false;
    };
  }, [seeding]);
  return state;
}

const GUIDE_MESSAGE: Record<GuideState, string | null> = {
  writing: "Adding the guide to your vault…",
  failed: "The guide could not be added. Reload the page to try again.",
  written: null,
};

function Banner({ vault, namespace, downloadUrl }: { vault: BootedVault; namespace: string; downloadUrl?: string }) {
  const [busy, setBusy] = useState(false);
  const guide = useGuideState(vault.seeding);
  const reset = async () => {
    if (!window.confirm("Reset the vault? Everything you added or changed in this browser is removed, and the guide vault comes back.")) return;
    setBusy(true);
    await deleteBrowserVault(namespace, vault);
    window.location.reload();
  };
  const bar: CSSProperties = {
    position: "fixed",
    right: 12,
    bottom: 12,
    zIndex: 50,
    display: "flex",
    gap: 12,
    alignItems: "center",
    padding: "6px 12px",
    borderRadius: 999,
    background: "rgba(17, 24, 39, 0.88)",
    color: "white",
    font: "12px system-ui, sans-serif",
  };
  const link: CSSProperties = { color: "#c4b5fd", background: "none", border: 0, padding: 0, font: "inherit", cursor: "pointer" };
  return (
    <div style={bar} role="status" data-guide={guide}>
      <span>
        {GUIDE_MESSAGE[guide] ??
          (vault.outdated ? "A newer guide is available." : "This vault lives only in this browser.")}
      </span>
      <button type="button" style={link} onClick={() => void reset()} disabled={busy}>
        {busy ? "Resetting…" : "Reset"}
      </button>
      {downloadUrl ? (
        <a style={link} href={downloadUrl}>
          Download the desktop app
        </a>
      ) : null}
    </div>
  );
}

export function BrowserVault({
  loadSeed = loadGuideVaultSeed,
  namespace = DEFAULT_NAMESPACE,
  downloadUrl,
  basePath = "/",
}: BrowserVaultProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "starting", stage: "engine" });
  const [attempt, setAttempt] = useState(0);
  const booted = useRef<BootedVault | null>(null);

  useEffect(() => {
    let cancelled = false;
    let releaseLock: (() => void) | undefined;
    const lockRequest = new AbortController();
    const start = async (steal: boolean) => {
      // One tab at a time: two engines on one IndexedDB store overwrite each other.
      // Web Locks are missing in some older browsers: then the vault opens without the guard.
      if ("locks" in navigator) {
        const lock = await holdVaultLock(navigator.locks, `${namespace}:open`, {
          steal,
          signal: lockRequest.signal,
          onLost: () => {
            if (!cancelled) setPhase({ kind: "moved" });
          },
        });
        if (lock.kind === "cancelled") return;
        if (lock.kind === "busy") {
          if (!cancelled) setPhase({ kind: "elsewhere" });
          return;
        }
        releaseLock = lock.release;
        // Granted just as this mount went away (React mounts twice in development).
        if (cancelled) {
          lock.release();
          return;
        }
      }
      const vault = await bootBrowserVault({
        namespace,
        basePath,
        loadSeed,
        onProgress: (stage, done, total) => {
          if (!cancelled) setPhase({ kind: "starting", stage, done, total });
        },
      });
      if (cancelled) {
        // Gone while it started: stop it, then let the next mount have the store.
        await vault.stop();
        releaseLock?.();
        return;
      }
      booted.current = vault;
      setPhase({ kind: "ready", vault });
    };
    start(attempt > 0).catch((error: unknown) => {
      releaseLock?.();
      if (!cancelled) setPhase({ kind: "failed", message: error instanceof Error ? error.message : String(error) });
    });
    return () => {
      cancelled = true;
      lockRequest.abort();
      const vault = booted.current;
      booted.current = null;
      // The lock goes once the engine has stopped, so the next mount never opens the store
      // under a running one. A boot still under way stops itself when it returns (above).
      if (vault) void vault.stop().finally(() => releaseLock?.());
    };
  }, [namespace, loadSeed, basePath, attempt]);

  switch (phase.kind) {
    case "starting":
      return (
        <Screen title={STAGE_LABEL[phase.stage] ?? "Starting…"}>
          <p style={{ margin: 0, color: "#6b7280", fontSize: 14 }}>
            {phase.total ? `${phase.done ?? 0} of ${phase.total}` : "Nothing you add here leaves your browser."}
          </p>
        </Screen>
      );
    case "elsewhere":
      return (
        <Screen title="Your vault is open in another tab.">
          <button type="button" onClick={() => setAttempt((n) => n + 1)}>
            Use it here instead
          </button>
        </Screen>
      );
    case "moved":
      return <Screen title="Your vault moved to another tab." />;
    case "failed":
      return (
        <Screen title="The vault could not start in this browser.">
          <p style={{ color: "#6b7280", fontSize: 14 }}>{phase.message}</p>
        </Screen>
      );
    case "ready":
      return (
        <>
          <VaultApp />
          <Banner vault={phase.vault} namespace={namespace} downloadUrl={downloadUrl} />
        </>
      );
  }
}
