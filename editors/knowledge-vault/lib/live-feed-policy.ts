/**
 * When a refused WebSocket handshake means "sign in", not "the server broke".
 *
 * Since Powerhouse `6.2.3-dev.4` the Switchboard authenticates a WebSocket
 * once, in graphql-ws's `onConnect`, and refuses a connection it will not
 * admit by closing **4403 Forbidden** — the one auth close code graphql-ws
 * keeps retryable (4401 and 4500 are in its fatal list). Before `dev.4` the
 * same refusal surfaced as a 4500 thrown from `context()`; that shape is
 * gone, and a 4500 is a genuine server fault again on every version we run.
 *
 * What this module decides is how the client should read a close: 4401/4403
 * while we sent NO token is the credential refusal — report it as "sign in"
 * and do not knock again until a session exists. The same codes with a token
 * in hand are a real refusal of that session and keep their warning.
 */

/** graphql-ws close codes. Named here so the policy reads as intent. */
export const CLOSE_UNAUTHORIZED = 4401;
export const CLOSE_FORBIDDEN = 4403;

/**
 * True when a close should be read as "no credentials were offered and the
 * server wanted some": one of the explicit auth close codes, and we genuinely
 * sent nothing. Anything else — a normal close, a network drop, a 4500 — is
 * not a request to sign in.
 */
export function refusedForMissingToken(
  closeCode: number | undefined,
  hadToken: boolean,
): boolean {
  if (hadToken) return false;
  return closeCode === CLOSE_UNAUTHORIZED || closeCode === CLOSE_FORBIDDEN;
}

/**
 * The close code carried by whatever graphql-ws hands to `on.closed` /
 * `error`: a CloseEvent-like object for a closed socket, or an `Error` for a
 * failure before one existed. Undefined when there is none.
 */
export function closeCodeOf(event: unknown): number | undefined {
  if (typeof event !== "object" || event === null) return undefined;
  const code = (event as { code?: unknown }).code;
  return typeof code === "number" ? code : undefined;
}
