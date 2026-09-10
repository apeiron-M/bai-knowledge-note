/**
 * When a refused WebSocket handshake means "sign in", not "the server broke".
 *
 * The Switchboard's websocket context factory throws a plain `Error` when a
 * connection arrives without a bearer and authorization is enabled. graphql-ws
 * treats any throw from `context()` as an implementation fault: it logs
 * "Internal error occurred during message handling" server-side and closes the
 * socket with 4500 InternalServerError — and the client, seeing 4500, refuses
 * to retry however it was configured. So a tokenless connection against a
 * protected Switchboard costs one error line in the server log and leaves the
 * client's feed dead until something re-creates the socket.
 *
 * That shape is upstream's to fix (it should close 4401). What this module
 * decides is how the client should read such a close: a 4500 while we sent NO
 * token is, on this server, the credential refusal — so it should be reported
 * as "sign in" and not attempted again until a session exists. A 4500 while we
 * DID send a token is a genuine server fault and must keep its warning.
 */

/** graphql-ws close codes. Named here so the policy reads as intent. */
export const CLOSE_UNAUTHORIZED = 4401;
export const CLOSE_FORBIDDEN = 4403;
export const CLOSE_INTERNAL_SERVER_ERROR = 4500;

/**
 * True when a close should be read as "no credentials were offered and the
 * server wanted some". 4401/4403 say so directly; 4500 says so only because
 * we know this server's auth check throws instead of closing cleanly, and only
 * when we genuinely sent nothing — with a token in hand, 4500 is a real error.
 */
export function refusedForMissingToken(
  closeCode: number | undefined,
  hadToken: boolean,
): boolean {
  if (hadToken) return false;
  return (
    closeCode === CLOSE_UNAUTHORIZED ||
    closeCode === CLOSE_FORBIDDEN ||
    closeCode === CLOSE_INTERNAL_SERVER_ERROR
  );
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
