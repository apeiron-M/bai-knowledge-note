// The reactor serializes a piece error by copying its own enumerable keys
// across IPC, so these are plain fields rather than accessors.

export type KnowledgeVaultErrorCategory =
  | "validation"
  | "credential"
  | "permission"
  | "not_found"
  | "conflict"
  | "rate_limit"
  | "server"
  | "unconfirmed"
  | "network"
  | "config"
  | "timeout";

export class KnowledgeVaultApiError extends Error {
  // `declare`: no class-field initialiser, so an absent value is not an own
  // property. The host copies own enumerable keys across IPC, and an own
  // `undefined` arrives on the other side as the string "undefined".
  declare readonly status?: number;
  /** The vault's own error code (`LINT_REACTOR`, `FORBIDDEN`, …), when it sent one. */
  declare readonly code?: string;
  declare readonly detail?: unknown;
  readonly category: KnowledgeVaultErrorCategory;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: {
      status?: number;
      code?: string;
      category: KnowledgeVaultErrorCategory;
      retryable?: boolean;
      detail?: unknown;
    },
  ) {
    super(message);
    this.name = "KnowledgeVaultApiError";
    this.category = options.category;
    this.retryable = options.retryable ?? false;
    if (options.status !== undefined) Object.assign(this, { status: options.status });
    if (options.code !== undefined) Object.assign(this, { code: options.code });
    if (options.detail !== undefined) Object.assign(this, { detail: options.detail });
  }
}

// Piece bundles are minified since reactor-workflow 6.2.3-dev.40 (no
// keepNames), which renames this class (`H`), and the piece worker names a
// serialized error by `error.constructor.name` before `error.name`. Pin the
// class's own name so a step's error still reads KnowledgeVaultApiError.
Object.defineProperty(KnowledgeVaultApiError, "name", { value: "KnowledgeVaultApiError" });

/**
 * The vault's error codes (subgraphs/http/lib/respond.ts and the routes) in
 * terms an operator can act on. A code wins over the status: the same 502
 * means "rolled back, safe to retry" for CREATE_FAILED and "the conversion
 * service is down" for CONVERT_UNAVAILABLE.
 */
const CODE_CATEGORY: Record<string, [KnowledgeVaultErrorCategory, boolean]> = {
  LINT_REACTOR: ["validation", false],
  LINT_CONVENTION: ["validation", false],
  BAD_REQUEST: ["validation", false],
  UNKNOWN_FIELD: ["validation", false],
  UNKNOWN_LINK_TYPE: ["validation", false],
  UNSUPPORTED_DOCUMENT_TYPE: ["validation", false],
  FOLDER_OUTSIDE_VAULT_PATH: ["validation", false],
  FOLDER_UNRESOLVED: ["validation", false],
  FILENAME_REQUIRED: ["validation", false],
  EMPTY_BODY: ["validation", false],
  INVALID_MIN_SECTION_CHARS: ["validation", false],
  UNAUTHENTICATED: ["credential", false],
  FORBIDDEN: ["permission", false],
  NOT_FOUND: ["not_found", false],
  JOB_NOT_FOUND: ["not_found", false],
  CONFLICT: ["conflict", false],
  CREATE_FAILED: ["server", true],
  CONTAINMENT_FAILED: ["server", true],
  CONVERT_BUSY: ["server", true],
  CONVERT_UNAVAILABLE: ["server", true],
  DISPATCH_FAILED: ["server", false],
  INGEST_REJECTED: ["server", false],
  CONVERT_NOT_CONFIGURED: ["server", false],
  READ_BACK_INCOMPLETE: ["unconfirmed", false],
};

export function classify(
  status: number,
  code: string | undefined,
): { category: KnowledgeVaultErrorCategory; retryable: boolean } {
  const known = code ? CODE_CATEGORY[code] : undefined;
  if (known) return { category: known[0], retryable: known[1] };
  if (status === 400 || status === 413 || status === 422) return { category: "validation", retryable: false };
  if (status === 401) return { category: "credential", retryable: false };
  if (status === 403) return { category: "permission", retryable: false };
  if (status === 404) return { category: "not_found", retryable: false };
  if (status === 409) return { category: "conflict", retryable: false };
  if (status === 429) return { category: "rate_limit", retryable: true };
  return { category: "server", retryable: status >= 500 };
}

/** The vault answers `{ error, code, details? }`; a proxy may answer anything. */
export function readErrorBody(body: unknown): { message?: string; code?: string } {
  if (typeof body === "string" && body.trim() !== "") return { message: body.trim().slice(0, 300) };
  if (typeof body !== "object" || body === null) return {};
  const record = body as Record<string, unknown>;
  const message = ["error", "message", "detail"]
    .map((key) => record[key])
    .find((value): value is string => typeof value === "string" && value.trim() !== "");
  const code = typeof record.code === "string" ? record.code : undefined;
  return { message: message?.trim(), code };
}

/**
 * How to bring back a token whose Renown login lapsed. The login, not the
 * token, is what expires first: `ph login` binds the directory's key
 * (.ph/.keypair.json) to the wallet for 7 days, and the Switchboard checks that
 * binding on every request, so a token minted with `--expiry 90d` stops after
 * 7 days too. Renewing the login renews the binding for the same key, and every
 * token that key signed works again with nothing to re-paste.
 */
export const RENEW_LOGIN =
  "A `ph login` lasts 7 days, whatever the token's own expiry. Run `ph login` again in the directory that minted the token and the same token works again; if that key is gone, mint a new one with `ph access-token --expiry 90d` and paste it into the connection.";

/** The run error for that 401, which on its own reads like a bad token. */
export const LAPSED_LOGIN_MESSAGE = `Credentials no longer valid: the Renown login that signed this token has lapsed. ${RENEW_LOGIN}`;

/**
 * The Switchboard's 401 when Renown no longer vouches for the token's key
 * (reactor-api AuthService). An unverifiable token answers "Authentication
 * failed" instead.
 */
export function isLapsedLogin(message: string | undefined): boolean {
  return message !== undefined && /credentials no longer valid/i.test(message);
}

/** The text of anything thrown, for placeholders and messages. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
