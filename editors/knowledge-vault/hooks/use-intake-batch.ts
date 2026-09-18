import { useSelectedDriveId } from "@powerhousedao/reactor-browser";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addFiles,
  discardUnpublished,
  isReviewReady,
  markPublished,
  needsUser as countNeedsUser,
  nextQueued,
  removeFile,
  setAllSections,
  setState,
  toggleSection,
  type IntakeFile,
} from "../lib/intake-model.js";
import {
  attachOriginal,
  conversionProgress,
  convertFile,
  publishFile,
  PublishPartialFailure,
  type AttachmentPort,
} from "../lib/intake-service.js";
import { createVaultApi, VaultApiFailure } from "../lib/vault-api.js";

export type IncomingFile = {
  name: string;
  size: number;
  mimeType: string;
  data: Uint8Array;
};

/**
 * The intake batch: files, their bytes, the single-flight conversion scheduler,
 * publish, and the panel's lifecycle — hoisted to `DriveExplorer` so a tab
 * switch never unmounts a conversion in flight, and so the Sources tab badge
 * can read `needsUser` from outside the Sources view.
 *
 * The batch is converted **one file at a time** on purpose. The service's warm
 * pipeline is single-threaded and queues overlapping calls in submission
 * order, so converting in parallel would only reorder work inside the engine
 * while making the per-file progress a lie.
 */
