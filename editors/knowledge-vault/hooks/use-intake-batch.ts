import { useSelectedDriveId } from "@powerhousedao/reactor-browser";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useHostConfig } from "../../shared/use-host-config.js";
import {
  acceptedExtensions,
  extensionOf,
  needsUser as countNeedsUser,
} from "../lib/intake-model.js";
import type { AttachmentPort } from "../lib/intake-service.js";
import {
  isAdding,
  intakeStoreFor,
  pinnedVaultApi,
  sortOffered,
} from "../lib/intake-store.js";

export type { IncomingFile } from "../lib/intake-store.js";

const NO_FORMATS: readonly string[] = [];
const NO_EXTENSIONS: readonly string[] = [];

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
  maxUploadBytes,
  slots,
  modelExtensions = NO_EXTENSIONS,
}: {
  attachments?: AttachmentPort;
  /** What the converter reads (`convert/health`); a pick or a drop is checked against it. */
  formats?: readonly string[];
  /** The vault's cap for one file (`convert/health`), checked before any upload. */
  maxUploadBytes?: number;
  /** The converter's lanes (`convert/health`); absent from an older service, which takes one file at a time. */
  slots?: { models: number; other: number };
  /** The extensions that convert in the models lane (`convert/health`). */
  modelExtensions?: readonly string[];
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

  // The Sources view says what the vault already holds (`setVault`), so a file
  // added before is recognised before it is read; until it has, files wait.
  useEffect(() => {
    store.expectVault();
  }, [store]);

  // Tell the batch how many files the converter takes at once, per lane. Not
  // told — an older service, or health not read yet — it sends one at a time.
  useEffect(() => {
    if (!slots) return;
    store.configure({
      models: slots.models,
      other: slots.other,
      modelExtensions,
    });
  }, [store, slots, modelExtensions]);

  // What a pick or a drop may hold: the converter's formats and the
  // extensions it reads with its models (an image is `png`, not `image`).
  const accepts = useMemo(
    () => acceptedExtensions(formats, modelExtensions),
    [formats, modelExtensions],
  );
  const onFiles = useCallback(
    (files: readonly File[]) => {
      const { accepted, refused } = sortOffered(
        files,
        accepts,
        store.getSnapshot().files,
        maxUploadBytes,
      );
      store.add(accepted, refused);
    },
    [store, accepts, maxUploadBytes],
  );
  const onPublish = useCallback(
    (id: string) => store.publish(id, attachments),
    [store, attachments],
  );
  const onPublishAll = useCallback(
    () => store.publishAll(attachments),
    [store, attachments],
  );
  /** Which of the converter's lanes a file reads in: the models (PDFs, images) or the rest. */
  const laneOf = useCallback(
    (name: string): "models" | "other" =>
      modelExtensions.includes(extensionOf(name)) ? "models" : "other",
    [modelExtensions],
  );
  const onRetryAttach = useCallback(
    (id: string) => store.retryAttach(id, attachments),
    [store, attachments],
  );

  const { files } = snapshot;
  return {
    files,
    driveId,
    /** The panel is shown when asked for, while a batch exists, or while an earlier add carries on. */
    visible: snapshot.requested || files.length > 0 || snapshot.carrying.length > 0,
    open: store.open,
    close: store.close,
    openId: snapshot.openId,
    setOpenId: store.setOpenId,
    publishing: snapshot.publishing,
    publishingId: snapshot.publishingId,
    /** How far the file being added is: sources in the vault, of how many. */
    progress: snapshot.progress,
    /** Adds from an earlier visit that did not finish, carried on here. */
    carrying: snapshot.carrying,
    onCarryOn: store.carryOn,
    onForgetCarried: store.forgetCarried,
    /**
     * Sources are being added right now — this page's add or an earlier one
     * carried on. What a quit asks about: cut off, it carries on next time.
     */
    adding: isAdding(snapshot),
    /** Folded to one line by "Hide"; the batch carries on. */
    collapsed: snapshot.collapsed,
    collapse: store.collapse,
    expand: store.expand,
    /** Files the last pick or drop could not take, each with its reason. */
    refused: snapshot.refused,
    dismissRefused: store.dismissRefused,
    /** The extensions a pick or a drop may hold — the picker's `accept`. */
    accepts,
    laneOf,
    /** Files are checked against what the vault holds before they are read. */
    checking: snapshot.checking,
    /** What the vault holds now (the Sources view); null while it loads. */
    setVault: store.setVault,
    /** Read and add a file the vault already holds, as a second copy. */
    addAgain: store.addAgain,
    needsUser: countNeedsUser(files),
    publishedCount: files.filter((f) => f.publishedIds !== undefined).length,
    isComplete:
      files.length > 0 &&
      files.every(
        (f) => f.state === "converted" && f.publishedIds !== undefined,
      ),
    /** Anything converting or waiting to, or being added — the work that runs in the background. */
    working:
      files.some((f) => f.state === "queued" || f.state === "converting") ||
      snapshot.carrying.some((c) => c.status === "adding" || c.status === "waiting"),
    onFiles,
    onRetry: store.retry,
    onRunOcr: store.runOcr,
    onRemove: store.remove,
    onToggle: store.toggle,
    onAll: store.all,
    onType: store.type,
    onFolderName: store.folderName,
    onPublish,
    onPublishAll,
    onRetryAttach,
    cancel: store.cancel,
    reset: store.reset,
  };
}

export type IntakeBatch = ReturnType<typeof useIntakeBatch>;
