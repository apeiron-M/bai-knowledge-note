/**
 * Address → ENS name, for the addresses shown in the Access view.
 *
 * The stack cannot do this for an arbitrary address: `useRenownAuth().ensName`
 * answers only for the signed-in user, and `ENSInfo` is a field on `User`
 * rather than a resolver. So this follows the same public-gateway approach
 * `@powerhousedao/auth-editor` uses, with two things it lacks:
 *
 *  - **In-flight de-duplication.** A table showing the same address twice (as
 *    a grantee and as the granter, which is common) otherwise fires two
 *    identical requests. Requests are keyed and shared.
 *  - **Seeding from a trusted local source.** The signed-in user's ENS name is
 *    already known from Renown, so `seedEns` primes the cache and no network
 *    call is made for your own address.
 *
 * ⚠ **This sends addresses to a third party** (`api.ensideas.com`). The vault's
 * contributor addresses are already visible in its own audit log, but that is
 * not the same as handing them to an external service, so it is stated here
 * rather than buried: set `VITE_ENS_LOOKUP=off` to show raw addresses only.
 * Failure is always silent — callers fall back to the address.
 */
import { useEffect, useState } from "react";

/** Set VITE_ENS_LOOKUP=off to show raw addresses and make no external call. */
function ensLookupEnabled(): boolean {
  const env =
    typeof import.meta !== "undefined"
      ? (import.meta as { env?: Record<string, string> }).env
      : undefined;
  return env?.VITE_ENS_LOOKUP !== "off";
}

const GATEWAY = "https://api.ensideas.com/ens/resolve/";

const cache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

/** Prime the cache from a source that already knows, e.g. Renown. */
export function seedEns(address: string, name: string | undefined): void {
  if (!address) return;
  cache.set(address.toLowerCase(), name ?? null);
}

async function fetchName(address: string): Promise<string | null> {
  try {
    const res = await fetch(`${GATEWAY}${encodeURIComponent(address)}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { name?: string | null };
    return body.name ?? null;
  } catch {
    return null;
  }
}

export async function resolveEns(address: string): Promise<string | null> {
  if (!address || !ensLookupEnabled()) return null;
  const key = address.toLowerCase();

  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = fetchName(address).then((name) => {
    cache.set(key, name);
    inflight.delete(key);
    return name;
  });
  inflight.set(key, promise);
  return promise;
}

/** Resolved ENS name, or null while pending and on failure. */
export function useEnsName(address: string | undefined): string | null {
  const [name, setName] = useState<string | null>(() =>
    address ? (cache.get(address.toLowerCase()) ?? null) : null,
  );

  useEffect(() => {
    if (!address) {
      setName(null);
      return;
    }
    let live = true;
    void resolveEns(address).then((n) => {
      if (live) setName(n);
    });
    return () => {
      live = false;
    };
  }, [address]);

  return name;
}
