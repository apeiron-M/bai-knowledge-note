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
 */

const ENDPOINT = "https://api.ensdata.net/";
const TIMEOUT_MS = 10_000;

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

/**
 * Resolve a name or an address. Throws only when the lookup could not be
 * made — a "no such name" comes back as a result whose `name` is null.
 */
export async function resolveEns(value: string): Promise<EnsIdentity> {
  const query = value.trim();
  if (!looksResolvable(query)) {
    throw new Error(
      `"${query}" is neither an Ethereum address (0x…) nor an ENS name (something.eth)`,
    );
  }
  const res = await fetch(`${ENDPOINT}${encodeURIComponent(query)}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // The body carries the explanation on 404 as well, so read it either way.
  const body = (await res.json().catch(() => null)) as EnsDataResponse | null;
  if (!body) {
    throw new Error(`the ENS service answered ${res.status} with no body`);
  }
  if (body.error === true || res.status === 404) {
    const isAddress = /^0x/i.test(query);
    return {
      query,
      name: null,
      address: isAddress ? query : null,
      avatar: null,
      description: null,
      reason: str(body.message) ?? `not registered (${res.status})`,
    };
  }
  if (!res.ok) {
    throw new Error(`the ENS service answered ${res.status}`);
  }
  return {
    query,
    name: str(body.ens_primary) ?? str(body.ens),
    address: str(body.address),
    avatar: str(body.avatar_url) ?? str(body.avatar),
    description: str(body.description),
  };
}
