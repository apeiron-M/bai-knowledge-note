import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Boundary around the knowledge-vault drive-app.
 *
 * Two behaviors:
 *
 *  1. **Sync-race retry.** Connect's in-browser `KyselyDocumentView.resolveIdOrSlug`
 *     rejects with `Document not found: <uuid>` when a doc id is in the drive
 *     tree but the per-document payload hasn't yet replicated into IndexedDB.
 *     Hooks in reactor-browser that fetch docs via Suspense surface this as a
 *     render crash. We catch it here and re-mount after a short delay until
 *     sync catches up (cap at ~15s, then fall through to error display).
 *
 *  2. **Real-error display.** For anything else, render an inline panel with
 *     the actual `error.message` + `error.stack` and `console.error` the
 *     full Error object so it's visible in DevTools (Connect's outer
 *     boundary template-stringifies the error and loses the message).
 */

const SYNC_RACE_PREFIX = "Document not found:";
const RETRY_DELAY_MS = 500;
const MAX_RETRIES = 30; // ~15s

type State = { err: Error | null; retries: number };

export class DebugErrorBoundary extends Component<
  { children: ReactNode },
  State
> {
  state: State = { err: null, retries: 0 };
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError(err: Error) {
    return { err };
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    const isSyncRace = err.message?.startsWith(SYNC_RACE_PREFIX);

    if (isSyncRace && this.state.retries < MAX_RETRIES) {
      // Schedule a re-mount after the in-browser sync has more time.
      this.retryTimer = setTimeout(() => {
        this.setState((s) => ({ err: null, retries: s.retries + 1 }));
      }, RETRY_DELAY_MS);
      return;
    }

    // Anything else (or sync-race that exhausted retries): log loudly so
    // DevTools shows the real message + stack instead of Connect's `{}`.
    console.error("[knowledge-vault] caught error:", err.message);
    console.error("[knowledge-vault] error.stack:", err.stack);
    console.error("[knowledge-vault] componentStack:", info.componentStack);
    console.error("[knowledge-vault] full Error object:", err);
  }

  componentWillUnmount() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
  }

  render() {
    if (!this.state.err) return this.props.children;

    const isSyncRace = this.state.err.message?.startsWith(SYNC_RACE_PREFIX);
    if (isSyncRace && this.state.retries < MAX_RETRIES) {
      return (
        <div
          className="flex h-full items-center justify-center"
          style={{ color: "var(--bai-text-muted)" }}
        >
          <div style={{ textAlign: "center" }}>
            <div style={{ marginBottom: 8 }}>Loading vault…</div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              syncing documents from reactor (attempt {this.state.retries + 1})
            </div>
          </div>
        </div>
      );
    }

    return (
      <div
        style={{
          padding: 24,
          fontFamily: "monospace",
          color: "var(--bai-text)",
          backgroundColor: "var(--bai-bg)",
          whiteSpace: "pre-wrap",
          overflow: "auto",
          maxHeight: "100vh",
        }}
      >
        <div style={{ fontSize: 18, marginBottom: 12, color: "#ff6b6b" }}>
          knowledge-vault crashed
        </div>
        <div style={{ marginBottom: 8 }}>
          <strong>{this.state.err.name}:</strong> {this.state.err.message}
        </div>
        <div style={{ fontSize: 12, opacity: 0.8 }}>{this.state.err.stack}</div>
      </div>
    );
  }
}
