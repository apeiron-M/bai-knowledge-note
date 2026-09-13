import type { CanonicalDocumentId } from "@powerhousedao/reactor-api";
import type { RouteContext } from "@powerhousedao/shared/processors";
import type { HttpRouteDeps } from "./deps.js";
import { HttpError } from "./respond.js";

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

export async function canonicalForRead(
  deps: HttpRouteDeps,
  identifier: string,
  ctx: RouteContext,
): Promise<CanonicalDocumentId> {
  const user = requireUser(ctx);
  const id = await canonical(deps, identifier, ctx);
  if (!(await deps.authorization.canRead(id, user.address))) {
    throw new HttpError(403, "FORBIDDEN", `No read access to ${identifier}`);
  }
  return id;
}

export async function canonicalForWrite(
  deps: HttpRouteDeps,
  identifier: string,
  ctx: RouteContext,
): Promise<CanonicalDocumentId> {
  const user = requireUser(ctx);
  const id = await canonical(deps, identifier, ctx);
  if (!(await deps.authorization.canWrite(id, user.address))) {
    throw new HttpError(403, "FORBIDDEN", `No write access to ${identifier}`);
  }
  return id;
}
