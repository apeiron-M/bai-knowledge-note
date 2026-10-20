/**
 * The vault's live-change bus, fed by the in-page engine instead of a
 * Switchboard socket: every change the engine commits is announced the way
 * `useRemoteFirst`'s feed announces a remote one, so the sidebar, graph and
 * timeline refresh the same way.
 */
import type { IReactorClient } from "@powerhousedao/reactor";
import {
  announceVaultRemoteChange,
  isStructuralChange,
  setVaultLive,
  type VaultRemoteChangeType,
} from "../editors/shared/vault-live.js";

/** Liveness expires after a minute without events; an in-page engine is always live. */
const RENEW_LIVE_MS = 30_000;

export function startLiveFeed(
  client: IReactorClient,
  driveId: string,
  onDriveChanged: () => void,
): () => void {
  setVaultLive(true);
  const renew = setInterval(() => setVaultLive(true), RENEW_LIVE_MS);
  const unsubscribe = client.subscribe({}, (event) => {
    setVaultLive(true);
    const type = event.type.toUpperCase() as VaultRemoteChangeType;
    const documents = event.documents.map((d) => ({
      id: d.header.id,
      documentType: d.header.documentType,
    }));
    const touchesDrive = documents.some((d) => d.id === driveId);
    const structural =
      isStructuralChange(type) && (event.context?.parentId === driveId || touchesDrive);
    announceVaultRemoteChange({ driveId, type, documents, structural, at: Date.now() });
    if (structural || touchesDrive) onDriveChanged();
  });
  return () => {
    clearInterval(renew);
    unsubscribe();
    setVaultLive(false);
  };
}
