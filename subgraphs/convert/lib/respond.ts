/**
 * Mirrors `subgraphs/http/lib/respond.ts` rather than importing it.
 *
 * Subgraphs are independently deployable units — `subgraphs/http/lib.ts` is a
 * per-subgraph scaffold, not a shared library, and reaching across would make
 * one subgraph's refactor break another's routes.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const OK_CACHE = { "Cache-Control": "private, max-age=0" };

export function jsonError(error: unknown): Response {
  if (error instanceof HttpError) {
    return Response.json(
      {
        error: error.message,
        code: error.code,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
      { status: error.status },
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  return Response.json({ error: message, code: "INTERNAL" }, { status: 500 });
}
