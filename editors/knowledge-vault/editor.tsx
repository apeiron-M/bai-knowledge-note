import { useSetPHDriveEditorConfig } from "@powerhousedao/reactor-browser";
import type { EditorProps } from "document-model";
import { DriveExplorer } from "./components/DriveExplorer.js";
import { editorConfig } from "./config.js";
import { useDriveInit } from "./hooks/use-drive-init.js";
import { ThemeProvider } from "../shared/theme-context.js";

export default function Editor(props: EditorProps) {
  useSetPHDriveEditorConfig(editorConfig);
  useDriveInit();
  return (
    <ThemeProvider>
      <div
        className="h-screen overflow-hidden"
        style={{ backgroundColor: "var(--bai-bg)", color: "var(--bai-text)" }}
      >
        <DriveExplorer {...props} />
      </div>
    </ThemeProvider>
  );
}
