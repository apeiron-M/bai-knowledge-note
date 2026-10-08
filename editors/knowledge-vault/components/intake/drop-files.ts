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
  if (listed.length > 0) return listed;
  const uris = dt.getData("text/uri-list");
  const read = getHostConfig()?.readDroppedFiles;
  if (!read || !/^file:/m.test(uris)) return [];
  try {
    return await read(uris);
  } catch {
    return [];
  }
}
