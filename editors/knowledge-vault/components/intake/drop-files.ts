import { getHostConfig } from "../../../shared/host-config.js";

/**
 * A drag that carries files — or, under a host that can read them, their addresses: WebKitGTK (the Linux
 * desktop app) hands a page `text/uri-list` for files dragged from a file manager, never the files.
 */
export function dragCarriesFiles(dt: DataTransfer): boolean {
  const types = Array.from(dt.types);
  return types.includes("Files") || (types.includes("text/uri-list") && typeof getHostConfig()?.readDroppedFiles === "function");
}

/**
 * The dropped files: the drop's own, or the host's reading of their addresses. Call it inside the drop handler —
 * the drop's data is read before the first await, while the event still allows it.
 */
export async function droppedFiles(dt: DataTransfer): Promise<File[]> {
  const listed = Array.from(dt.files);
  if (listed.length > 0) return listed; // Windows, macOS, browsers: the drop holds the files themselves
  const read = getHostConfig()?.readDroppedFiles;
  if (!read) return [];
  // WebKitGTK leaves text/uri-list empty and shows only the first file's address, in a text/html link: the
  // addresses the page can see go to the host, which reads the drop's whole list from the window itself.
  const shown = ["text/uri-list", "text/html", "text/plain"].map((type) => {
    try {
      return dt.getData(type);
    } catch {
      return "";
    }
  });
  const uris = [...new Set([...shown.join("\n").matchAll(/file:\/\/[^\s"'<>]+/g)].map((m) => m[0].replace(/&amp;/g, "&")))];
  try {
    return await read(uris.join("\n"));
  } catch {
    return [];
  }
}
