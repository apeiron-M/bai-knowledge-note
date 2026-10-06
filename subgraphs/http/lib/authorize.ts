import type { CanonicalDocumentId } from "@powerhousedao/reactor-api";
import type { IAuthorizationService } from "@powerhousedao/reactor-api";
import type { RouteContext } from "@powerhousedao/shared/processors";
import type { HttpRouteDeps } from "./deps.js";
import { HttpError } from "./respond.js";
import { timed } from "./slow.js";

/**
 * Open mode (spec §7.3 of the desktop app): a desktop host's local engine runs
 * with authentication off and declares `KNOWLEDGE_VAULT_OPEN_MODE=1`; its
 * anonymous caller is then the engine's owner, attributed to the engine's own
 * identity (`KNOWLEDGE_VAULT_OPEN_MODE_ADDRESS`). The declaration is the point:
 * a hosted deployment that merely has auth switched off declares nothing and
 * stays closed.
 */
function openModeUser(ctx: RouteContext): RouteContext["user"] {
  if (ctx.authEnabled) return undefined;
  const declared = /^(1|true|yes|on)$/i.test(
    (process.env.KNOWLEDGE_VAULT_OPEN_MODE ?? "").trim(),
  );
  if (!declared) return undefined;
  const address = process.env.KNOWLEDGE_VAULT_OPEN_MODE_ADDRESS?.trim() || "local";
  return { address, chainId: 0, networkId: "local", appKey: "desktop-knowledge-vault" };
}

export function requireUser(
  ctx: RouteContext,
): NonNullable<RouteContext["user"]> {
  const user = ctx.user ?? openModeUser(ctx);
  if (!user) {
    throw new HttpError(401, "UNAUTHENTICATED", "A verified bearer is required");
  }
  return user;
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
  const id = await timed("canonical id (write)", () =>
    canonical(deps, identifier, ctx),
  );
  if (
    !(await timed("authorization.canWrite", () =>
      deps.authorization.canWrite(id, user.address),
    ))
  ) {
    throw new HttpError(403, "FORBIDDEN", `No write access to ${identifier}`);
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
    throw new HttpError(403, "FORBIDDEN", `No manage access to ${identifier}`);
  }
  return id;
}
