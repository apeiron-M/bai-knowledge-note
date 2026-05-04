import { useSetPHAppConfig } from "@powerhousedao/reactor-browser";
import type { EditorProps } from "document-model";
import { DebugErrorBoundary } from "./components/DebugErrorBoundary.js";
import { DriveExplorer } from "./components/DriveExplorer.js";
import { appConfig } from "./config.js";
import { useDriveInit } from "./hooks/use-drive-init.js";
import { ThemeProvider } from "../shared/theme-context.js";

export default function Editor(props: EditorProps) {
  useSetPHAppConfig(appConfig);
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
