import { useEffect } from "react";
import { useSetPHAppConfig } from "@powerhousedao/reactor-browser";
import type { EditorProps } from "document-model";
import { DebugErrorBoundary } from "./components/DebugErrorBoundary.js";
import { AuthGate } from "./components/AuthGate.js";
import { DriveExplorer } from "./components/DriveExplorer.js";
import { Notifications } from "./components/Notifications.js";
import { editorConfig } from "./config.js";
import { useDriveInit } from "./hooks/use-drive-init.js";
import { useRemoteFirst } from "./hooks/use-remote-first.js";
import { installMetricsConsole } from "../shared/request-metrics.js";
import { ThemeProvider } from "../shared/theme-context.js";

export default function Editor(props: EditorProps) {
  useSetPHAppConfig(editorConfig);
  // Expose `vaultMetrics` on `window` so a request burst can be captured
  // and attributed from the console. Records nothing until started.
  useEffect(() => installMetricsConsole(), []);
  // Route document reads/writes to the Switchboard and scope the sync
  // channel to the drive document — the vault corpus (1,500+ docs) is
  // server-authoritative and must not replicate into IndexedDB.
  useRemoteFirst();
  useDriveInit();
  return (
    <ThemeProvider fill>
      {/*
        The viewport's height, capped at the box the host gives the vault: the
        desktop app draws its own bar above (36 px), which 100vh alone ran past,
        hiding the foot of the sidebar. Where the parent's height is open
        (Connect), the cap does not apply and the vault fills the viewport.
      */}
      <div
        className="h-screen overflow-hidden"
        style={{ maxHeight: "100%", backgroundColor: "var(--bai-bg)", color: "var(--bai-text)" }}
      >
        <DebugErrorBoundary>
          <AuthGate>
            <DriveExplorer {...props} />
          </AuthGate>
        </DebugErrorBoundary>
        <Notifications />
      </div>
    </ThemeProvider>
  );
}
