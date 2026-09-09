/**
 * The one place a browser request to the reactor attaches its identity.
 *
 * Every `bai/*` write from the vault app goes through the raw GraphQL surfaces
 * (`/graphql`, `/graphql/r`) rather than Connect's authenticated reactor,
 * because remote-first exists to dodge Chrome's per-value IndexedDB cap. That
 * decision is why the bearer has to be attached by hand here rather than being
 * inherited from a client.
 *
 * Two properties are load-bearing:
 *
 * - The token carries **no `aud` claim**. The Switchboard's verifier rejects a
 *   token that declares an audience unless the server has an app address
 *   configured, so `ambientRenownTokenProvider` is used as-is rather than
 *   minting one with an audience.
 * - A missing token omits the header entirely rather than sending
 *   `Bearer undefined`. `AuthService.verifyBearer` treats an absent header as
 *   an anonymous caller (no 401), while a malformed one is a hard 401 — so an
 *   unauthenticated read still reaches the policy and fails with the right
 *   error.
 */
import { ambientRenownTokenProvider } from "@powerhousedao/reactor-browser";

export type TokenProvider = () => Promise<string | undefined>;

/**
 * Reads the ambient Renown session (`window.ph`) on every call, so a login that
 * happens after module load is picked up without a reload.
 */
export const getBearerToken: TokenProvider = async () => {
  try {
    return await ambientRenownTokenProvider();
  } catch {
    return undefined;
  }
};

/**
 * The JSON headers a reactor request needs, plus the bearer when one exists.
 *
 * Preferred at call sites whose body shape is already established — swapping
 * one `headers:` line is a far smaller change than restructuring the call, and
 * it keeps every request's query/variables exactly as written. Use
 * `authedGraphQLFetch` for new code.
 *
 * Only for the reactor and its subgraphs. The chat's OpenRouter and
 * OpenAI-compatible calls must NOT receive this: sending a Renown credential to
 * a third-party endpoint would leak it.
 */
export async function authHeaders(
  tokenProvider: TokenProvider = getBearerToken,
): Promise<Record<string, string>> {
  const token = await tokenProvider();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/** POST a GraphQL body, carrying the caller's bearer when one is available. */
export async function authedGraphQLFetch(
  endpoint: string,
  body: unknown,
  tokenProvider: TokenProvider = getBearerToken,
): Promise<Response> {
  const token = await tokenProvider();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}
