/**
 * A drive tile for a vault the current session cannot read.
 *
 * Connect lists a drive only if a document for it sits in `ph.drives`, and on
 * a protected Switchboard that document cannot be fetched without a session.
 * So while signed out (or signed in but not yet granted) the vault simply is
 * not there — no tile, nothing to click, no hint that signing in would help.
 *
 * A stub restores the tile. It is the drive document with its node tree
 * removed: the tile shows the right name and icon, `header.meta.preferredEditor`
 * routes a click to the vault app, and the vault app's AuthGate then explains
 * the actual situation — sign in, or ask for access — with the address to
 * hand an administrator. The tree is left out on purpose: the previous
 * session's node names would otherwise remain visible to whoever uses the
 * browser next.
 *
 * Two sources, for two moments:
 *
 *  - `presentationOf` keeps the shape of a drive this browser DID read while
 *    signed in. Preferred, because it is byte-for-byte what Connect and the
 *    vault app consumed the last time, minus nodes.
 *  - `stubFromDriveInfo` builds one from the Switchboard's `GET /d/<id>`
 *    answer, for a share link opened on a browser that has never had a
 *    session. It mirrors what `phDocumentFromGetDocument` produces, so the
 *    consumers see the same field set either way.
 *
 * Pure, so the shapes are testable without a DOM.
 */

/** The vault app's id, as `header.meta.preferredEditor` names it. */
export const VAULT_APP_ID = "knowledge-vault";

/** The parts of a drive document these helpers read or write. */
export type DriveLike = {
  header: {
    id: string;
    meta?: Record<string, unknown>;
    [key: string]: unknown;
  };
  state: {
    global?: { nodes?: unknown[]; [key: string]: unknown };
    [key: string]: unknown;
  };
  initialState?: { global?: { nodes?: unknown[]; [key: string]: unknown }; [key: string]: unknown };
  [key: string]: unknown;
};

/** What `GET /d/<id>` returns; every field but `id` may be missing. */
export type DriveInfo = {
  id: string;
  slug?: string | null;
  name?: string | null;
  icon?: string | null;
  meta?: Record<string, unknown> | null;
};

function withoutNodes<T extends { global?: { nodes?: unknown[]; [key: string]: unknown } }>(
  state: T | undefined,
): T | undefined {
  if (!state?.global) return state;
  return { ...state, global: { ...state.global, nodes: [] } };
}

/**
 * The drive as it should be remembered: everything but the node tree. Both
 * `state` and `initialState` are stripped — `phDocumentFromGetDocument` sets
 * them to the same object, so stripping one and keeping the other would keep
 * every node name in storage after all.
 */
export function presentationOf(drive: DriveLike): DriveLike {
  return {
    ...drive,
    state: withoutNodes(drive.state) ?? drive.state,
    initialState: withoutNodes(drive.initialState),
  };
}

/**
 * A stub from a remembered presentation. Re-strips nodes defensively — the
 * memory is only ever written by `presentationOf`, but a stub must never be
 * the thing that leaks a tree — and makes sure the click routes to the vault.
 */
export function stubFromPresentation(presentation: DriveLike): DriveLike {
  const stripped = presentationOf(presentation);
  return {
    ...stripped,
    header: {
      ...stripped.header,
      meta: { preferredEditor: VAULT_APP_ID, ...stripped.header.meta },
    },
  };
}

/** True when the info names a drive that asks for the vault app. */
export function isVaultDriveInfo(info: DriveInfo): boolean {
  return info.meta?.preferredEditor === VAULT_APP_ID;
}

/**
 * A stub from the Switchboard's drive-info answer, shaped like a document the
 * GraphQL read path would have produced: same header fields, empty operation
 * lists per scope, an empty clipboard. `now` is injected so the shape is
 * deterministic under test.
 */
export function stubFromDriveInfo(info: DriveInfo, now: string): DriveLike {
  const name = info.name ?? "";
  const state = {
    global: { name, icon: info.icon ?? null, nodes: [] as unknown[] },
    local: {},
  };
  return {
    header: {
      id: info.id,
      sig: { publicKey: {}, nonce: "" },
      documentType: "powerhouse/document-drive",
      createdAtUtcIso: now,
      lastModifiedAtUtcIso: now,
      slug: info.slug ?? "",
      name,
      branch: "main",
      revision: { global: 0, local: 0 },
      meta: { preferredEditor: VAULT_APP_ID, ...(info.meta ?? {}) },
    },
    state,
    initialState: state,
    operations: { global: [], local: [] },
    clipboard: [],
  };
}

/** Whether `drives` already holds a document for `id`. */
export function hasDrive(drives: readonly { header: { id: string } }[], id: string): boolean {
  return drives.some((d) => d.header.id === id);
}
