import type { HttpRouteDeps } from "./deps.js";

interface DriveNode {
  id?: string;
  documentType?: string;
}

/**
 * Locates a document by type inside a drive, using the drive's own tree rather
 * than `find`: the search filter's `parentId` is the immediate parent folder,
 * not the drive, so it cannot answer "the health report in this drive".
 */
export async function findDocumentInDrive(
  deps: HttpRouteDeps,
  driveId: string,
  documentType: string,
): Promise<string | undefined> {
  const drive = await deps.reactorClient.get(driveId);
  const nodes =
    (drive.state as { global?: { nodes?: DriveNode[] } } | undefined)?.global
      ?.nodes ?? [];
  return nodes.find((node) => node.documentType === documentType)?.id;
}