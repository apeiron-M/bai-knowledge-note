import { authHeaders, type TokenProvider } from "../../shared/authed-fetch.js";
import { resolveSwitchboardOrigin } from "../../shared/subgraph-endpoint.js";

/**
 * One authenticated call into the vault's own REST routes.
 *
 * The routes live under the package namespace on the Switchboard
 * (`<origin>/api/@powerhousedao/knowledge-note/...`, measured against a running
 * server), and every one of them needs the same bearer. This is that, in one
 * place, so no view grows its own fetch.
 *
 * A refusal is typed: the routes answer `{ error, code }` and the UI shows the
 * code when there is one. A refusal that is not JSON (a proxy, a dead
 * Switchboard) must still arrive as a failure the caller can render rather than
 * a SyntaxError, and a network failure as something other than a raw TypeError.
 */
export class VaultApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "VaultApiFailure";
  }
}

export type VaultApi = {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  /** A raw body — a file's bytes for `POST convert` — with exactly one content type. */
  postRaw<T>(
    path: string,
    bytes: Uint8Array,
    options?: { contentType?: string },
  ): Promise<T>;
};

export type VaultApiOptions = {
  fetchImpl?: typeof fetch;
  /** The Switchboard origin; defaults to `resolveSwitchboardOrigin()`. `null` means unresolvable. */
  origin?: string | null;
  /** Where the bearer comes from; defaults to the ambient Renown session. */
  tokenProvider?: TokenProvider;
};

const PACKAGE = "@powerhousedao/knowledge-note";

const trimSlashes = (s: string) => s.replace(/\/+$/, "");

export function createVaultApi(options: VaultApiOptions = {}): VaultApi {
  const doFetch = options.fetchImpl ?? fetch;
  const resolved =
    options.origin === undefined ? resolveSwitchboardOrigin() : options.origin;
  const origin = resolved === null ? null : trimSlashes(resolved);

  const url = (path: string) => {
    if (origin === null) {
      // Off a known host `resolveSwitchboardOrigin()` is null; a request to ""
      // would hit Connect's own origin and fail confusingly. Say so instead.
      throw new VaultApiFailure(
        0,
        "NO_ORIGIN",
        "Could not work out where the vault's Switchboard is from this page's host.",
      );
    }
    return `${origin}/api/${PACKAGE}/${path.replace(/^\/+/, "")}`;
  };

  // One send for every verb, so the error handling and the URL shape exist once.
  async function send<T>(path: string, init: RequestInit): Promise<T> {
    const fullUrl = url(path);
    let response: Response;
    try {
      response = await doFetch(fullUrl, init);
    } catch (error) {
      throw new VaultApiFailure(
        0,
        "UNREACHABLE",
        `Could not reach the vault: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let code = "UNKNOWN";
      let message = `The vault refused the request (${response.status}).`;
      try {
        const parsed = JSON.parse(text) as { error?: string; code?: string };
        if (parsed.code) code = parsed.code;
        if (parsed.error) message = parsed.error;
      } catch {
        // Not JSON: keep the status-shaped message above.
      }
      throw new VaultApiFailure(response.status, code, message);
    }
    return (await response.json()) as T;
  }

  const headers = () => authHeaders(options.tokenProvider);

  /**
   * `authHeaders()` always sets `Content-Type: application/json`. A raw upload
   * must carry the caller's type instead — and only once: spreading a
   * lower-case `content-type` beside it would send two.
   */
  const rawHeaders = async (contentType: string) => {
    const base = await headers();
    for (const key of Object.keys(base)) {
      if (key.toLowerCase() === "content-type") delete base[key];
    }
    return { ...base, "Content-Type": contentType };
  };

  return {
    async get<T>(path: string): Promise<T> {
      return send<T>(path, { method: "GET", headers: await headers() });
    },
    async post<T>(path: string, body: unknown): Promise<T> {
      return send<T>(path, {
        method: "POST",
        headers: await headers(),
        body: JSON.stringify(body),
      });
    },
    async postRaw<T>(
      path: string,
      bytes: Uint8Array,
      opts: { contentType?: string } = {},
    ): Promise<T> {
      return send<T>(path, {
        method: "POST",
        headers: await rawHeaders(
          opts.contentType ?? "application/octet-stream",
        ),
        body: bytes as unknown as BodyInit,
      });
    },
  };
}
