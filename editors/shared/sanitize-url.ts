/**
 * Scheme allow-list for hrefs built from untrusted markdown.
 *
 * The markdown renderers interpolate a link target straight into an `href`
 * that is then handed to `dangerouslySetInnerHTML`. `escapeHtml` already
 * neutralises `& < > "`, so an attacker cannot break out of the attribute —
 * but nothing stopped `javascript:` from executing in the vault's origin,
 * where the chat's API key is stored. Note content is attacker-influenceable
 * and the chat quotes it back through the same renderer, so this is the join
 * between a poisoned note and a stolen credential.
 */

/** Schemes that may appear in a rendered link. Everything else is dropped. */
const ALLOWED_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/**
 * Characters browsers strip *before* resolving a scheme — C0 controls, space
 * and DEL — which is what makes a tab inside "javascript" executable. They
 * must come out before the scheme is read, or the check inspects a different
 * string than the browser will.
 */
function stripSchemeNoise(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (code > 0x20 && code !== 0x7f) out += ch;
  }
  return out;
}

export function safeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const probe = stripSchemeNoise(trimmed).toLowerCase();
  if (!probe) return null;
  const colon = probe.indexOf(":");
  if (colon === -1) return trimmed; // no scheme: relative or fragment

  // A colon appearing after a path/query/fragment delimiter is part of the
  // path, not a scheme — `/a:b` is relative, `a:b` is not.
  const delimiters = ["/", "?", "#"]
    .map((c) => probe.indexOf(c))
    .filter((i) => i !== -1);
  if (delimiters.length > 0 && Math.min(...delimiters) < colon) return trimmed;

  return ALLOWED_SCHEMES.has(probe.slice(0, colon + 1)) ? trimmed : null;
}
