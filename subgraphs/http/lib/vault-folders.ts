import type { HttpRouteDeps } from "./deps.js";
import { HttpError } from "./respond.js";

interface DriveNode {
  id?: string;
  name?: string;
  kind?: string;
  documentType?: string;
  parentFolder?: string | null;
}

/**
 * Where each vault document type lives.
 *
 * The *rule* is fixed here so that no caller has to know the vault's layout —
 * `POST sources` takes content and nothing else. The folder **UUID** is still
 * resolved from the drive at request time: ids differ per drive and this
 * package serves several, so a hardcoded id would be a cross-drive corruption
 * waiting to happen.
 */
export const VAULT_FOLDERS: Record<string, string> = {
  "bai/source": "/sources",
  "bai/knowledge-note": "/knowledge/notes",
  "bai/moc": "/knowledge",
  "bai/tension": "/ops",
  "bai/observation": "/ops",
  "powerhouse/scopeofwork": "/projects",
  "bai/wbs": "/projects",
};

const isFolder = (node: DriveNode): boolean =>
  node.kind === "folder" || !node.documentType;

/** Builds `/absolute/path` -> folder id for every folder in the drive. */
export function folderPaths(nodes: DriveNode[]): Map<string, string> {
  const byId = new Map<string, DriveNode>();
  for (const node of nodes) if (node.id) byId.set(node.id, node);

  const pathOf = (node: DriveNode): string => {
    const parts: string[] = [node.name ?? ""];
    let parent = node.parentFolder ?? undefined;
    const seen = new Set<string>();
    while (parent && byId.has(parent) && !seen.has(parent)) {
      seen.add(parent);
      const next = byId.get(parent)!;
      parts.push(next.name ?? "");
      parent = next.parentFolder ?? undefined;
    }
    return `/${parts.reverse().join("/")}`;
  };

  const paths = new Map<string, string>();
  for (const node of nodes) {
    if (node.id && isFolder(node)) paths.set(pathOf(node), node.id);
  }
  return paths;
}

/**
 * Resolves the folder a document of `documentType` must be created in.
 *
 * Throws rather than falling back to the drive root. A document at the root is
 * invisible to the pipeline and to the app's folder views, and a create whose
 * containment quietly degraded is exactly how orphans accumulate.
 */
export async function resolveVaultFolder(
  deps: HttpRouteDeps,
  driveId: string,
  documentType: string,
): Promise<string> {
  const path = VAULT_FOLDERS[documentType];
  if (!path) {
    throw new HttpError(
      400,
      "UNSUPPORTED_DOCUMENT_TYPE",
      `No vault folder is defined for ${documentType}`,
      Object.keys(VAULT_FOLDERS).map((type) => ({ path: type })),
    );
  }
  const drive = await deps.reactorClient.get(driveId);
  const nodes =
    (drive.state as { global?: { nodes?: DriveNode[] } } | undefined)?.global
      ?.nodes ?? [];
  const folderId = folderPaths(nodes).get(path);
  if (!folderId) {
    throw new HttpError(
      400,
      "FOLDER_UNRESOLVED",
      `The drive has no ${path} folder, so a ${documentType} cannot be placed. ` +
        `Open the drive in the app once to scaffold its folders.`,
      [{ path, rule: "VAULT_LAYOUT" }],
    );
  }
  return folderId;
}
