import { attachmentPort } from "./attachments.js";
import {
  intakeStoreFor,
  pinnedVaultApi,
  type IntakeSnapshot,
} from "./intake-store.js";

export type { IntakeSnapshot };
export type { IntakeFile } from "./intake-model.js";

/** The part of `convert/health` that says how many files convert at once; absent from an older service. */
type LaneHealth = {
  slots?: { models: number; other: number };
  modelExtensions?: string[];
};

/**
 * Per vault, the files a host intake added. Only those are published as they convert: the store is the one the
 * vault's Sources view uses, and a file added there goes to its review, to be checked before anything is filed.
 * Module state, because a host makes a `hostIntake(driveId)` per batch (the guide does) and starts publishing once.
 */
const hostAdded = new Map<string, Set<string>>();
function hostAddedFor(driveId: string): Set<string> {
  let ids = hostAdded.get(driveId);
  if (!ids) {
    ids = new Set();
    hostAdded.set(driveId, ids);
  }
  return ids;
}

/**
 * Intake for a host that shows its own progress instead of the vault's panel — the desktop app's setup guide.
 * It is the same per-vault store the Sources view uses, so files added here show there too; each file added
 * here is published as soon as it has converted: its sections filed as sources and queued, its original kept.
 * Files added in the vault itself are not: they wait in the Sources view's review, as they always do.
 */
export function hostIntake(driveId: string) {
  const store = intakeStoreFor(driveId);
  const port = attachmentPort();
  // The converter's lanes, read once and best effort: no view here reads the health for the batch. Without
  // an answer — an older service, or a converter still starting — the batch sends one file at a time.
  void pinnedVaultApi()
    .get<LaneHealth>("/convert/health")
    .then((health) => {
      if (!health.slots) return;
      store.configure({
        models: health.slots.models,
        other: health.slots.other,
        modelExtensions: health.modelExtensions ?? [],
      });
    })
    .catch(() => {});
  const mine = hostAddedFor(driveId);
  let inFlight = false;
  const publishNext = () => {
    if (inFlight || store.getSnapshot().publishing) return;
    const next = store.getSnapshot().files.find((f) => mine.has(f.id) && f.state === "converted" && !f.publishedIds);
    if (!next) return;
    inFlight = true;
    void store.publish(next.id, port).finally(() => {
      inFlight = false;
      publishNext();
    });
  };
  return {
    add(files: readonly File[]): void {
      const before = new Set(store.getSnapshot().files.map((f) => f.id));
      store.add(files.map((f) => ({ name: f.name, size: f.size, mimeType: f.type || "application/octet-stream", data: f })));
      // The store mints the ids: the new ones are this host's.
      for (const f of store.getSnapshot().files) if (!before.has(f.id)) mine.add(f.id);
    },
    subscribe: store.subscribe,
    getSnapshot: store.getSnapshot,
    /** Publish each file once it has converted, until the returned function is called. */
    publishAsConverted(): () => void {
      const off = store.subscribe(publishNext);
      publishNext();
      return off;
    },
  };
}
