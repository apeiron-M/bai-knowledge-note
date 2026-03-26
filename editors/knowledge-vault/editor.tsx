import { useSetPHDriveEditorConfig } from "@powerhousedao/reactor-browser";
import type { EditorProps } from "document-model";
import { DriveExplorer } from "./components/DriveExplorer.js";
import { editorConfig } from "./config.js";
import { useDriveInit } from "./hooks/use-drive-init.js";

export default function Editor(props: EditorProps) {
  useSetPHDriveEditorConfig(editorConfig);
  useDriveInit();
  return (
    <div className="h-screen overflow-hidden bg-[#1e1e2e] text-gray-200">
      <DriveExplorer {...props} />
    </div>
  );
}
