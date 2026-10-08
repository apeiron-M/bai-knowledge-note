import { useSelectedDriveId } from "@powerhousedao/reactor-browser";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useHostConfig } from "../../shared/use-host-config.js";
import { needsUser as countNeedsUser } from "../lib/intake-model.js";
import type { AttachmentPort } from "../lib/intake-service.js";
import {
  intakeStoreFor,
  pinnedVaultApi,
  sortOffered,
} from "../lib/intake-store.js";

export type { IncomingFile } from "../lib/intake-store.js";

const NO_FORMATS: readonly string[] = [];

/**
 * The intake batch for the selected drive, as the views read it.
 *
 * The batch itself lives in `intake-store.ts`, outside React, for the life of
 * the page: unmounting this hook — a tab switch, another drive, the desktop
 * app's Settings — leaves the conversion running, and the next mount reads
 * the same batch back. `DriveExplorer` still calls it once, above the view
 * switch, so the Sources tab badge can read `needsUser` from anywhere.
 */
export function useIntakeBatch({
  attachments,
  formats = NO_FORMATS,
}: {
  attachments?: AttachmentPort;
  /** What the converter reads (`convert/health`); a pick or a drop is checked against it. */
  formats?: readonly string[];
}) {
  const driveId = useSelectedDriveId();
  const store = intakeStoreFor(driveId ?? "");
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );

  // Re-pin the batch's api to the host as declared now: a sign-in completed
  // since the batch started reaches its next request.
  const host = useHostConfig();
  useEffect(() => {
    store.bindApi(pinnedVaultApi());
  }, [store, host]);

  const onFiles = useCallback(
    (files: readonly File[]) => {
      const { accepted, refused } = sortOffered(
        files,
        formats,
        store.getSnapshot().files,
      );
      store.add(accepted, refused);
    },
    [store, formats],
  );
  const onPublish = useCallback(
    (id: string) => store.publish(id, attachments),
    [store, attachments],
  );
  const onRetryAttach = useCallback(
    (id: string) => store.retryAttach(id, attachments),
    [store, attachments],
  );

  const { files } = snapshot;
  return {
    files,
    driveId,
    /** The panel is shown when asked for, or while a batch exists. */
    visible: snapshot.requested || files.length > 0,
    open: store.open,
    close: store.close,
    openId: snapshot.openId,
    setOpenId: store.setOpenId,
    publishing: snapshot.publishing,
    notice: snapshot.notice,
    /** Files the last pick or drop could not take, each with its reason. */
    refused: snapshot.refused,
    needsUser: countNeedsUser(files),
    publishedCount: files.filter((f) => f.publishedIds !== undefined).length,
    isComplete:
      files.length > 0 &&
      files.every(
        (f) => f.state === "converted" && f.publishedIds !== undefined,
      ),
    /** Anything converting or waiting to — the work that runs in the background. */
    working: files.some(
      (f) => f.state === "queued" || f.state === "converting",
    ),
    onFiles,
    onRetry: store.retry,
    onRunOcr: store.runOcr,
    onRemove: store.remove,
    onToggle: store.toggle,
    onAll: store.all,
    onType: store.type,
    onFolderName: store.folderName,
    onPublish,
    onRetryAttach,
    cancel: store.cancel,
    reset: store.reset,
  };
}

export type IntakeBatch = ReturnType<typeof useIntakeBatch>;
