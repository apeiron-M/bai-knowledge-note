import { useSetPHAppConfig } from "@powerhousedao/reactor-browser";
import type { EditorProps } from "document-model";
import { DebugErrorBoundary } from "./components/DebugErrorBoundary.js";
import { DriveExplorer } from "./components/DriveExplorer.js";
import { editorConfig } from "./config.js";
import { useDriveInit } from "./hooks/use-drive-init.js";
import { useRemoteFirst } from "./hooks/use-remote-first.js";
import { ThemeProvider } from "../shared/theme-context.js";

export default function Editor(props: EditorProps) {
  useSetPHAppConfig(editorConfig);
  // Route document reads/writes to the Switchboard and scope the sync
  // channel to the drive document — the vault corpus (1,500+ docs) is
  // server-authoritative and must not replicate into IndexedDB.
  useRemoteFirst();
  useDriveInit();
  return (
    <ThemeProvider>
      <div
        className="h-screen overflow-hidden"
        style={{ backgroundColor: "var(--bai-bg)", color: "var(--bai-text)" }}
      >
        <DebugErrorBoundary>
          <DriveExplorer {...props} />
        </DebugErrorBoundary>
      </div>
    </ThemeProvider>
  );
}
