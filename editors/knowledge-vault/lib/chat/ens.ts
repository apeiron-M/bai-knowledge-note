/**
 * Turning an Ethereum address into a person, and back.
 *
 * Every operation in the vault is signed, so "who changed this?" answers with
 * an address — `document_history` returns `0xadbA7C2F…BcA4`, which is true and
 * unreadable. The vault's own signer badges already resolve those through the
 * design system's `useEns`, which fetches `https://api.ensdata.net/<value>`;
 * the chat uses the same endpoint so a name in an answer and a name on a
 * badge can never disagree.
 *
 * The service takes either direction — an address or a name — and answers a
 * genuinely unregistered address with `404` and `{error: true, message}`.
 * That is an answer, not a failure: "this address has no ENS name" is what
 * the reader asked for, so it comes back as a result with `name: null`.
 *
 * It also rate-limits: a burst of lookups (every editor of a vault, say) can
 * come back 403 for a while. So a second resolver stands behind it — same
 * answers, different operator — and results are cached, because the same few
 * addresses sign thousands of operations.
 */

const TIMEOUT_MS = 10_000;
/** Long enough to cover a conversation; short enough to notice a new name. */
const CACHE_TTL_MS = 10 * 60_000;

interface Resolver {
  name: string;
  url: (value: string) => string;
  /** `null` means "the service answered, and there is no name". */
  parse: (body: unknown, status: number, query: string) => EnsIdentity | null;
}

const RESOLVERS: Resolver[] = [
  {
    // What the design system's useEns calls, so the chat and the vault's
    // signer badges resolve through the same operator.
    name: "ensdata.net",
    url: (v) => `https://api.ensdata.net/${encodeURIComponent(v)}`,
    parse: (raw, status, query) => {
      const body = raw as EnsDataResponse;
      if (body.error === true || status === 404) {
        return {
          query,
          name: null,
          address: /^0x/i.test(query) ? query : null,
          avatar: null,
          description: null,
          reason: str(body.message) ?? `not registered (${status})`,
        };
      }
      const name = str(body.ens_primary) ?? str(body.ens);
      if (!name && !str(body.address)) return null;
      return {
        query,
        name,
        address: str(body.address),
        avatar: str(body.avatar_url) ?? str(body.avatar),
        description: str(body.description),
      };
    },
  },
  {
    name: "ensideas.com",
    url: (v) => `https://api.ensideas.com/ens/resolve/${encodeURIComponent(v)}`,
    parse: (raw, _status, query) => {
      const body = raw as { address?: unknown; name?: unknown; avatar?: unknown };
      const address = str(body.address);
      if (!address) return null;
      const name = str(body.name);
      return {
        query,
        name,
        address,
        avatar: str(body.avatar),
        description: null,
        ...(name ? {} : { reason: "no primary ENS name is set for this address" }),
      };
    },
  },
];

export interface EnsIdentity {
  /** What was looked up, as given. */
  query: string;
  /** The primary ENS name, or null when the address has none. */
  name: string | null;
  /** The address the name resolves to, or the address that was looked up. */
  address: string | null;
  avatar: string | null;
  description: string | null;
  /** The service's own words when there is no name — worth quoting. */
  reason?: string;
}

interface EnsDataResponse {
  address?: unknown;
  ens?: unknown;
  ens_primary?: unknown;
  avatar?: unknown;
  avatar_url?: unknown;
  description?: unknown;
  error?: unknown;
  message?: unknown;
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

/** An ENS name or a 0x address. Anything else is not worth a request. */
export function looksResolvable(value: string): boolean {
  const v = value.trim();
  return /^0x[0-9a-f]{40}$/i.test(v) || /^[\w-]+(\.[\w-]+)+$/.test(v);
}

const cache = new Map<string, { at: number; identity: EnsIdentity }>();

/** Test seam: forget what has been resolved. */
export function resetEnsCache(): void {
  cache.clear();
}

/**
 * Resolve a name or an address. Throws only when no resolver could answer —
 * a "no such name" comes back as a result whose `name` is null.
 */
export async function resolveEns(value: string): Promise<EnsIdentity> {
  const query = value.trim();
  if (!looksResolvable(query)) {
    throw new Error(
      `"${query}" is neither an Ethereum address (0x…) nor an ENS name (something.eth)`,
    );
  }
  const key = query.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.identity;

  const failures: string[] = [];
  for (const resolver of RESOLVERS) {
    try {
      const res = await fetch(resolver.url(query), {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      // The body carries the explanation on 404 too, so read it either way.
      const body: unknown = await res.json().catch(() => null);
      if (body === null) {
        failures.push(`${resolver.name} answered ${res.status} with no body`);
        continue;
      }
      const identity = resolver.parse(body, res.status, query);
      if (!identity) {
        failures.push(`${resolver.name} answered ${res.status}`);
        continue;
      }
      cache.set(key, { at: Date.now(), identity });
      return identity;
    } catch (err) {
      failures.push(`${resolver.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(`could not resolve ${query} — ${failures.join("; ")}`);
}

/**
 * Resolve several addresses at once, tolerating individual failures: a name
 * that cannot be looked up is simply absent, never an error that would cost
 * the caller its whole answer.
 */
export async function resolveEnsNames(
  values: readonly string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(values.filter(looksResolvable))];
  const names = new Map<string, string>();
  await Promise.all(
    unique.map(async (value) => {
      try {
        const id = await resolveEns(value);
        if (id.name) names.set(value, id.name);
      } catch {
        /* an unresolvable address stays an address */
      }
    }),
  );
  return names;
}
