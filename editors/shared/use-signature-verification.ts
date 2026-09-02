/**
 * Verify operation signatures lazily and remember the verdicts.
 *
 * A signature never changes, so verdicts are cached module-wide by the
 * tuple string: scrolling a history list or reopening a note re-verifies
 * nothing. Verification is a handful of milliseconds each; a list of a few
 * hundred operations settles well under a second.
 */
import { useEffect, useState } from "react";
import {
  verifySignatureTuple,
  type VerificationResult,
} from "./verify-signature.js";

const cache = new Map<string, VerificationResult>();
const inFlight = new Map<string, Promise<VerificationResult>>();

export function verifyCached(
  signature: string | null,
): Promise<VerificationResult> {
  if (signature === null) return Promise.resolve({ status: "unsigned" });
  const hit = cache.get(signature);
  if (hit) return Promise.resolve(hit);
  const pending = inFlight.get(signature);
  if (pending) return pending;
  const p = verifySignatureTuple(signature).then((r) => {
    cache.set(signature, r);
    inFlight.delete(signature);
    return r;
  });
  inFlight.set(signature, p);
  return p;
}

/**
 * Verdicts for a list of signatures, keyed by the caller's ids. Entries
 * appear as they settle; a missing key means "still checking".
 */
export function useSignatureVerification(
  items: ReadonlyArray<{ id: string; signature: string | null }>,
): Map<string, VerificationResult> {
  const [verdicts, setVerdicts] = useState<Map<string, VerificationResult>>(
    () => new Map(),
  );

  useEffect(() => {
    let cancelled = false;
    const next = new Map<string, VerificationResult>();
    // Serve cache hits synchronously so the common case never flickers.
    const pending: Array<Promise<void>> = [];
    for (const item of items) {
      if (item.signature === null) {
        next.set(item.id, { status: "unsigned" });
        continue;
      }
      const hit = cache.get(item.signature);
      if (hit) {
        next.set(item.id, hit);
        continue;
      }
      pending.push(
        verifyCached(item.signature).then((r) => {
          if (cancelled) return;
          setVerdicts((prev) => {
            const m = new Map(prev);
            m.set(item.id, r);
            return m;
          });
        }),
      );
    }
    setVerdicts(next);
    void Promise.allSettled(pending);
    return () => {
      cancelled = true;
    };
  }, [items]);

  return verdicts;
}
