/**
 * Copy rules for what a toast shows under its headline.
 *
 * The headline is already the verdict ("You do not have permission to do
 * that"); the detail is the server's own sentence, kept because it names the
 * refused operation — the one fact an expert needs. The server, though,
 * prefixes that sentence with the verdict again ("Forbidden: …"), so read
 * together the toast said the same thing twice before it said anything new.
 * The prefix goes; the wording after it stays the server's.
 */
const VERDICT_PREFIX = /^(?:forbidden|unauthori[sz]ed|unauthenticated|error)\s*:\s*/i;

export function presentDetail(detail: string): string {
  const trimmed = detail.replace(/\s+/g, " ").trim().replace(VERDICT_PREFIX, "");
  if (trimmed.length === 0) return "";
  return trimmed[0].toUpperCase() + trimmed.slice(1);
}