export function useIntakeBatch({
  attachments,
}: {
  attachments?: AttachmentPort;
}) {
  const driveId = useSelectedDriveId();
  const api = useMemo(() => createVaultApi(), []);
  const bytes = useRef(new Map<string, Uint8Array>());
  const running = useRef(false);

  const [files, setFiles] = useState<IntakeFile[]>([]);
  /** The user asked for the panel (clicked "Add sources"); it also shows while the batch is non-empty. */
  const [requested, setRequested] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  /** One line of feedback under the goal header: what landed, or what failed. */
  const [notice, setNotice] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);
  const [tick, setTick] = useState(0);

  // The batch runs itself: whenever a file is queued and nothing is converting,
  // take the next one. Single-flight by `running`, not by state, so a re-render
  // cannot start two.
  useEffect(() => {
    if (running.current) return;
    const next = nextQueued(files);
    if (!next) return;
    const data = bytes.current.get(next.id);
    if (!data) return;

    running.current = true;
    setFiles((current) =>
      setState(current, next.id, {
        state: "converting",
        startedAt: Date.now(),
        progress: undefined,
      }),
    );

    // Watch the conversion: the service counts pages as they finish, so the
    // row can show "page 12 of 23" — measured, never estimated.
    const job = crypto.randomUUID();
    const poll = setInterval(() => {
      void conversionProgress(job, { api })
        .then((progress) => {
          if (progress)
            setFiles((current) => setState(current, next.id, { progress }));
        })
        .catch(() => {});
    }, 1000);

    // Figures: pictures and display formulas as images, to become inline attachments of the sources.
    void convertFile(
      {
        name: next.name,
        bytes: data,
        ocr: next.forceOcr === true,
        job,
        figures: true,
      },
      { api },
    )
      .then((converted) =>
        setFiles((current) =>
          setState(current, next.id, {
            state: "converted",
            converted,
            finishedAt: Date.now(),
          }),
        ),
      )
      .catch((error: unknown) => {
        // The service converts one file at a time and says so: not a failure
        // of this file, a retry in a moment — another tab or an agent is using it.
        if (error instanceof VaultApiFailure && error.code === "CONVERT_BUSY") {
          setTimeout(
            () =>
              setFiles((current) =>
                setState(current, next.id, { state: "queued" }),
              ),
            8_000,
          );
          setFiles((current) =>
            setState(current, next.id, {
              state: "queued",
              error: "the converter is busy with another file — retrying",
            }),
          );
          return;
        }
        setFiles((current) =>
          setState(current, next.id, {
            state: "failed",
            error: error instanceof Error ? error.message : String(error),
            finishedAt: Date.now(),
          }),
        );
      })
      .finally(() => {
        clearInterval(poll);
        running.current = false;
        // Nudge the effect: state changed, but a queued file may remain.
        setFiles((current) => [...current]);
      });
  }, [files, api]);

  // Elapsed time on converting rows is measured, so it may be shown; tick once a second while anything converts.
  const converting = files.some((f) => f.state === "converting");
  useEffect(() => {
    if (!converting) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [converting]);

  // When nothing is open for review, the first file that becomes ready opens itself.
  useEffect(() => {
    if (openId && files.some((f) => f.id === openId)) return;
    const ready = files.find(isReviewReady);
    setOpenId(ready ? ready.id : null);
  }, [files, openId]);

  const onFiles = useCallback((incoming: IncomingFile[]) => {
    const additions = incoming.map(({ name, size, mimeType }) => ({
      name,
      size,
      mimeType,
    }));
    setFiles((current) => {
      const next = addFiles(current, additions);
      // `addFiles` mints the ids; pair each new id with the bytes, in order.
      next
        .slice(current.length)
        .forEach((file, index) =>
          bytes.current.set(file.id, incoming[index].data),
        );
      return next;
    });
    setRequested(true);
    setNotice(null);
  }, []);

  /** The user accepts the OCR cost the service would not spend unasked. */
  const onRunOcr = useCallback((id: string) => {
    setFiles((current) =>
      setState(current, id, {
        state: "queued",
        forceOcr: true,
        converted: undefined,
        error: undefined,
      }),
    );
  }, []);

  const onRetry = useCallback((id: string) => {
    setFiles((current) =>
      setState(current, id, { state: "queued", error: undefined }),
    );
  }, []);

  const onRemove = useCallback((id: string) => {
    bytes.current.delete(id);
    setFiles((current) => removeFile(current, id));
  }, []);

  const onToggle = useCallback((id: string, index: number) => {
    setFiles((current) => toggleSection(current, id, index));
  }, []);
  const onAll = useCallback((id: string, on: boolean) => {
    setFiles((current) => setAllSections(current, id, on));
  }, []);
  const onType = useCallback((id: string, sourceType: string) => {
    setFiles((current) => setState(current, id, { sourceType }));
  }, []);
  const onFolderName = useCallback((id: string, folderName: string) => {
    setFiles((current) => setState(current, id, { folderName }));
  }, []);

  const onPublish = useCallback(
    async (id: string) => {
      const file = files.find((f) => f.id === id);
      const data = file ? bytes.current.get(file.id) : undefined;
      // A published row stays visible for its message but never publishes twice:
      // `POST sources` is not idempotent on content.
      if (!file || !data || !driveId || file.publishedIds) return;

      setPublishing(true);
      try {
        const result = await publishFile(file, data, {
          api,
          attachments,
          driveId,
        });
        setFiles((current) =>
          setState(markPublished(current, file.id, result.sourceIds), file.id, {
            attachError: result.attached ? undefined : result.attachError,
          }),
        );
        if (!result.attached && result.attachError) {
          // Loud on purpose: a source without its original is a degraded state,
          // and the notice below disappears with the batch.
          console.error("[intake] original not attached:", result.attachError, {
            file: file.name,
            sourceIds: result.sourceIds,
          });
        }
        const n = result.sourceIds.length;
        setNotice({
          kind: result.attachError ? "error" : "ok",
          text:
            `${n} source${n === 1 ? "" : "s"} added to /sources/${file.folderName}/, queued for extraction` +
            (result.skipped > 0
              ? ` · ${result.skipped} empty part${result.skipped === 1 ? "" : "s"} skipped`
              : "") +
            (result.attached
              ? " · original attached"
              : result.attachError
                ? ` · the original could not be attached: ${result.attachError}`
                : ""),
        });
      } catch (error) {
        if (error instanceof PublishPartialFailure) {
          // What landed is recorded on the row so a retry cannot duplicate it.
          setFiles((current) =>
            markPublished(current, file.id, error.partial.sourceIds),
          );
          setNotice({
            kind: "error",
            text: `${error.partial.sourceIds.length} of ${file.selected.filter(Boolean).length} sources were created before it failed — ${error.message}`,
          });
        } else {
          setNotice({
            kind: "error",
            text: `Could not add the sources: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      } finally {
        setPublishing(false);
      }
    },
    [api, attachments, driveId, files],
  );

  /**
   * "Cancel": drop every file that is not in the vault. With nothing published
   * the panel closes; with some published, what remains is complete and the
   * panel shows the summary with Finish. A conversion in flight is abandoned —
   * its result lands on an id that no longer exists and is ignored.
   */
  const cancel = useCallback(() => {
    setFiles((current) => {
      for (const f of current) {
        if (f.publishedIds === undefined) bytes.current.delete(f.id);
      }
      const kept = discardUnpublished(current);
      if (kept.length === 0) setRequested(false);
      return kept;
    });
    setOpenId(null);
    setNotice(null);
  }, []);

  /** Retry only the attach step for a published row whose original did not land. */
  const onRetryAttach = useCallback(
    async (id: string) => {
      const file = files.find((f) => f.id === id);
      const data = file ? bytes.current.get(file.id) : undefined;
      if (
        !file ||
        !data ||
        !driveId ||
        !attachments ||
        !file.publishedIds?.length
      )
        return;
      setFiles((current) =>
        setState(current, id, { attachError: "attaching…" }),
      );
      const result = await attachOriginal(file, data, file.publishedIds, {
        api,
        attachments,
        driveId,
      });
      setFiles((current) =>
        setState(current, id, {
          attachError: result.attached ? undefined : result.attachError,
        }),
      );
      if (!result.attached)
        console.error(
          "[intake] original still not attached:",
          result.attachError,
        );
    },
    [api, attachments, driveId, files],
  );

  /** "Finish": the batch is over, the panel closes, the sources are already in the vault. */
  const reset = useCallback(() => {
    bytes.current.clear();
    setFiles([]);
    setOpenId(null);
    setNotice(null);
    setRequested(false);
  }, []);

  const needsUser = countNeedsUser(files);
  const publishedCount = files.filter(
    (f) => f.publishedIds !== undefined,
  ).length;
  const isComplete =
    files.length > 0 &&
    files.every((f) => f.state === "converted" && f.publishedIds !== undefined);

  return {
    files,
    driveId,
    /** The panel is shown when asked for, or while a batch exists. */
    visible: requested || files.length > 0,
    open: useCallback(() => setRequested(true), []),
    close: useCallback(() => setRequested(false), []),
    openId,
    setOpenId,
    publishing,
    notice,
    tick,
    needsUser,
    publishedCount,
    isComplete,
    onFiles,
    onRetry,
    onRunOcr,
    onRemove,
    onToggle,
    onAll,
    onType,
    onFolderName,
    onPublish,
    onRetryAttach,
    cancel,
    reset,
  };
}

export type IntakeBatch = ReturnType<typeof useIntakeBatch>;
