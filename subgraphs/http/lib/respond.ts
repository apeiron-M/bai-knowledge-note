export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown[],
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
        ...(error.details ? { details: error.details } : {}),
      },
      { status: error.status },
    );
  }
  if (
    error instanceof Error &&
    error.name === "CanonicalDocumentIdResolutionError"
  ) {
    return Response.json(
      { error: "Document not found", code: "NOT_FOUND" },
      { status: 404 },
    );
  }
  if (
    error instanceof Error &&
    /forbidden|permission/i.test(`${error.name} ${error.message}`)
  ) {
    return Response.json(
      { error: "Insufficient permissions", code: "FORBIDDEN" },
      { status: 403 },
    );
  }
  console.error(
    `[http] unhandled route error: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
  );
  return Response.json(
    { error: "Internal error", code: "INTERNAL" },
    { status: 500 },
  );
}
