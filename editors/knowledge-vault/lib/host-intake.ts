import { attachmentPort } from "./attachments.js";
import { intakeStoreFor, type IntakeSnapshot } from "./intake-store.js";

export type { IntakeSnapshot };
export type { IntakeFile } from "./intake-model.js";

/**
 * Intake for a host that shows its own progress instead of the vault's panel — the desktop app's setup guide.
 * It is the same per-vault store the Sources view uses, so files added here show there too; each file is
 * published as soon as it has converted: its sections filed as sources and queued, its original kept.
 */
export function hostIntake(driveId: string) {
  const store = intakeStoreFor(driveId);
  const port = attachmentPort();
  let inFlight = false;
  const publishNext = () => {
    if (inFlight || store.getSnapshot().publishing) return;
    const next = store.getSnapshot().files.find((f) => f.state === "converted" && !f.publishedIds);
    if (!next) return;
    inFlight = true;
    void store.publish(next.id, port).finally(() => {
      inFlight = false;
      publishNext();
    });
  };
  return {
    add(files: readonly File[]): void {
      store.add(files.map((f) => ({ name: f.name, size: f.size, mimeType: f.type || "application/octet-stream", data: f })));
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
