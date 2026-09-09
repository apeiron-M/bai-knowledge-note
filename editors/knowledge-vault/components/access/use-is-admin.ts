/**
 * Is the signed-in user an administrator of this drive?
 *
 * `documentAccess` is itself ADMIN-gated server-side, so asking it *is* the
 * test: an answer means canManage passed (supreme admin, owner, or an ADMIN
 * grant) and a refusal means it did not. No local heuristic can substitute —
 * a supreme admin from the server's ADMINS variable holds no grant rows at
 * all and would be misclassified by any check over the grant list.
 *
 * Cached per drive because two consumers ask: the settings menu, to decide
 * whether to offer the Access item at all, and the view itself. Without a
 * cache that is two identical ADMIN-gated queries on every open.
 *
 * Returns `null` while undetermined, so callers can avoid flashing a menu item
 * they are about to hide.
 */
import { useEffect, useState } from "react";
import { documentAccess } from "./use-auth-api.js";

const cache = new Map<string, boolean>();
const inflight = new Map<string, Promise<boolean>>();

export function invalidateAdminCheck(driveId: string): void {
  cache.delete(driveId);
  inflight.delete(driveId);
}

async function check(driveId: string): Promise<boolean> {
  const cached = cache.get(driveId);
  if (cached !== undefined) return cached;
  const pending = inflight.get(driveId);
  if (pending) return pending;

  const promise = documentAccess(driveId).then((res) => {
    const ok = res.data !== undefined;
    cache.set(driveId, ok);
    inflight.delete(driveId);
    return ok;
  });
  inflight.set(driveId, promise);
  return promise;
}

export function useIsVaultAdmin(driveId: string | undefined): boolean | null {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(() =>
    driveId ? (cache.get(driveId) ?? null) : null,
  );

  useEffect(() => {
    if (!driveId) {
      setIsAdmin(null);
      return;
    }
    let live = true;
    void check(driveId).then((ok) => {
      if (live) setIsAdmin(ok);
    });
    return () => {
      live = false;
    };
  }, [driveId]);

  return isAdmin;
}
