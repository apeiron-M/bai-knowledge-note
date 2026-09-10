/**
 * Is the signed-in user an administrator of this drive?
 *
 * Asked of THIS package's access subgraph as a boolean (`canManage`), which is
 * the host's own "administers this document" predicate — supreme admin, owner,
 * or an ADMIN grant. No local heuristic can substitute: a supreme admin from
 * the server's ADMINS variable holds no grant rows at all and would be
 * misclassified by any check over the grant list.
 *
 * It used to ask the host's `documentAccess`, whose refusal was the answer.
 * That worked, and logged an error on the Switchboard for every non-admin who
 * opened the vault — the server records each refusal at error level. A menu
 * deciding whether to show an item should not leave a trail like that. The
 * refusing probe is kept only as the fallback for a deployment whose subgraph
 * predates the boolean.
 *
 * Cached per drive because two consumers ask: the settings menu, to decide
 * whether to offer the Access item at all, and the view itself.
 *
 * Returns `null` while undetermined, so callers can avoid flashing a menu item
 * they are about to hide.
 */
import { useEffect, useState } from "react";
import { canManageDocument, documentAccess } from "./use-auth-api.js";

export type AdminProbes = {
  /** The boolean probe. `data` absent means the field is unavailable. */
  canManage: (id: string) => Promise<{ data?: { canManage: boolean } }>;
  /** The refusing probe: an answer means admin, a refusal means not. */
  documentAccess: (id: string) => Promise<{ data?: unknown }>;
};

/**
 * The decision and its cache, built over injectable probes so the fallback
 * rule can be tested without a server.
 */
export function createAdminCheck(probes: AdminProbes) {
  const cache = new Map<string, boolean>();
  const inflight = new Map<string, Promise<boolean>>();

  async function decide(driveId: string): Promise<boolean> {
    const fast = await probes.canManage(driveId);
    if (fast.data) return fast.data.canManage;
    // The field is not there (older deployment, or the package not yet
    // rebuilt): the refusing probe still answers, at the cost of the log line.
    const slow = await probes.documentAccess(driveId);
    return slow.data !== undefined;
  }

  return {
    /** The cached verdict, or undefined when none has been reached. */
    peek(driveId: string): boolean | undefined {
      return cache.get(driveId);
    },
    check(driveId: string): Promise<boolean> {
      const cached = cache.get(driveId);
      if (cached !== undefined) return Promise.resolve(cached);
      const pending = inflight.get(driveId);
      if (pending) return pending;
      const promise = decide(driveId)
        .then((ok) => {
          cache.set(driveId, ok);
          return ok;
        })
        .finally(() => {
          inflight.delete(driveId);
        });
      inflight.set(driveId, promise);
      return promise;
    },
    invalidate(driveId: string): void {
      cache.delete(driveId);
      inflight.delete(driveId);
    },
  };
}

const adminCheck = createAdminCheck({
  canManage: canManageDocument,
  documentAccess,
});

export function invalidateAdminCheck(driveId: string): void {
  adminCheck.invalidate(driveId);
}

export function useIsVaultAdmin(driveId: string | undefined): boolean | null {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(() =>
    driveId ? (adminCheck.peek(driveId) ?? null) : null,
  );

  useEffect(() => {
    if (!driveId) {
      setIsAdmin(null);
      return;
    }
    let live = true;
    void adminCheck.check(driveId).then((ok) => {
      if (live) setIsAdmin(ok);
    });
    return () => {
      live = false;
    };
  }, [driveId]);

  return isAdmin;
}
