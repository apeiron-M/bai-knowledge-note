/**
 * The guide, dated to the visit.
 *
 * The seed keeps the dates of the day it was built, so a visitor's timeline, queue and notes said the
 * guide was made then. Every whole ISO-8601 timestamp in the seed moves by one amount, so that its
 * latest moment is the visit: the guide reads as processed in the minutes before the vault opened,
 * and nothing is dated in the future.
 *
 * A document's id is derived from its creation time (`deriveDocumentId`), so each document gets the id
 * its new time derives, and every reference to its old id — in states, links and the drive's tree — is
 * rewritten. Ids are unique 43-character strings, so an exact substitution over the serialized seed is
 * safe. Folder ids are not derived and stay.
 */
import { deriveDocumentId } from "@powerhousedao/shared/document-model";
import type { VaultSeed } from "./seed.js";

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function eachTimestamp(value: unknown, visit: (iso: string) => void): void {
  if (typeof value === "string") {
    if (ISO.test(value)) visit(value);
  } else if (Array.isArray(value)) {
    for (const v of value) eachTimestamp(v, visit);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) eachTimestamp(v, visit);
  }
}

function shifted<T>(value: T, by: number): T {
  if (typeof value === "string") return (ISO.test(value) ? new Date(Date.parse(value) + by).toISOString() : value) as T;
  if (Array.isArray(value)) return value.map((v: unknown) => shifted(v, by)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shifted(v, by)])) as T;
  }
  return value;
}

/** The seed with its history ending at `now`, and the map from the seed's document ids to the new ones. */
export function redateSeed(seed: VaultSeed, now: Date): { seed: VaultSeed; ids: Record<string, string> } {
  let latest = Number.NEGATIVE_INFINITY;
  eachTimestamp(seed.documents, (iso) => {
    latest = Math.max(latest, Date.parse(iso));
  });
  const by = Number.isFinite(latest) ? now.getTime() - latest : 0;
  const ids: Record<string, string> = {};
  const documents = seed.documents.map((doc) => {
    const created = { ...doc.created, createdAtUtcIso: shifted(doc.created.createdAtUtcIso, by) };
    ids[doc.id] = deriveDocumentId({
      documentType: doc.documentType,
      createdAtUtcIso: created.createdAtUtcIso,
      nonce: created.nonce,
      protocolVersions: created.protocolVersions,
    });
    return { ...doc, created, state: shifted(doc.state, by) };
  });
  let text = JSON.stringify({ ...seed, documents });
  for (const [old, next] of Object.entries(ids)) text = text.split(old).join(next);
  return { seed: JSON.parse(text) as VaultSeed, ids };
}
