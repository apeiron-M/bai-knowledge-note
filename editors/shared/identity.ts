/**
 * Pure helpers for showing WHO is behind an operation.
 *
 * A signed operation carries three identity facts: the user address the
 * signing app claims to act for, the app's did:key that actually produced
 * the signature, and the app's (unsigned) name. Readers care about the
 * first — a person, ideally by their ENS name and avatar — so that is what
 * the UI leads with; the key stays available in tooltips for verification.
 */

/** The subset of the design-system's `EnsData` the badge reads. */
export type EnsLike = {
  ens?: string | null;
  ens_primary?: string | null;
  avatar?: string | null;
  avatar_small?: string | null;
  avatar_url?: string | null;
} | null | undefined;

export type HexAddress = `0x${string}`;

/** `true` for a 20-byte hex address — the only thing ENS can resolve. */
export function isHexAddress(value: string | null | undefined): value is HexAddress {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

/** `0xadbA7C2F…0BcA4` — six leading, four trailing. */
export function shortAddress(address: string): string {
  return address.length > 12
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : address;
}

/**
 * What to print for an address: the primary ENS name when one resolves,
 * else the plain name, else the shortened address. Never the empty string.
 */
export function identityLabel(address: string | null, ens: EnsLike): string | null {
  if (!address) return null;
  const name = ens?.ens_primary?.trim() || ens?.ens?.trim();
  return name || shortAddress(address);
}

/** The avatar URL ENS publishes for the address, small variant preferred. */
export function identityAvatar(ens: EnsLike): string | null {
  return ens?.avatar_small || ens?.avatar_url || ens?.avatar || null;
}

/**
 * One-line "acting through" description: the app that signed and, when
 * known, the key it signed with — the verifiable half of the identity.
 */
export function viaLabel(app: string | null, key: string | null, shortKey: (k: string) => string): string | null {
  if (app && key) return `${app} · ${shortKey(key)}`;
  if (app) return app;
  if (key) return shortKey(key);
  return null;
}
