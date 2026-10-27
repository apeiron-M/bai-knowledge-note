/**
 * M0: what the chat acts on comes from what the user is viewing, not from a
 * picker. A `ContextFrame` is rebuilt on every render from the drive app's
 * selection; the target tag shows `frame.target`. The target's shape stays
 * close to reactor-browser's `ai` `ChatContext` (`driveId`, `nodeId`,
 * `nodeKind`, `documentType`) so M1 can build on it.
 *
 * Nothing here imports vault tables: the frame and the provider interface
 * are shaped for extraction into `nl-runtime`.
 */

/** The document or drive a frame (or a card) points at. */
export type ContextTarget =
  | {
      kind: "document";
      id: string;
      driveId: string;
      title: string;
      /** e.g. `bai/knowledge-note`. */
      docType: string;
    }
  | { kind: "drive"; id: string; name: string };

export type DocumentTarget = Extract<ContextTarget, { kind: "document" }>;

/** A drive document as a candidate: never its state, only id, type, names. */
export interface CandidateDoc {
  id: string;
  docType: string;
  /** The display title (loaded title when known, else the node name). */
  title: string;
  /** Other names it is known by (a stale node name, an older title). */
  aliases?: string[];
}

export interface ContextFrame {
  target: ContextTarget;
  folderId?: string;
  /** Ids of the results the user can see, in order (empty in M0). */
  visibleIds: string[];
  focusedItem?: string;
  /** Recently opened or dispatched-to documents, most recent first. */
  recentIds: string[];
}

/** The interface M1 lifts into `nl-runtime`. */
export interface ChatContextProvider {
  current(): ContextFrame;
  /** Async so M1 can merge a server search under a deadline. */
  candidates(q: string, k: number): Promise<CandidateDoc[]>;
  resolveOrdinal(n: number): CandidateDoc | undefined;
}

export interface ContextTargetInput {
  driveId: string;
  driveName: string;
  /** The open document's id, or undefined on a folder or the drive root. */
  selectedId: string | undefined;
  /** The open document's node (name, type), when the drive lists it. */
  node?: { name: string; documentType: string };
  /** The open document once loaded: its type and state title. */
  loaded?: { docType: string; title: string };
}

/**
 * The tag's target: the open document (title from its loaded state, else
 * its node name, else its id), or the drive when nothing is open.
 */
export function contextTargetFrom(i: ContextTargetInput): ContextTarget {
  if (!i.selectedId)
    return { kind: "drive", id: i.driveId, name: i.driveName || "this drive" };
  return {
    kind: "document",
    id: i.selectedId,
    driveId: i.driveId,
    title: i.loaded?.title || i.node?.name || i.selectedId,
    docType: i.loaded?.docType || i.node?.documentType || "",
  };
}

export function sameTarget(a: ContextTarget, b: ContextTarget): boolean {
  return a.kind === b.kind && a.id === b.id;
}
