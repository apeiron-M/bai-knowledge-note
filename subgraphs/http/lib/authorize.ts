import type { CanonicalDocumentId } from "@powerhousedao/reactor-api";
import type { IAuthorizationService } from "@powerhousedao/reactor-api";
import type { RouteContext } from "@powerhousedao/shared/processors";
import type { HttpRouteDeps } from "./deps.js";
import { HttpError } from "./respond.js";
import { timed } from "./slow.js";

export function requireUser(
  ctx: RouteContext,
): NonNullable<RouteContext["user"]> {
  if (!ctx.user) {
    throw new HttpError(401, "UNAUTHENTICATED", "A verified bearer is required");
  }
  return ctx.user;
}

async function canonical(
  deps: HttpRouteDeps,
  identifier: string,
  ctx: RouteContext,
): Promise<CanonicalDocumentId> {
  return deps.resolveCanonicalDocumentId(identifier, ctx);
}

/**
 * A refusal for a document that no longer exists is a 404, not a 403: a
 * deleted source reads as "Forbidden" otherwise, which sends callers after
 * a permission they already have. Checked only once access is denied, so
 * an existing document the caller may not read still answers 403.
 */
async function refusal(
  deps: HttpRouteDeps,
  id: CanonicalDocumentId,
  identifier: string,
  verb: "read" | "write" | "manage",
): Promise<HttpError> {
  try {
    await deps.reactorClient.get(id);
  } catch (error) {
    if (
      error instanceof Error &&
      /not ?found|deleted|does not exist/i.test(`${error.name} ${error.message}`)
    ) {
      return new HttpError(404, "NOT_FOUND", `${identifier} does not exist (it may have been deleted)`);
    }
  }
  return new HttpError(403, "FORBIDDEN", `No ${verb} access to ${identifier}`);
}

export async function canonicalForRead(
  deps: HttpRouteDeps,
  identifier: string,
  ctx: RouteContext,
): Promise<CanonicalDocumentId> {
  const user = requireUser(ctx);
  const id = await canonical(deps, identifier, ctx);
  if (!(await deps.authorization.canRead(id, user.address))) {
    throw await refusal(deps, id, identifier, "read");
  }
  return id;
}

export async function canonicalForWrite(
  deps: HttpRouteDeps,
  identifier: string,
  ctx: RouteContext,
): Promise<CanonicalDocumentId> {
  const user = requireUser(ctx);
  const id = await timed("canonical id (write)", () =>
    canonical(deps, identifier, ctx),
  );
  if (
    !(await timed("authorization.canWrite", () =>
      deps.authorization.canWrite(id, user.address),
    ))
  ) {
    throw await refusal(deps, id, identifier, "write");
  }
  return id;
}

export async function canonicalForManage(
  deps: HttpRouteDeps & {
    authorization: Pick<IAuthorizationService, "canManage">;
  },
  identifier: string,
  ctx: RouteContext,
): Promise<CanonicalDocumentId> {
  const user = requireUser(ctx);
  const id = await canonical(deps, identifier, ctx);
  if (!(await deps.authorization.canManage(id, user.address))) {
    throw await refusal(deps, id, identifier, "manage");
  }
  return id;
}
